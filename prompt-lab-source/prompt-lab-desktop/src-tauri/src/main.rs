// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod diagnostics;
mod diagnostics_store;
pub mod library_access;
pub mod library_native;
pub mod library_service;
use tauri::menu::{Menu, MenuItem, MenuItemKind};
use tauri::{Emitter, Manager};

fn main() {
    let builder = tauri::Builder::default();
    #[cfg(any(target_os = "macos", windows))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _, _| {
        library_native::reopen(app)
    }));
    builder
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            diagnostics::diagnostics_record,
            diagnostics::diagnostics_heartbeat,
            diagnostics::diagnostics_read,
            diagnostics::diagnostics_prepare,
            diagnostics::diagnostics_export,
            diagnostics::diagnostics_open_issue,
            library_native::library_service_status,
            library_native::library_service_connection,
            library_native::library_service_stop,
            library_native::library_select_folder,
            library_native::library_agent_access,
            library_native::library_grant_agent,
            library_native::library_revoke_agent
        ])
        .setup(|app| {
            app.manage(diagnostics::initialize(app.handle()));
            app.manage(library_native::NativeLibrary::default());
            let menu = Menu::default(app.handle())?;
            for item in menu.items()? {
                if let MenuItemKind::Submenu(help) = item {
                    if help.text()? == "Help" {
                        help.append(&MenuItem::with_id(
                            app,
                            "report-problem",
                            "Report a problem…",
                            true,
                            None::<&str>,
                        )?)?;
                        help.append(&MenuItem::with_id(
                            app,
                            "export-diagnostics",
                            "Export diagnostics and open folder",
                            true,
                            None::<&str>,
                        )?)?;
                    }
                }
            }
            app.set_menu(menu)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            if event.id() == "report-problem" {
                let _ = app.emit("promptlab:report-problem", ());
            }
            if event.id() == "export-diagnostics" {
                let result = app.state::<diagnostics::Diagnostics>().export();
                if let Ok(path) = &result {
                    diagnostics::reveal_report(path);
                }
                if let Some(MenuItemKind::MenuItem(item)) =
                    app.menu().and_then(|menu| menu.get("export-diagnostics"))
                {
                    let _ = item.set_text(if result.is_ok() {
                        "Export diagnostics and open folder"
                    } else {
                        "Export failed. Restart and try again"
                    });
                }
                let _ = app.emit("promptlab:native-export", result);
            }
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main"
                    && window
                        .app_handle()
                        .state::<library_native::NativeLibrary>()
                        .service
                        .active()
                {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Prompt Lab")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { code, api, .. } = &event {
                library_native::request_exit(app, *code, api);
            }
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = &event {
                library_native::reopen(app);
            }
            if let tauri::RunEvent::Exit = event {
                app.state::<diagnostics::Diagnostics>().finish();
            }
        });
}
