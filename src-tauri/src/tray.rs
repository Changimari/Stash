//! メニューバー / タスクトレイの常駐アイコン。
//!
//! 管理画面を閉じても Stash はここから呼び戻せる。macOS では Dock から降りるので、
//! この常駐アイコンが唯一の入口になる。

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::AppHandle;

/// メニューバー用のモノクロ（テンプレート）アイコン。macOS がライト/ダークに応じて着色する。
const TRAY_ICON: &[u8] = include_bytes!("../icons/tray.png");

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let launcher = MenuItem::with_id(app, "launcher", "ランチャーを開く", true, None::<&str>)?;
    let shelf = MenuItem::with_id(app, "shelf", "Shelf を開く", true, None::<&str>)?;
    let library = MenuItem::with_id(app, "library", "ライブラリ…", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Stash を終了", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&launcher, &shelf, &library, &separator, &quit])?;

    let icon = tauri::image::Image::from_bytes(TRAY_ICON)
        .unwrap_or_else(|_| app.default_window_icon().expect("app icon").clone());

    TrayIconBuilder::with_id("stash")
        .icon(icon)
        .icon_as_template(true)
        .tooltip("Stash")
        .menu(&menu)
        // 左クリックはメニューではなくランチャーの開閉に使う
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "launcher" => crate::overlay::show(app),
            "shelf" => crate::shelf::show_list(app),
            "library" => crate::overlay::open_manager(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                crate::overlay::toggle(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}
