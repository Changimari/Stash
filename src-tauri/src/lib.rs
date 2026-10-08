mod db;
mod hotkey;
mod media;
mod overlay;
mod shelf;
mod tray;

use tauri::{Manager, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        // 常駐ランチャーなので二重起動させない。2 回目の起動は「ライブラリを開く」として扱う。
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            overlay::open_manager(app);
        }));
    }

    builder = builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_clipboard::init())
        .plugin(tauri_plugin_drag::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(db::DB_URL, db::migrations())
                .build(),
        );

    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_global_shortcut::Builder::new().build())
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init())
            // 引数なしで登録する。ログイン直後は管理画面を出さずトレイに常駐させたいので、
            // 起動フラグ `--autostart` を見て setup 側で分岐する。
            .plugin(tauri_plugin_autostart::init(
                tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                Some(vec!["--autostart"]),
            ));
    }

    builder
        .invoke_handler(tauri::generate_handler![
            media::generate_thumbnail,
            media::generate_thumbnails,
            media::hash_file,
            media::probe_files,
            media::scan_folder,
            media::load_full_image,
            media::paths_exist,
            media::generic_drag_icon,
            media::default_library_folder,
            media::adopt_files,
            media::delete_managed_files,
            media::trash_files,
            overlay::show_overlay,
            overlay::hide_overlay,
            overlay::retreat_overlay,
            shelf::show_shelf,
            shelf::hide_shelf,
            shelf::toggle_shelf,
            shelf::retreat_for_shelf_drag,
            shelf::shelf_side,
            shelf::shelf_keep_open,
            shelf::shelf_own_drag,
            shelf::set_shelf_watch,
            shelf::expand_shelf,
            overlay::toggle_overlay,
            overlay::show_manager,
            overlay::close_manager,
            overlay::quit_app,
            hotkey::register_hotkeys,
            hotkey::unregister_hotkeys,
        ])
        .setup(|app| {
            let handle = app.handle();

            if let Some(window) = app.get_webview_window(overlay::OVERLAY) {
                overlay::apply_overlay_material(&window);
            }
            if let Some(window) = app.get_webview_window(overlay::MANAGER) {
                overlay::apply_manager_material(&window);
            }
            if let Some(window) = app.get_webview_window(shelf::SHELF) {
                shelf::apply_material(&window);
            }

            #[cfg(desktop)]
            {
                tray::build(handle)?;
                hotkey::register_defaults(handle);
                // ドラッグ中 Shift の見張り。設定で切れる。
                shelf::start_watching(handle);
            }

            // ログイン時の自動起動（--autostart 付き）では管理画面を出さず、
            // 静かにトレイへ常駐する。手動起動のときだけ管理画面を見せる。
            let from_login = std::env::args().any(|arg| arg == "--autostart");
            if from_login {
                if let Some(window) = app.get_webview_window(overlay::MANAGER) {
                    let _ = window.hide();
                }
            }
            overlay::set_dock_visible(handle, !from_login);

            Ok(())
        })
        .on_window_event(|window, event| match event {
            // 管理画面の「閉じる」はアプリ終了ではなく常駐モードへの移行。
            WindowEvent::CloseRequested { api, .. } if window.label() == overlay::MANAGER => {
                api.prevent_close();
                let _ = window.hide();
                overlay::set_dock_visible(window.app_handle(), false);
            }
            // オーバーレイはフォーカスを失ったら消える（§6-5）。
            // 開発中に devtools を触ると即座に消えて調べられないので、
            // STASH_KEEP_OVERLAY=1 のときだけ自動で隠さない。
            WindowEvent::Focused(false) if window.label() == overlay::OVERLAY => {
                if std::env::var("STASH_KEEP_OVERLAY").is_err() {
                    overlay::hide(window.app_handle());
                }
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("Stash の起動に失敗しました");
}
