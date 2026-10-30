// Account-sync sign-in support for the desktop app (docs/ACCOUNT_SYNC_DESIGN.md).
//
// - account_secret_*: the Clerk refresh token in the OS keychain (macOS
//   Keychain, Windows Credential Manager, Secret Service on Linux). Only two
//   fixed secret names are accepted, and secrets are never logged or returned
//   in errors.
// - account_oauth_listen / account_oauth_wait: a one-shot loopback listener on
//   127.0.0.1 for the PKCE redirect (RFC 8252 section 7.3). It accepts exactly
//   one GET /callback and returns its query string; the webview checks state.
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::Mutex;
use std::time::{Duration, Instant};

const SERVICE: &str = "com.promptlab.desktop.account-sync";
const ALLOWED_SECRETS: [&str; 2] = ["clerk_refresh_token", "clerk_client_jwt"];

#[derive(Default)]
pub struct LoopbackState(pub Mutex<Option<TcpListener>>);

fn entry(name: &str) -> Result<keyring::Entry, String> {
    if !ALLOWED_SECRETS.contains(&name) {
        return Err("unknown secret".into());
    }
    keyring::Entry::new(SERVICE, name).map_err(|_| "keychain unavailable".to_string())
}

#[tauri::command]
pub fn account_secret_get(name: String) -> Result<Option<String>, String> {
    match entry(&name)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err("keychain read failed".into()),
    }
}

#[tauri::command]
pub fn account_secret_set(name: String, value: String) -> Result<(), String> {
    if value.is_empty() || value.len() > 8192 {
        return Err("invalid secret".into());
    }
    entry(&name)?.set_password(&value).map_err(|_| "keychain write failed".to_string())
}

#[tauri::command]
pub fn account_secret_delete(name: String) -> Result<(), String> {
    match entry(&name)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("keychain delete failed".into()),
    }
}

#[tauri::command]
pub fn account_oauth_listen(state: tauri::State<'_, LoopbackState>) -> Result<u16, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|_| "could not open sign-in listener".to_string())?;
    let port = listener.local_addr().map_err(|_| "could not open sign-in listener".to_string())?.port();
    *state.0.lock().map_err(|_| "listener busy".to_string())? = Some(listener);
    Ok(port)
}

/// Extract the query of a `GET /callback?... HTTP/1.1` request line.
pub fn callback_query(request: &str) -> Option<String> {
    let line = request.lines().next()?;
    let mut parts = line.split(' ');
    if parts.next()? != "GET" {
        return None;
    }
    let target = parts.next()?;
    let query = target.strip_prefix("/callback?")?;
    if query.len() > 4096 {
        return None;
    }
    Some(query.to_string())
}

#[tauri::command]
pub async fn account_oauth_wait(state: tauri::State<'_, LoopbackState>, timeout_seconds: u64) -> Result<String, String> {
    let listener = state.0.lock().map_err(|_| "listener busy".to_string())?.take().ok_or("no sign-in in progress")?;
    let timeout = Duration::from_secs(timeout_seconds.clamp(30, 900));
    tauri::async_runtime::spawn_blocking(move || {
        listener.set_nonblocking(true).map_err(|_| "listener error".to_string())?;
        let started = Instant::now();
        loop {
            match listener.accept() {
                Ok((mut stream, _)) => {
                    let _ = stream.set_nonblocking(false);
                    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
                    let mut buffer = [0u8; 8192];
                    let read = stream.read(&mut buffer).unwrap_or(0);
                    let request = String::from_utf8_lossy(&buffer[..read]).to_string();
                    if let Some(query) = callback_query(&request) {
                        let body = "<!doctype html><meta charset=utf-8><title>Prompt Lab</title><p>Signed in. You can close this tab and return to Prompt Lab.</p>";
                        let _ = write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body);
                        return Ok(query);
                    }
                    let _ = write!(stream, "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    if started.elapsed() > timeout {
                        return Err("sign-in timed out".to_string());
                    }
                    std::thread::sleep(Duration::from_millis(100));
                }
                Err(_) => return Err("listener error".to_string()),
            }
        }
    })
    .await
    .map_err(|_| "listener error".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_only_get_callback() {
        assert_eq!(callback_query("GET /callback?code=a&state=b HTTP/1.1\r\nHost: x\r\n"), Some("code=a&state=b".into()));
        assert_eq!(callback_query("POST /callback?code=a HTTP/1.1"), None);
        assert_eq!(callback_query("GET /other?code=a HTTP/1.1"), None);
        assert_eq!(callback_query(""), None);
    }

    #[test]
    fn rejects_unknown_secret_names() {
        assert!(entry("anything_else").is_err());
    }
}
