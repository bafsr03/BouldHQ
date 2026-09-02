#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod desktop;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use desktop::*;
use tauri::Manager;

/// Bring the main window back into view. Used from both paths that can ask for
/// the app after its window was hidden: a second launch (single-instance) and,
/// on macOS, a Dock click on the already-running app (RunEvent::Reopen).
#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn show_main_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        if let Err(e) = window.show() {
            eprintln!("Failed to show window: {}", e);
        }
        if let Err(e) = window.unminimize() {
            eprintln!("Failed to unminimize window: {}", e);
        }
        if let Err(e) = window.set_focus() {
            eprintln!("Failed to focus window: {}", e);
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_upload::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_blinko::init())
        .plugin(tauri_plugin_opener::init());

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        builder = builder
            .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
                // Called when a second instance tries to start
                println!("Second instance detected with args: {:?} and cwd: {:?}", args, cwd);

                // Show and focus the existing window
                show_main_window(app);
            }))
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_handler(create_global_shortcut_handler())
                    .build()
            );
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        builder
            .invoke_handler(tauri::generate_handler![
                toggle_editor_window,
                register_hotkey,
                unregister_hotkey,
                get_registered_shortcuts,
                toggle_quicknote_window,
                resize_quicknote_window,
                toggle_quickai_window,
                resize_quickai_window,
                navigate_main_to_ai_with_prompt,
                toggle_quicktool_window,
                hide_quicktool_window,
                setup_text_selection_monitoring,
                copy_to_clipboard,
                test_text_selection,
                check_accessibility_permissions,
                show_quicktool,
                set_desktop_theme,
                set_desktop_colors
            ])
            .setup(|app| {
                #[cfg(not(any(target_os = "android", target_os = "ios")))]
                {
                    use tauri_plugin_autostart::MacosLauncher;

                    let _ = app.handle().plugin(tauri_plugin_autostart::init(
                        MacosLauncher::LaunchAgent,
                        Some(vec!["--autostart"]),
                    ));
                }

                setup_app(app)?;
                Ok(())
            })
            .build(tauri::generate_context!())
            .expect("error while building tauri application")
            .run(|app, event| {
                // Closing the window only hides it (see desktop::window and
                // desktop::setup — both prevent_close then hide), so the app
                // keeps running with no visible window. On macOS, clicking the
                // Dock icon of a *running* app doesn't spawn a second process,
                // so the single-instance callback above never fires and the
                // click was silently doing nothing. macOS sends Reopen instead.
                #[cfg(target_os = "macos")]
                if let tauri::RunEvent::Reopen { .. } = event {
                    show_main_window(app);
                }
                let _ = (app, event);
            });
    }

    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        builder
            .invoke_handler(tauri::generate_handler![])
            .setup(|_app| {
                Ok(())
            })
            .run(tauri::generate_context!())
            .expect("error while running tauri application");
    }
}