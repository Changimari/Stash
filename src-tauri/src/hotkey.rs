//! グローバルホットキーの登録。
//!
//! 登録は Rust 側が持つ。設定 UI から `register_hotkeys` を呼ぶだけで差し替えられ、
//! 窓のライフサイクル（管理画面を閉じた等）に一切影響されない。
//! 競合していた場合はエラー文字列を返すので、設定画面でそのまま再割り当てを促す（§11）。

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

pub const DEFAULT_LAUNCHER: &str = "CmdOrCtrl+Shift+L";
pub const DEFAULT_SHELF: &str = "CmdOrCtrl+Shift+S";

/// どちらか一方が失敗しても、もう一方は生かす。
/// 片方の競合で両方使えなくなるのが一番困る。
#[derive(Serialize, Default)]
pub struct HotkeyResult {
    pub launcher_error: Option<String>,
    pub shelf_error: Option<String>,
}

fn bind(
    app: &AppHandle,
    accelerator: &str,
    action: fn(&AppHandle),
) -> Result<(), String> {
    let shortcut: Shortcut = accelerator
        .parse()
        .map_err(|_| format!("「{accelerator}」はホットキーとして解釈できません"))?;

    app.global_shortcut()
        .on_shortcut(shortcut, move |app, _shortcut, event| {
            // 押した瞬間だけ反応させる。離すときにも来るので明示的に絞る。
            if event.state == ShortcutState::Pressed {
                action(app);
            }
        })
        .map_err(|e| {
            format!("「{accelerator}」を登録できませんでした。他のアプリが使用中の可能性があります（{e}）")
        })
}

fn register(app: &AppHandle, launcher: &str, shelf: &str) -> HotkeyResult {
    // 直前の割り当てを必ず外してから登録する（同じキーの二重登録はエラーになるため）
    let _ = app.global_shortcut().unregister_all();

    HotkeyResult {
        launcher_error: bind(app, launcher, crate::overlay::toggle).err(),
        shelf_error: if shelf.is_empty() {
            None
        } else {
            bind(app, shelf, crate::shelf::toggle).err()
        },
    }
}

#[tauri::command]
pub fn register_hotkeys(app: AppHandle, launcher: String, shelf: String) -> HotkeyResult {
    register(&app, &launcher, &shelf)
}

#[tauri::command]
pub fn unregister_hotkeys(app: AppHandle) {
    let _ = app.global_shortcut().unregister_all();
}

/// 起動直後の保険。フロントが保存済みの設定で上書き登録するまでの間、既定キーを効かせておく。
pub fn register_defaults(app: &AppHandle) {
    let result = register(app, DEFAULT_LAUNCHER, DEFAULT_SHELF);
    for error in [result.launcher_error, result.shelf_error].into_iter().flatten() {
        eprintln!("[stash] 既定ホットキーの登録に失敗: {error}");
    }
}
