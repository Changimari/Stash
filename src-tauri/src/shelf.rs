//! Shelf — ドラッグの一時置き場。
//!
//! 2 つの顔を 1 つの窓で持つ。
//! - **ドロップ待ち**: ファイルをドラッグ中に Shift を押すと、カーソルの下に小さく開く。
//!   左＝ライブラリに登録 / 右＝Shelf に預ける。
//! - **一覧**: 預けたものが並ぶ。ここから掴んで他アプリへ運ぶ。
//!
//! オーバーレイと違ってフォーカスを失っても消えない。消えたら置き場にならない。
//!
//! ## Shift 検知に許可が要らない理由
//! グローバルにキー押下を監視すると macOS では入力監視の許可が要る。ここでは代わりに
//! `CGEventSourceButtonState` / `CGEventSourceFlagsState` を**ポーリング**する。
//! 現在の状態を問い合わせるだけの API なので、イベントを盗み見ることにならず許可も不要。

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, WebviewWindow};

pub const SHELF: &str = "shelf";

/// ドロップ待ちの姿。ゾーン 2 つぶんだけの高さ。
const DROP_SIZE: (f64, f64) = (300.0, 108.0);
/// 一覧の姿。
const LIST_SIZE: (f64, f64) = (300.0, 404.0);

const CURSOR_OFFSET: i32 = 28;
const EDGE_MARGIN: i32 = 24;
const POLL_INTERVAL: Duration = Duration::from_millis(60);
/// ボタンを離してから畳むまでの猶予。ドロップイベントが届く前に消さないため。
const HIDE_DELAY: Duration = Duration::from_millis(320);

static WATCHING: AtomicBool = AtomicBool::new(false);
/// フロントが処理中 / 中身を見せている間は自動で閉じない。
static KEEP_OPEN: AtomicBool = AtomicBool::new(false);
/// 一覧として開いたことがあるか（初回だけ画面端へ寄せる）。
static PLACED: AtomicBool = AtomicBool::new(false);
/// Stash 自身が始めたドラッグ。自分の取り出し操作で置き場が開くのを防ぐ。
static OWN_DRAG: AtomicBool = AtomicBool::new(false);

// ─────────────────── 入力状態の問い合わせ（許可不要） ───────────────────

#[cfg(target_os = "macos")]
mod input {
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventSourceButtonState(state_id: i32, button: u32) -> bool;
        fn CGEventSourceFlagsState(state_id: i32) -> u64;
    }
    const COMBINED_SESSION: i32 = 0; // kCGEventSourceStateCombinedSessionState
    const LEFT_BUTTON: u32 = 0; // kCGMouseButtonLeft
    const SHIFT: u64 = 0x0002_0000; // kCGEventFlagMaskShift

    pub fn left_button_down() -> bool {
        unsafe { CGEventSourceButtonState(COMBINED_SESSION, LEFT_BUTTON) }
    }
    pub fn shift_down() -> bool {
        unsafe { CGEventSourceFlagsState(COMBINED_SESSION) & SHIFT != 0 }
    }

    /// ドラッグ用ペーストボードの世代番号。ドラッグが始まるたびに増える。
    /// ボタンを押した時点の値と比べれば「押してからドラッグが始まったか」が分かる。
    pub fn drag_pasteboard_change_count() -> isize {
        use objc2_app_kit::{NSPasteboard, NSPasteboardNameDrag};
        unsafe { NSPasteboard::pasteboardWithName(NSPasteboardNameDrag).changeCount() }
    }

    /// ドラッグ中の中身がファイルかどうか。テキスト選択のドラッグと区別するために見る。
    pub fn dragging_files() -> bool {
        use objc2_app_kit::{NSPasteboard, NSPasteboardNameDrag};
        use objc2_foundation::NSString;

        unsafe {
            let pasteboard = NSPasteboard::pasteboardWithName(NSPasteboardNameDrag);
            let Some(types) = pasteboard.types() else {
                return false;
            };
            // 新旧どちらの型でも来るので両方見る
            let file_url = NSString::from_str("public.file-url");
            let legacy = NSString::from_str("NSFilenamesPboardType");
            types.containsObject(&file_url) || types.containsObject(&legacy)
        }
    }
}

#[cfg(target_os = "windows")]
mod input {
    #[link(name = "user32")]
    extern "system" {
        fn GetAsyncKeyState(v_key: i32) -> i16;
    }
    const VK_LBUTTON: i32 = 0x01;
    const VK_SHIFT: i32 = 0x10;

