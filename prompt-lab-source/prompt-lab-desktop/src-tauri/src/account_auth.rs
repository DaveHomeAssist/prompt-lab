// Account-sync sign-in for the desktop app (docs/ACCOUNT_SYNC_DESIGN.md).
//
// The whole OAuth 2.0 authorization-code + PKCE (S256) flow runs here in Rust,
// with a loopback redirect on 127.0.0.1 (RFC 8252 section 7.3):
//
// - account_oauth_begin: makes the PKCE verifier and state, opens the loopback
//   listener and returns only the authorize URL (the webview opens it in the
//   system browser).
// - account_oauth_finish: waits for the redirect. Requests on any other path,
//   or with a missing or wrong state, are answered (404 / 400) and ignored; the
//   listener keeps waiting until the real callback or the timeout. The code is
//   exchanged here, the refresh token goes straight into the OS keychain, and
//   only a short-lived access token is returned.
// - account_access_token: refreshes from the keychain (rotating the stored
//   refresh token) and returns only a short-lived access token.
// - account_sign_out: deletes the keychain entry.
//
// The webview never sees the PKCE verifier, the authorization code or the
// refresh token, and there is no command that reads the keychain. Secrets are
// never logged or put in error strings.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub const CLERK_ORIGIN: &str = "https://clerk.promptlab.tools";
const SERVICE: &str = "com.promptlab.desktop.account-sync";
const REFRESH_SECRET: &str = "clerk_refresh_token";
const SCOPE: &str = "openid profile email offline_access";

/// Where the refresh token lives. The app uses the OS keychain; tests use memory.
pub trait SecretStore {
    fn get(&self) -> Result<Option<String>, String>;
    fn set(&self, value: &str) -> Result<(), String>;
    fn delete(&self) -> Result<(), String>;
}

/// macOS Keychain, Windows Credential Manager, Secret Service on Linux.
pub struct Keychain;

impl Keychain {
    fn entry() -> Result<keyring::Entry, String> {
        keyring::Entry::new(SERVICE, REFRESH_SECRET).map_err(|_| "keychain unavailable".to_string())
    }
}

impl SecretStore for Keychain {
    fn get(&self) -> Result<Option<String>, String> {
        match Self::entry()?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err("keychain read failed".into()),
        }
    }
    fn set(&self, value: &str) -> Result<(), String> {
        if value.is_empty() || value.len() > 8192 {
            return Err("invalid secret".into());
        }
        Self::entry()?.set_password(value).map_err(|_| "keychain write failed".to_string())
    }
    fn delete(&self) -> Result<(), String> {
        match Self::entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err("keychain delete failed".into()),
        }
    }
}

/// What the webview gets: a short-lived access token and its lifetime.
#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct AccessToken {
    pub access_token: String,
    pub expires_in: u64,
}

pub struct Pending {
    listener: TcpListener,
    verifier: String,
    state: String,
    redirect_uri: String,
    client_id: String,
    token_url: String,
}

#[derive(Default)]
pub struct SignInState(pub Mutex<Option<Pending>>);

/// One refresh at a time, so a rotated refresh token is never lost to a race.
static REFRESH_LOCK: Mutex<()> = Mutex::new(());

