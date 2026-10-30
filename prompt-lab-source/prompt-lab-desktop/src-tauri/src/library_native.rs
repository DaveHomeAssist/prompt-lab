use crate::library_service::{Connection, LibraryService, ServiceStatus};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tauri::{Emitter, Manager};
use tauri_plugin_shell::ShellExt;

#[derive(Default)]
pub struct NativeLibrary {
    pub service: Arc<LibraryService>,
    quitting: AtomicBool,
}

impl NativeLibrary {
    // The later native picker supplies this binding after its explicit review.
    // JavaScript cannot invoke an arbitrary executable or directory through it.
    pub fn start_selected(
        &self,
        app: &tauri::AppHandle,
        directory: std::path::PathBuf,
        library_id: String,
    ) -> Result<ServiceStatus, String> {
        if !cfg!(target_os = "macos") {
            // Windows directory fsync fails; Linux secure storage is not qualified.
            // Keep both unavailable until their actual platform gates pass.
            return Err("PLATFORM_NOT_QUALIFIED".into());
        }
        let command: std::process::Command = app
            .shell()
            .sidecar("promptlab-node")
            .map_err(|_| "RUNTIME_UNAVAILABLE".to_string())?
            .into();
        let node = std::path::PathBuf::from(command.get_program());
        let entry = app
            .path()
            .resolve(
                "library-helper/worker.mjs",
                tauri::path::BaseDirectory::Resource,
            )
            .map_err(|_| "RUNTIME_UNAVAILABLE".to_string())?;
        let local = app
            .path()
            .app_local_data_dir()
            .map_err(|_| "OWNERSHIP_UNAVAILABLE".to_string())?;
        std::fs::create_dir_all(&local).map_err(|_| "OWNERSHIP_UNAVAILABLE".to_string())?;
        self.service.start(
            node,
            entry,
            directory,
            library_id,
            local.join("library-service.lock"),
        )
    }
}

#[tauri::command]
pub async fn library_service_status(
    state: tauri::State<'_, NativeLibrary>,
) -> Result<ServiceStatus, String> {
    let service = state.service.clone();
    tauri::async_runtime::spawn_blocking(move || service.status())
        .await
        .map_err(|_| "SERVICE_UNAVAILABLE".to_string())?
}

#[tauri::command]
pub async fn library_service_connection(
    state: tauri::State<'_, NativeLibrary>,
) -> Result<Connection, String> {
    let service = state.service.clone();
    tauri::async_runtime::spawn_blocking(move || service.connection())
        .await
        .map_err(|_| "SERVICE_UNAVAILABLE".to_string())?
}

#[tauri::command]
pub async fn library_service_stop(state: tauri::State<'_, NativeLibrary>) -> Result<(), String> {
    let service = state.service.clone();
    tauri::async_runtime::spawn_blocking(move || service.stop())
        .await
        .map_err(|_| "SERVICE_UNAVAILABLE".to_string())?
}

pub fn request_exit(app: &tauri::AppHandle, code: Option<i32>, api: &tauri::ExitRequestApi) {
    let state = app.state::<NativeLibrary>();
    if !state.service.active() {
        return;
    }
    api.prevent_exit();
    if state.quitting.swap(true, Ordering::SeqCst) {
        return;
    }
    let service = state.service.clone();
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let result = tauri::async_runtime::spawn_blocking(move || service.stop()).await;
        if matches!(result, Ok(Ok(()))) {
            app.exit(code.unwrap_or(0));
        } else {
            app.state::<NativeLibrary>()
                .quitting
                .store(false, Ordering::SeqCst);
            // Do not kill a helper that may still be finishing an accepted write.
            let _ = app.emit("promptlab:library-service-error", "STOP_PENDING");
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
    });
}

pub fn reopen(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}