    fn down(key: i32) -> bool {
        unsafe { (GetAsyncKeyState(key) as u16 & 0x8000) != 0 }
    }
    pub fn left_button_down() -> bool {
        down(VK_LBUTTON)
    }
    pub fn shift_down() -> bool {
        down(VK_SHIFT)
    }
    // Windows ではドラッグ中の中身を安く覗く手段が無いので、ドラッグかどうかまでは判定しない。
    pub fn drag_pasteboard_change_count() -> isize {
        0
    }
    pub fn dragging_files() -> bool {
        true
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod input {
    pub fn left_button_down() -> bool {
        false
    }
    pub fn shift_down() -> bool {
        false
    }
    pub fn drag_pasteboard_change_count() -> isize {
        0
    }
    pub fn dragging_files() -> bool {
        false
    }
}

// ─────────────────── 窓 ───────────────────

pub fn apply_material(window: &WebviewWindow) {
    #[cfg(target_os = "macos")]
    {
        use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};
        let _ = apply_vibrancy(
            window,
            NSVisualEffectMaterial::HudWindow,
            Some(NSVisualEffectState::Active),
            Some(14.0),
        );
    }
    #[cfg(target_os = "windows")]
    {
        use window_vibrancy::{apply_acrylic, apply_mica};
        if apply_mica(window, Some(true)).is_err() {
            let _ = apply_acrylic(window, Some((18, 18, 20, 190)));
        }
    }
}

fn resize(window: &WebviewWindow, (w, h): (f64, f64)) {
    let _ = window.set_size(LogicalSize::new(w, h));
}

/// カーソルのすぐ下。画面外へはみ出さないよう内側へ寄せる。
fn place_near_cursor(app: &AppHandle, window: &WebviewWindow) {
    let (Ok(cursor), Ok(size)) = (app.cursor_position(), window.outer_size()) else {
        return;
    };
    let Some(monitor) = app
        .monitor_from_point(cursor.x, cursor.y)
        .ok()
        .flatten()
        .or_else(|| app.primary_monitor().ok().flatten())
    else {
        return;
    };

    let m_pos = monitor.position();
    let m_size = monitor.size();
    let (w, h) = (size.width as i32, size.height as i32);

    let mut x = cursor.x as i32 - w / 2;
    let mut y = cursor.y as i32 + CURSOR_OFFSET;
    x = x.clamp(m_pos.x + 8, m_pos.x + m_size.width as i32 - w - 8);
    if y + h > m_pos.y + m_size.height as i32 - 8 {
        y = cursor.y as i32 - CURSOR_OFFSET - h;
    }
    y = y.clamp(m_pos.y + 8, m_pos.y + m_size.height as i32 - h - 8);
    let _ = window.set_position(PhysicalPosition::new(x, y));
}

/// 画面右端の中央。一覧として初めて開くときだけ使う。
fn place_at_edge(app: &AppHandle, window: &WebviewWindow) {
    let Ok(size) = window.outer_size() else { return };
    let Some(monitor) = app
        .cursor_position()
        .ok()
        .and_then(|c| app.monitor_from_point(c.x, c.y).ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten())
    else {
        return;
    };
    let pos = monitor.position();
    let m = monitor.size();
    let x = pos.x + m.width as i32 - size.width as i32 - EDGE_MARGIN;
    let y = pos.y + (m.height as i32 - size.height as i32) / 2;
    let _ = window.set_position(PhysicalPosition::new(x, y));
}

/// ドロップ待ちの姿でカーソルの下に出す。
fn show_for_drop(app: &AppHandle) {
    let Some(window) = app.get_webview_window(SHELF) else {
        return;
    };
    #[cfg(target_os = "macos")]
    {
        let _ = app.show();
    }
    resize(&window, DROP_SIZE);
    place_near_cursor(app, &window);
    // フォーカスは絶対に奪わない。奪うとドラッグが途切れる。
    let _ = window.show();
    let _ = window.emit("shelf:mode", "drop");
}

/// 一覧の姿で開く。位置は動かさない（すでに出ている場合はその場で伸びる）。
pub fn show_list(app: &AppHandle) {
    let Some(window) = app.get_webview_window(SHELF) else {
        return;
    };
    #[cfg(target_os = "macos")]
    {
        let _ = app.show();
    }
    let was_visible = window.is_visible().unwrap_or(false);
    resize(&window, LIST_SIZE);
    if !was_visible && !PLACED.swap(true, Ordering::Relaxed) {
        place_at_edge(app, &window);
    }
    KEEP_OPEN.store(true, Ordering::Relaxed);
    let _ = window.show();
    let _ = window.emit("shelf:mode", "list");
}

pub fn hide(app: &AppHandle) {
    KEEP_OPEN.store(false, Ordering::Relaxed);
    if let Some(window) = app.get_webview_window(SHELF) {
        let _ = window.hide();
    }
}

pub fn toggle(app: &AppHandle) {
    let Some(window) = app.get_webview_window(SHELF) else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        hide(app);
    } else {
        show_list(app);
    }
}