fn random_b64(len: usize) -> Result<String, String> {
    let mut bytes = vec![0u8; len];
    getrandom::getrandom(&mut bytes).map_err(|_| "random source unavailable".to_string())?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

pub fn pkce_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

pub fn valid_client_id(client_id: &str) -> bool {
    !client_id.is_empty() && client_id.len() <= 128 && client_id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// Start a sign-in: PKCE pair, state, loopback listener and the authorize URL.
pub fn begin(origin: &str, client_id: &str) -> Result<(Pending, String), String> {
    if !valid_client_id(client_id) {
        return Err("invalid client id".into());
    }
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|_| "could not open sign-in listener".to_string())?;
    let port = listener.local_addr().map_err(|_| "could not open sign-in listener".to_string())?.port();
    let redirect_uri = format!("http://127.0.0.1:{port}/callback");
    let verifier = random_b64(32)?;
    let state = random_b64(16)?;
    let url = url::Url::parse_with_params(
        &format!("{origin}/oauth/authorize"),
        &[
            ("response_type", "code"),
            ("client_id", client_id),
            ("redirect_uri", redirect_uri.as_str()),
            ("scope", SCOPE),
            ("code_challenge", pkce_challenge(&verifier).as_str()),
            ("code_challenge_method", "S256"),
            ("state", state.as_str()),
        ],
    )
    .map_err(|_| "invalid sign-in origin".to_string())?;
    let pending = Pending { listener, verifier, state, redirect_uri, client_id: client_id.to_string(), token_url: format!("{origin}/oauth/token") };
    Ok((pending, url.to_string()))
}

#[derive(Debug, PartialEq)]
pub enum Callback {
    /// The real redirect: matching state and a code.
    Code(String),
    /// The real redirect, but the user or Clerk refused.
    Denied,
    /// Anything else: answer with this HTTP status and keep listening.
    Ignore(u16),
}

fn same(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// Classify one HTTP request read from the loopback socket.
pub fn classify_request(request: &str, expected_state: &str) -> Callback {
    let Some(line) = request.lines().next() else { return Callback::Ignore(400) };
    let mut parts = line.split(' ');
    if parts.next() != Some("GET") {
        return Callback::Ignore(404);
    }
    let Some(target) = parts.next() else { return Callback::Ignore(400) };
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    if path != "/callback" {
        return Callback::Ignore(404);
    }
    if query.len() > 4096 {
        return Callback::Ignore(400);
    }
    let mut state = None;
    let mut code = None;
    let mut error = false;
    for (key, value) in url::form_urlencoded::parse(query.as_bytes()) {
        match key.as_ref() {
            "state" => state = Some(value.into_owned()),
            "code" => code = Some(value.into_owned()),
            "error" => error = true,
            _ => {}
        }
    }
    match state {
        Some(ref s) if !expected_state.is_empty() && same(s, expected_state) => {}
        _ => return Callback::Ignore(400),
    }
    if error {
        return Callback::Denied;
    }
    match code {
        Some(c) if !c.is_empty() && c.len() <= 2048 => Callback::Code(c),
        _ => Callback::Ignore(400),
    }
}

fn respond(stream: &mut std::net::TcpStream, status: u16, body: &str) {
    let reason = match status { 200 => "OK", 400 => "Bad Request", _ => "Not Found" };
    let _ = write!(
        stream,
        "HTTP/1.1 {status} {reason}\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
}

/// Read an HTTP request head (up to the blank line, at most 8 KiB, 5 s).
fn read_request_head(stream: &mut std::net::TcpStream) -> String {
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let mut buffer = vec![0u8; 8192];
    let mut total = 0;
    while total < buffer.len() {
        match stream.read(&mut buffer[total..]) {
            Ok(0) => break,
            Ok(n) => {
                total += n;
                if buffer[..total].windows(4).any(|w| w == b"\r\n\r\n") {
                    break;
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => break,
        }
    }
    String::from_utf8_lossy(&buffer[..total]).to_string()
}

/// Wait for the real redirect until `timeout`. Ignores (and answers) requests
/// on other paths and requests with a missing or wrong state.
pub fn wait_for_code(listener: &TcpListener, expected_state: &str, timeout: Duration) -> Result<String, String> {
    listener.set_nonblocking(true).map_err(|_| "listener error".to_string())?;
    let started = Instant::now();
    loop {
        match listener.accept() {
            Ok((mut stream, _)) => {
                let request = read_request_head(&mut stream);
                match classify_request(&request, expected_state) {
                    Callback::Code(code) => {
                        respond(&mut stream, 200, "<!doctype html><meta charset=utf-8><title>Prompt Lab</title><p>Signed in. You can close this tab and return to Prompt Lab.</p>");
                        return Ok(code);
                    }
                    Callback::Denied => {
                        respond(&mut stream, 200, "<!doctype html><meta charset=utf-8><title>Prompt Lab</title><p>Sign-in was cancelled. You can close this tab.</p>");
                        return Err("sign-in was cancelled".into());
                    }
                    Callback::Ignore(status) => respond(&mut stream, status, ""),
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                if started.elapsed() > timeout {
                    return Err("sign-in timed out".into());
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(_) => return Err("listener error".into()),
        }
    }
}

#[derive(Debug, PartialEq)]
pub enum TokenError {
    /// The grant was refused (400/401): the stored refresh token is no good.
    Rejected,
    Failed(String),
}

pub struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: u64,
}

pub fn token_request(token_url: &str, form: &[(&str, &str)]) -> Result<TokenResponse, TokenError> {
    let response = ureq::post(token_url)
        .timeout(Duration::from_secs(20))
        .set("Accept", "application/json")
        .send_form(form);
    let response = match response {
        Ok(response) => response,
        Err(ureq::Error::Status(400, _)) | Err(ureq::Error::Status(401, _)) => return Err(TokenError::Rejected),
        Err(ureq::Error::Status(_, _)) => return Err(TokenError::Failed("sign-in service error".into())),
        Err(_) => return Err(TokenError::Failed("sign-in service unreachable".into())),
    };
    let body: serde_json::Value = response.into_json().map_err(|_| TokenError::Failed("sign-in returned an invalid response".into()))?;
    let access_token = body.get("access_token").and_then(|v| v.as_str()).filter(|v| !v.is_empty())
        .ok_or_else(|| TokenError::Failed("sign-in returned no access token".into()))?.to_string();
    let refresh_token = body.get("refresh_token").and_then(|v| v.as_str()).filter(|v| !v.is_empty()).map(str::to_string);
    let expires_in = body.get("expires_in").and_then(|v| v.as_u64()).unwrap_or(0);
    Ok(TokenResponse { access_token, refresh_token, expires_in })
}

/// Exchange the code; keep the refresh token; return only the access token.
pub fn complete(pending: &Pending, code: &str, store: &dyn SecretStore) -> Result<AccessToken, String> {
    let tokens = token_request(&pending.token_url, &[
        ("grant_type", "authorization_code"),
        ("code", code),
        ("code_verifier", pending.verifier.as_str()),
        ("client_id", pending.client_id.as_str()),
        ("redirect_uri", pending.redirect_uri.as_str()),
    ])
    .map_err(|error| match error { TokenError::Rejected => "sign-in was refused".to_string(), TokenError::Failed(message) => message })?;
    if let Some(refresh) = tokens.refresh_token.as_deref() {
        store.set(refresh)?;
    }
    Ok(AccessToken { access_token: tokens.access_token, expires_in: tokens.expires_in })
}

/// Fresh access token from the stored refresh token. None means "sign in again"
/// (no token stored, or Clerk refused it, in which case it is deleted).
pub fn refresh(token_url: &str, client_id: &str, store: &dyn SecretStore) -> Result<Option<AccessToken>, String> {
    if !valid_client_id(client_id) {
        return Err("invalid client id".into());
    }
    let _guard = REFRESH_LOCK.lock().map_err(|_| "refresh busy".to_string())?;
    let Some(current) = store.get()? else { return Ok(None) };
    match token_request(token_url, &[("grant_type", "refresh_token"), ("refresh_token", current.as_str()), ("client_id", client_id)]) {
        Ok(tokens) => {
            if let Some(rotated) = tokens.refresh_token.as_deref() {
                if rotated != current {
                    store.set(rotated)?;
                }
            }
            Ok(Some(AccessToken { access_token: tokens.access_token, expires_in: tokens.expires_in }))
        }
        Err(TokenError::Rejected) => {
            store.delete()?;
            Ok(None)
        }
        Err(TokenError::Failed(message)) => Err(message),
    }
}

// ---- Tauri commands ----
#[tauri::command]
pub fn account_oauth_begin(state: tauri::State<'_, SignInState>, client_id: String) -> Result<String, String> {
    let (pending, url) = begin(CLERK_ORIGIN, &client_id)?;
    *state.0.lock().map_err(|_| "sign-in busy".to_string())? = Some(pending);
    Ok(url)
}

#[tauri::command]
pub async fn account_oauth_finish(state: tauri::State<'_, SignInState>, timeout_seconds: u64) -> Result<AccessToken, String> {
    let pending = state.0.lock().map_err(|_| "sign-in busy".to_string())?.take().ok_or("no sign-in in progress")?;
    let timeout = Duration::from_secs(timeout_seconds.clamp(30, 900));
    tauri::async_runtime::spawn_blocking(move || {
        let code = wait_for_code(&pending.listener, &pending.state, timeout)?;
        complete(&pending, &code, &Keychain)
    })
    .await
    .map_err(|_| "sign-in error".to_string())?
}

#[tauri::command]
pub async fn account_access_token(client_id: String) -> Result<Option<AccessToken>, String> {
    tauri::async_runtime::spawn_blocking(move || refresh(&format!("{CLERK_ORIGIN}/oauth/token"), &client_id, &Keychain))
        .await
        .map_err(|_| "sign-in error".to_string())?
}

#[tauri::command]
pub fn account_sign_out() -> Result<(), String> {
    Keychain.delete()
}
// ---- end Tauri commands ----

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::net::TcpStream;

    struct MemoryStore(RefCell<Option<String>>);
    impl SecretStore for MemoryStore {
        fn get(&self) -> Result<Option<String>, String> { Ok(self.0.borrow().clone()) }
        fn set(&self, value: &str) -> Result<(), String> { *self.0.borrow_mut() = Some(value.to_string()); Ok(()) }
        fn delete(&self) -> Result<(), String> { *self.0.borrow_mut() = None; Ok(()) }
    }

    fn get(port: u16, target: &str) -> String {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
        write!(stream, "GET {target} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n").unwrap();
        let mut out = String::new();
        stream.read_to_string(&mut out).unwrap();
        out.lines().next().unwrap_or("").to_string()
    }

    /// One-shot HTTP server that answers a single POST with `status` and `body`
    /// and hands back the request it saw.
    fn token_server(status: u16, body: &'static str) -> (String, std::thread::JoinHandle<String>) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let url = format!("http://127.0.0.1:{}/oauth/token", listener.local_addr().unwrap().port());
        let handle = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
            let mut buffer = vec![0u8; 16384];
            let mut total = 0;
            loop {
                let n = stream.read(&mut buffer[total..]).unwrap_or(0);
                total += n;
                let text = String::from_utf8_lossy(&buffer[..total]).to_string();
                if let Some(split) = text.find("\r\n\r\n") {
                    let length = text.lines().find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap_or(0))).unwrap_or(0);
                    if total >= split + 4 + length { break; }
                }
                if n == 0 { break; }
            }
            write!(stream, "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
            String::from_utf8_lossy(&buffer[..total]).to_string()
        });
        (url, handle)
    }

    #[test]
    fn classifies_callback_requests() {
        assert_eq!(classify_request("GET /callback?code=a&state=s1 HTTP/1.1\r\nHost: x\r\n", "s1"), Callback::Code("a".into()));
        assert_eq!(classify_request("GET /callback?code=a&state=evil HTTP/1.1", "s1"), Callback::Ignore(400));
        assert_eq!(classify_request("GET /callback?code=a HTTP/1.1", "s1"), Callback::Ignore(400));
        assert_eq!(classify_request("GET /callback?state=s1 HTTP/1.1", "s1"), Callback::Ignore(400));
        assert_eq!(classify_request("GET /callback?error=access_denied&state=s1 HTTP/1.1", "s1"), Callback::Denied);
        assert_eq!(classify_request("GET /callback?error=access_denied&state=evil HTTP/1.1", "s1"), Callback::Ignore(400));
        assert_eq!(classify_request("GET /favicon.ico HTTP/1.1", "s1"), Callback::Ignore(404));
        assert_eq!(classify_request("GET /callbackX?code=a&state=s1 HTTP/1.1", "s1"), Callback::Ignore(404));
        assert_eq!(classify_request("POST /callback?code=a&state=s1 HTTP/1.1", "s1"), Callback::Ignore(404));
        assert_eq!(classify_request("GET /callback?code=a&state=s1 HTTP/1.1", ""), Callback::Ignore(400));
        assert_eq!(classify_request("", "s1"), Callback::Ignore(400));
    }

    #[test]
    fn r05_listener_ignores_wrong_path_and_bad_state_then_takes_the_real_callback() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let waiter = std::thread::spawn(move || wait_for_code(&listener, "good-state", Duration::from_secs(10)));
        std::thread::sleep(Duration::from_millis(100));
        assert!(get(port, "/favicon.ico").contains("404"));
        assert!(get(port, "/callback?code=attacker&state=wrong").contains("400"));
        assert!(get(port, "/callback?code=attacker").contains("400"));
        assert!(get(port, "/other?code=attacker&state=good-state").contains("404"));
        assert!(get(port, "/callback?code=real-code&state=good-state").contains("200"));
        assert_eq!(waiter.join().unwrap(), Ok("real-code".to_string()));
    }

    #[test]
    fn r05_listener_times_out_when_only_bad_requests_arrive() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let waiter = std::thread::spawn(move || wait_for_code(&listener, "good-state", Duration::from_millis(800)));
        std::thread::sleep(Duration::from_millis(100));
        assert!(get(port, "/callback?code=x&state=bad").contains("400"));
        assert_eq!(waiter.join().unwrap(), Err("sign-in timed out".to_string()));
    }

    #[test]
    fn begin_builds_a_pkce_authorize_url_and_rejects_odd_client_ids() {
        let (pending, url) = begin("https://clerk.example.test", "client_ABC-1").unwrap();
        let parsed = url::Url::parse(&url).unwrap();
        let q: std::collections::HashMap<_, _> = parsed.query_pairs().into_owned().collect();
        assert_eq!(parsed.path(), "/oauth/authorize");
        assert_eq!(q["code_challenge"], pkce_challenge(&pending.verifier));
        assert_eq!(q["code_challenge_method"], "S256");
        assert_eq!(q["state"], pending.state);
        assert_eq!(q["redirect_uri"], pending.redirect_uri);
        assert!(!url.contains(&pending.verifier), "verifier never leaves Rust");
        assert!(pending.redirect_uri.starts_with("http://127.0.0.1:"));
        assert!(begin("https://clerk.example.test", "bad id&x=1").is_err());
        // RFC 7636 appendix B test vector.
        assert_eq!(pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }

    #[test]
    fn r04_code_exchange_keeps_the_refresh_token_in_the_store_and_returns_only_the_access_token() {
        let (url, server) = token_server(200, r#"{"access_token":"at-1","refresh_token":"rt-1","expires_in":3600,"token_type":"Bearer"}"#);
        let (mut pending, _) = begin("https://clerk.example.test", "client_1").unwrap();
        pending.token_url = url;
        let store = MemoryStore(RefCell::new(None));
        let token = complete(&pending, "the-code", &store).unwrap();
        assert_eq!(token, AccessToken { access_token: "at-1".into(), expires_in: 3600 });
        assert_eq!(store.get().unwrap(), Some("rt-1".into()));
        let json = serde_json::to_string(&token).unwrap();
        assert!(!json.contains("rt-1"), "refresh token never crosses into the webview");
        let request = server.join().unwrap();
        assert!(request.contains("grant_type=authorization_code"));
        assert!(request.contains(&format!("code_verifier={}", pending.verifier)));
    }

    #[test]
    fn r04_refresh_rotates_the_stored_token_and_forgets_a_refused_one() {
        let store = MemoryStore(RefCell::new(Some("rt-old".into())));
        let (url, server) = token_server(200, r#"{"access_token":"at-2","refresh_token":"rt-new","expires_in":60}"#);
        assert_eq!(refresh(&url, "client_1", &store).unwrap(), Some(AccessToken { access_token: "at-2".into(), expires_in: 60 }));
        assert!(server.join().unwrap().contains("refresh_token=rt-old"));
        assert_eq!(store.get().unwrap(), Some("rt-new".into()));
        let (url, server) = token_server(400, r#"{"error":"invalid_grant"}"#);
        assert_eq!(refresh(&url, "client_1", &store).unwrap(), None);
        server.join().unwrap();
        assert_eq!(store.get().unwrap(), None);
        assert_eq!(refresh("http://127.0.0.1:9/never", "client_1", &store).unwrap(), None, "nothing stored: no request");
        let failing = MemoryStore(RefCell::new(Some("rt-keep".into())));
        let (url, server) = token_server(503, r#"{}"#);
        assert!(refresh(&url, "client_1", &failing).is_err());
        server.join().unwrap();
        assert_eq!(failing.get().unwrap(), Some("rt-keep".into()), "an outage does not sign the user out");
    }
}
