use crate::library_access::{AgentAccess, AgentConnection, AgentRequest, AgentSummary};
use crate::library_service::{Connection, LibraryService, ServiceStatus};
use serde::Serialize;
use serde_json::Value;
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogResult};
use tauri_plugin_shell::ShellExt;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderSelection {
    selection_id: String,
    location: String,
    inspection: Value,
}

// Only the native picker installs a path. Later migration consumes this review;
// a webview-supplied path must never substitute for the user's selection.
struct PendingSelection {
    review: FolderSelection,
    directory: PathBuf,
    selected_at: std::time::Instant,
}

#[derive(Default)]
pub struct NativeLibrary {
    pub service: Arc<LibraryService>,
    quitting: AtomicBool,
    reviewing: Arc<AtomicBool>,
    selected: Arc<Mutex<Option<PendingSelection>>>,
}

fn runtime(app: &tauri::AppHandle) -> Result<(PathBuf, PathBuf), String> {
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
    Ok((node, entry))
}

impl NativeLibrary {
    pub fn reviewed_selection(&self, selection_id: &str) -> Result<(PathBuf, Value), String> {
        let selected = self.selected.lock().map_err(|_| "SELECTION_UNAVAILABLE")?;
        let value = selected.as_ref().ok_or("SELECTION_UNAVAILABLE")?;
        if value.review.selection_id != selection_id || value.selected_at.elapsed().as_secs() >= 300
        {
            return Err("REVIEW_CHANGED".into());
        }
        Ok((value.directory.clone(), value.review.inspection.clone()))
    }

    // The reviewed migration owner supplies this binding. No start command is
    // exposed until copy/readback and app activation share the same transaction.
    pub fn start_selected(
        &self,
        app: &tauri::AppHandle,
        directory: PathBuf,
        library_id: String,
    ) -> Result<ServiceStatus, String> {
        let (node, entry) = runtime(app)?;
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

struct ReviewGuard(Arc<AtomicBool>);
impl ReviewGuard {
    fn take(state: &NativeLibrary) -> Result<Self, String> {
        state
            .reviewing
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map_err(|_| "REVIEW_BUSY".to_string())?;
        Ok(Self(state.reviewing.clone()))
    }
}
impl Drop for ReviewGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

fn trusted_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    let url = window.url().map_err(|_| "UNTRUSTED_WINDOW")?;
    let local = url.scheme() == "tauri" && url.host_str() == Some("localhost")
        || url.scheme() == "http" && url.host_str() == Some("tauri.localhost");
    let development = cfg!(debug_assertions)
        && url.scheme() == "http"
        && url.host_str() == Some("localhost")
        && url.port() == Some(5173);
    if window.label() != "main" || !(local || development) {
        return Err("UNTRUSTED_WINDOW".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn library_select_folder(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, NativeLibrary>,
) -> Result<Option<FolderSelection>, String> {
    trusted_window(&window)?;
    let runtime = runtime(&app)?;
    if state.service.active() {
        return Err("ALREADY_RUNNING".into());
    }
    let guard = ReviewGuard::take(&state)?;
    let selected = state.selected.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        let Some(path) = app
            .dialog()
            .file()
            .set_title("Choose a PromptLab library folder")
            .set_parent(&window)
            .blocking_pick_folder()
        else {
            return Ok(None);
        };
        let directory = path.into_path().map_err(|_| "INVALID_LIBRARY")?;
        let inspection = LibraryService::inspect_folder(runtime.0, runtime.1, directory.clone())?;
        let mut bytes = [0u8; 16];
        getrandom::fill(&mut bytes).map_err(|_| "RANDOM_UNAVAILABLE")?;
        let review = FolderSelection {
            selection_id: bytes.iter().map(|byte| format!("{byte:02x}")).collect(),
            location: directory.to_string_lossy().into_owned(),
            inspection,
        };
        *selected.lock().map_err(|_| "SELECTION_UNAVAILABLE")? = Some(PendingSelection {
            review: review.clone(),
            directory,
            selected_at: std::time::Instant::now(),
        });
        Ok(Some(review))
    })
    .await
    .map_err(|_| "SELECTION_UNAVAILABLE".to_string())?
}

#[tauri::command]
pub async fn library_agent_access(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, NativeLibrary>,
    library_id: String,
) -> Result<Vec<AgentSummary>, String> {
    trusted_window(&window)?;
    let service = state.service.clone();
    tauri::async_runtime::spawn_blocking(move || service.agent_access(&library_id))
        .await
        .map_err(|_| "SERVICE_UNAVAILABLE".to_string())?
}

#[tauri::command]
pub async fn library_grant_agent(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, NativeLibrary>,
    library_id: String,
    request: AgentRequest,
) -> Result<Option<AgentConnection>, String> {
    trusted_window(&window)?;
    request.validate()?;
    let guard = ReviewGuard::take(&state)?;
    let service = state.service.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        let review = service.access_review(&library_id)?;
        let (scope, allow) = match request.access {
            AgentAccess::ReadOnly => ("Read library content and history. Cannot change the library.", "Allow read access"),
            AgentAccess::ReadWrite => ("Read and change library content. All changes retain history.", "Allow read and write"),
        };
        let message = format!("Client: {}\nLibrary: {}\n\n{}\n\nAccess expires 24 hours after approval. You can revoke it at any time. The credential works only on this computer and cannot be used by a browser.", request.label, review.library_id, scope);
        let result = app.dialog().message(message).title("Allow library access?").parent(&window)
            .buttons(MessageDialogButtons::OkCancelCustom(allow.into(), "Cancel".into())).blocking_show_with_result();
        if result != MessageDialogResult::Custom(allow.into()) { return Ok(None); }
        service.grant_agent(&review, request).map(Some)
    }).await.map_err(|_| "SERVICE_UNAVAILABLE".to_string())?
}