/// カーソルが窓のどちら側にあるか。窓の外なら None。
///
/// ドロップイベントに付く座標は使わない。物理ピクセルか論理ピクセルかが環境で変わりうるうえ、
/// 比較相手と単位が揃っている保証がない（実際それで左しか当たらなかった）。
/// カーソルも窓の矩形も同じ API 群から物理座標で取れば、換算そのものが要らなくなる。
fn side_under_cursor(app: &AppHandle) -> Option<&'static str> {
    let window = app.get_webview_window(SHELF)?;
    let pos = window.outer_position().ok()?;
    let size = window.outer_size().ok()?;
    let cursor = app.cursor_position().ok()?;

    let left = pos.x as f64;
    let top = pos.y as f64;
    if cursor.x < left
        || cursor.x > left + size.width as f64
        || cursor.y < top
        || cursor.y > top + size.height as f64
    {
        return None;
    }
    Some(if cursor.x < left + size.width as f64 / 2.0 {
        "library"
    } else {
        "shelf"
    })
}

// ─────────────────── Shift ドラッグの見張り ───────────────────

pub fn start_watching(app: &AppHandle) {
    if WATCHING.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();

    std::thread::spawn(move || {
        let mut shown_for_this_drag = false;
        let mut last_side: Option<&'static str> = None;
        // ボタンを押した瞬間のドラッグ用ペーストボードの世代。
        // これが増えたら「押してからドラッグが始まった」＝ドラッグ中と分かる。
        let mut baseline: Option<isize> = None;

        loop {
            if !WATCHING.load(Ordering::Relaxed) {
                break;
            }

            if input::left_button_down() {
                let base = *baseline.get_or_insert_with(input::drag_pasteboard_change_count);

                // 単なる Shift+クリックで開かないよう、実際にファイルを掴んでいるときだけ反応する。
                // 自前のドラッグ（Shelf からの取り出し）は除く。
                let dragging_files = input::drag_pasteboard_change_count() != base
                    && input::dragging_files()
                    && !OWN_DRAG.load(Ordering::Relaxed);

                if !shown_for_this_drag && dragging_files && input::shift_down() {
                    shown_for_this_drag = true;
                    let handle = app.clone();
                    let _ = app.run_on_main_thread(move || show_for_drop(&handle));
                } else if shown_for_this_drag {
                    // どちら側に居るかを送り続ける。フロントはこれだけを見てハイライトする。
                    let side = side_under_cursor(&app);
                    if side != last_side {
                        last_side = side;
                        let _ = app.emit("shelf:side", side);
                    }
                }
            } else if shown_for_this_drag {
                baseline = None;
                shown_for_this_drag = false;
                last_side = None;
                let _ = app.emit("shelf:side", None::<&str>);
                // ドロップイベントがフロントへ届くまで待つ。
                std::thread::sleep(HIDE_DELAY);

                let handle = app.clone();
                let _ = app.run_on_main_thread(move || {
                    if KEEP_OPEN.load(Ordering::Relaxed) {
                        // 預かり中のものがある。小さいドロップ待ちの姿のままにせず一覧へ戻す。
                        show_list(&handle);
                    } else {
                        hide(&handle);
                    }
                });
            }

            if !input::left_button_down() {
                baseline = None;
            }
            std::thread::sleep(POLL_INTERVAL);
        }

        WATCHING.store(false, Ordering::SeqCst);
    });
}

pub fn stop_watching() {
    WATCHING.store(false, Ordering::SeqCst);
}

// ─────────────────── コマンド ───────────────────

#[tauri::command]
pub fn show_shelf(app: AppHandle) {
    show_list(&app);
}

#[tauri::command]
pub fn hide_shelf(app: AppHandle) {
    hide(&app);
}

#[tauri::command]
pub fn toggle_shelf(app: AppHandle) {
    toggle(&app);
}

/// 落とした瞬間にどちら側だったかを確定させる。カーソルはまだ離した位置にある。
#[tauri::command]
pub fn shelf_side(app: AppHandle) -> Option<&'static str> {
    side_under_cursor(&app)
}

/// Stash 自身がドラッグを始めた / 終えた。見張りはこの間反応しない。
#[tauri::command]
pub fn shelf_own_drag(active: bool) {
    OWN_DRAG.store(active, Ordering::Relaxed);
}

/// 処理中・表示中は自動で閉じないでほしい、とフロントが宣言する。
#[tauri::command]
pub fn shelf_keep_open(keep: bool) {
    KEEP_OPEN.store(keep, Ordering::Relaxed);
}

/// Shift ドラッグの見張りを設定から入切する。
#[tauri::command]
pub fn set_shelf_watch(app: AppHandle, enabled: bool) {
    if enabled {
        start_watching(&app);
    } else {
        stop_watching();
    }
}

/// Shelf に預けたので、一覧の姿に伸ばして残す。
#[tauri::command]
pub fn expand_shelf(app: AppHandle) {
    show_list(&app);
}

/// Shelf を残したまま、邪魔になる他の窓だけ引っ込める（まとめてドラッグ時）。
#[tauri::command]
pub fn retreat_for_shelf_drag(app: AppHandle) {
    if let Some(window) = app.get_webview_window(crate::overlay::MANAGER) {
        let _ = window.hide();
    }
    crate::overlay::hide(&app);
    crate::overlay::set_dock_visible(&app, false);
}
