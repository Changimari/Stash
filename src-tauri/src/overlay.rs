//! オーバーレイ窓の見た目と挙動（§5 マテリアル / §6 UXフロー / §11 落とし穴）。
//!
//! - 背景は **ネイティブ** のすりガラス（macOS: NSVisualEffectView / Windows: Mica・Acrylic）。
//!   CSS の backdrop-filter では偽装しない。
//! - 表示はカーソルのあるディスプレイ基準。Spotlight と同じく画面中央よりやや上に出す。
//! - 常駐アプリなので窓は破棄せず hide/show で回す。

use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewWindow};

pub const OVERLAY: &str = "overlay";
pub const MANAGER: &str = "main";

/// 画面の縦のどのあたりに出すか。0.5 だと重心が下がって見えるので少し上げる。
const VERTICAL_ANCHOR: f64 = 0.32;

/// 窓の角丸。CSS 側（--radius-window）と必ず揃えること。
const WINDOW_RADIUS: f64 = 16.0;

// ────────────────────────── vibrancy ──────────────────────────

/// オーバーレイ窓へネイティブのすりガラスを適用する。
/// 非対応環境（Windows 10 の古いビルドなど）では失敗を握りつぶし、
/// フロントの `--material-fallback` による不透明背景に任せる（§11）。
pub fn apply_overlay_material(window: &WebviewWindow) {
    #[cfg(target_os = "macos")]
    {
        use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};
        let _ = apply_vibrancy(
            window,
            // HudWindow は Spotlight / Quick Look に最も近い暗めのマテリアル
            NSVisualEffectMaterial::HudWindow,
            Some(NSVisualEffectState::Active),
            Some(WINDOW_RADIUS),
        );
    }

    #[cfg(target_os = "windows")]
    {
        use window_vibrancy::{apply_acrylic, apply_mica};
        // Windows 11 は Mica、届かなければ Acrylic、どちらも駄目なら CSS フォールバック
        if apply_mica(window, Some(true)).is_err() {
            let _ = apply_acrylic(window, Some((18, 18, 20, 190)));
        }
    }

    let _ = window.emit("window:material", material_kind());
}

/// 管理画面はサイドバーだけがすりガラスになる Apple の定番レイアウト。
/// 窓全体に vibrancy を敷き、コンテンツ側を CSS で不透明に塗ることで実現する。
pub fn apply_manager_material(window: &WebviewWindow) {
    #[cfg(target_os = "macos")]
    {
        use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};
        let _ = apply_vibrancy(
            window,
            NSVisualEffectMaterial::Sidebar,
            Some(NSVisualEffectState::FollowsWindowActiveState),
            None,
        );
    }

    #[cfg(target_os = "windows")]
    {
        use window_vibrancy::apply_mica;
        let _ = apply_mica(window, None);
    }

    let _ = window.emit("window:material", material_kind());
}

fn material_kind() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        "vibrancy"
    }
    #[cfg(target_os = "windows")]
    {
        "mica"
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        "opaque"
    }
}

// ────────────────────────── 配置 ──────────────────────────

/// カーソルのあるディスプレイの、中央やや上に配置する。
/// マルチモニタで「いま見ている画面」に出るかどうかは体感差が大きい。
fn place_on_active_monitor(app: &AppHandle, window: &WebviewWindow) {
    let Ok(size) = window.outer_size() else { return };

    let monitor = app
        .cursor_position()
        .ok()
        .and_then(|cursor| app.monitor_from_point(cursor.x, cursor.y).ok().flatten())
        .or_else(|| window.current_monitor().ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());

    let Some(monitor) = monitor else { return };
    let m_pos = monitor.position();
    let m_size = monitor.size();

    let x = m_pos.x + (m_size.width as i32 - size.width as i32) / 2;
    let y = m_pos.y + ((m_size.height as f64 - size.height as f64) * VERTICAL_ANCHOR) as i32;
    let _ = window.set_position(PhysicalPosition::new(x, y));
}

// ────────────────────────── 表示制御 ──────────────────────────

pub fn show(app: &AppHandle) {
    let Some(window) = app.get_webview_window(OVERLAY) else {
        return;
    };
    // ドラッグのために app.hide() した後でも呼び出せるようにしておく。
    // 隠していない場合は何も起きない。
    #[cfg(target_os = "macos")]
    {
        let _ = app.show();
    }
    place_on_active_monitor(app, &window);
    let _ = window.show();
    let _ = window.set_focus();
    // フロント側は検索欄のクリアとフォーカスをこのイベントで行う
    let _ = window.emit("overlay:shown", ());
}

pub fn hide(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(OVERLAY) {
        let _ = window.hide();
        let _ = window.emit("overlay:hidden", ());
    }
}

/// 他アプリへドラッグを始めるときに Stash を完全に引っ込める。
///
/// オーバーレイを隠すだけでは足りない。Stash はまだ「最前面のアプリ」のままなので、
/// 開いていた管理画面が繰り上がってドロップ先の上に出てしまう。
/// 順番が重要で、**先に管理画面を隠してから** アプリを隠すこと。逆にすると
/// macOS が「隠す直前に見えていた窓」として管理画面を記憶し、復帰時に一緒に出てくる。
pub fn retreat_for_drag(app: &AppHandle) {
    hide(app);

    if let Some(window) = app.get_webview_window(MANAGER) {
        let _ = window.hide();
    }
    set_dock_visible(app, false);

    // アプリ自体を隠して、直前に使っていたアプリへ活性を返す。
    // Windows にはアプリ単位で隠す仕組みが無いが、上でウィンドウを全部隠しているので
    // ドロップ先が覆われることはない（フォーカスだけ Stash に残る）。
    #[cfg(target_os = "macos")]
    {
        let _ = app.hide();
    }
}

pub fn toggle(app: &AppHandle) {
    let Some(window) = app.get_webview_window(OVERLAY) else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        hide(app);
    } else {
        show(app);
    }
}

/// 管理画面を前面に出す。macOS では Dock に載る通常アプリへ昇格させる。
pub fn open_manager(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    {
        let _ = app.show();
    }
    set_dock_visible(app, true);
    if let Some(window) = app.get_webview_window(MANAGER) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// 管理画面が閉じられたら Dock から降りて常駐エージェントに戻る（Alfred / Raycast と同じ流儀）。
/// これをやらないと、オーバーレイを出すたびに Dock 上でアプリが切り替わって落ち着かない。
pub fn set_dock_visible(app: &AppHandle, visible: bool) {
    #[cfg(target_os = "macos")]
    {
        let policy = if visible {
            tauri::ActivationPolicy::Regular
        } else {
            tauri::ActivationPolicy::Accessory
        };
        let _ = app.set_activation_policy(policy);
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, visible);
    }
}

// ────────────────────────── コマンド ──────────────────────────

#[tauri::command]
pub fn show_overlay(app: AppHandle) {
    show(&app);
}

#[tauri::command]
pub fn hide_overlay(app: AppHandle) {
    hide(&app);
}

#[tauri::command]
pub fn retreat_overlay(app: AppHandle) {
    retreat_for_drag(&app);
}

#[tauri::command]
pub fn toggle_overlay(app: AppHandle) {
    toggle(&app);
}

#[tauri::command]
pub fn show_manager(app: AppHandle) {
    open_manager(&app);
}

/// 管理画面を閉じてもプロセスは残す（ランチャーとして常駐し続ける）。
#[tauri::command]
pub fn close_manager(app: AppHandle) {
    if let Some(window) = app.get_webview_window(MANAGER) {
        let _ = window.hide();
    }
    set_dock_visible(&app, false);
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}