#[tauri::command]
pub async fn library_revoke_agent(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, NativeLibrary>,
    library_id: String,
    client_id: String,
) -> Result<bool, String> {
    trusted_window(&window)?;
    let guard = ReviewGuard::take(&state)?;
    let service = state.service.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        let review = service.access_review(&library_id)?;
        let client = service.agent_access(&library_id)?.into_iter().find(|item| item.id == client_id)
            .ok_or("CLIENT_NOT_FOUND")?;
        let message = format!("Revoke access for {}?\n\nLibrary: {}\n\nThe client will be unable to make new requests. Existing library content and history remain saved.", client.label, review.library_id);
        let result = app.dialog().message(message).title("Revoke library access?").parent(&window)
            .buttons(MessageDialogButtons::OkCancelCustom("Revoke access".into(), "Cancel".into())).blocking_show_with_result();
        if result != MessageDialogResult::Custom("Revoke access".into()) { return Ok(false); }
        service.revoke_agent(&review, &client_id)?;
        Ok(true)
    }).await.map_err(|_| "SERVICE_UNAVAILABLE".to_string())?
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_reviews_are_serialized_and_release_on_cancel_or_failure() {
        let state = NativeLibrary::default();
        let guard = ReviewGuard::take(&state).unwrap();
        assert_eq!(
            ReviewGuard::take(&state).err().as_deref(),
            Some("REVIEW_BUSY")
        );
        drop(guard);
        assert!(ReviewGuard::take(&state).is_ok());
    }

    #[test]
    fn selection_requires_its_exact_unexpired_native_identity() {
        let state = NativeLibrary::default();
        assert!(state.reviewed_selection("invented").is_err());
        let directory = std::env::temp_dir().join("not-created-by-review");
        *state.selected.lock().unwrap() = Some(PendingSelection {
            review: FolderSelection {
                selection_id: "selected".into(),
                location: "reviewed path".into(),
                inspection: serde_json::json!({"libraryId":"fixture"}),
            },
            directory: directory.clone(),
            selected_at: std::time::Instant::now(),
        });
        assert!(state.reviewed_selection("other").is_err());
        assert_eq!(state.reviewed_selection("selected").unwrap().0, directory);
        state.selected.lock().unwrap().as_mut().unwrap().selected_at =
            std::time::Instant::now() - std::time::Duration::from_secs(301);
        assert_eq!(
            state.reviewed_selection("selected").err().as_deref(),
            Some("REVIEW_CHANGED")
        );
    }
}
