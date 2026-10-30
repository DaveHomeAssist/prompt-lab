use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Mutex,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const CONTROL_LIMIT: u64 = 64 * 1024;
const WAIT: Duration = Duration::from_secs(30);
#[cfg(any(target_os = "macos", windows))]
const CREDENTIAL_SERVICE: &str = "com.promptlab.desktop.folder-service";

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DesktopCredential {
    library_id: String,
    token: String,
    expires_at: u64,
}

fn now() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .map_err(|_| "CLOCK_UNAVAILABLE".into())
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 200 && !id.chars().any(char::is_control)
}

fn valid_credential(value: &DesktopCredential, library_id: &str, at: u64) -> bool {
    value.library_id == library_id
        && value.token.len() == 64
        && value.token.bytes().all(|byte| byte.is_ascii_hexdigit())
        && value.expires_at > at
        && value.expires_at <= at + 86_400_000
}

#[cfg(any(target_os = "macos", windows, test))]
fn new_credential(library_id: &str, at: u64) -> Result<DesktopCredential, String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|_| "RANDOM_UNAVAILABLE".to_string())?;
    Ok(DesktopCredential {
        library_id: library_id.into(),
        token: bytes.iter().map(|byte| format!("{byte:02x}")).collect(),
        expires_at: at + 86_400_000,
    })
}

#[cfg(any(target_os = "macos", windows))]
fn desktop_credential(library_id: &str) -> Result<DesktopCredential, String> {
    if !valid_id(library_id) {
        return Err("INVALID_LIBRARY".into());
    }
    let at = now()?;
    let entry = keyring::Entry::new(CREDENTIAL_SERVICE, library_id)
        .map_err(|_| "SECURE_STORE_UNAVAILABLE".to_string())?;
    match entry.get_secret() {
        Ok(bytes) => {
            let previous: DesktopCredential =
                serde_json::from_slice(&bytes).map_err(|_| "SECURE_STORE_INVALID".to_string())?;
            if previous.library_id != library_id {
                return Err("SECURE_STORE_INVALID".into());
            }
            if valid_credential(&previous, library_id, at) {
                return Ok(previous);
            }
            if previous.expires_at > at {
                return Err("SECURE_STORE_INVALID".into());
            }
        }
        Err(keyring::Error::NoEntry) => {}
        Err(_) => return Err("SECURE_STORE_UNAVAILABLE".into()),
    }
    let credential = new_credential(library_id, at)?;
    let encoded =
        serde_json::to_vec(&credential).map_err(|_| "SECURE_STORE_INVALID".to_string())?;
    entry
        .set_secret(&encoded)
        .map_err(|_| "SECURE_STORE_UNAVAILABLE".to_string())?;
    if entry
        .get_secret()
        .map_err(|_| "SECURE_STORE_UNAVAILABLE".to_string())?
        != encoded
    {
        return Err("SECURE_STORE_UNVERIFIED".into());
    }
    Ok(credential)
}

#[cfg(not(any(target_os = "macos", windows)))]
fn desktop_credential(_library_id: &str) -> Result<DesktopCredential, String> {
    Err("PLATFORM_NOT_QUALIFIED".into())
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceStatus {
    pub state: &'static str,
    pub library_id: Option<String>,
    pub base_url: Option<String>,
    pub error: Option<String>,
}

// Returned only to the trusted app on explicit connection, never diagnostics.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub library_id: String,
    pub base_url: String,
    pub token: String,
    pub expires_at: u64,
}

type WriteRequest = (Vec<u8>, mpsc::SyncSender<Result<(), ()>>);

struct Helper {
    child: Option<Child>,
    input: Option<mpsc::SyncSender<WriteRequest>>,
    responses: mpsc::Receiver<Result<Value, ()>>,
    sequence: u64,
    wait: Duration,
}

impl Helper {
    fn spawn(node: &Path, entry: &Path) -> Result<Self, String> {
        if !node.is_absolute() || !entry.is_absolute() {
            return Err("INVALID_RUNTIME".into());
        }
        let mut command = Command::new(node);
        command
            .arg(entry)
            .env_clear()
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000); // CREATE_NO_WINDOW
            if let Some(root) = std::env::var_os("SystemRoot") {
                command.env("SystemRoot", root);
            }
        }
        let mut child = command
            .spawn()
            .map_err(|_| "SERVICE_UNAVAILABLE".to_string())?;
        let mut input = child.stdin.take().ok_or("SERVICE_UNAVAILABLE")?;
        let output = child.stdout.take().ok_or("SERVICE_UNAVAILABLE")?;
        let (writes, pending) = mpsc::sync_channel::<WriteRequest>(1);
        thread::spawn(move || {
            while let Ok((bytes, reply)) = pending.recv() {
                let result = input
                    .write_all(&bytes)
                    .and_then(|_| input.flush())
                    .map_err(|_| ());
                let failed = result.is_err();
                let _ = reply.send(result);
                if failed {
                    break;
                }
            }
        });
        let (sender, responses) = mpsc::sync_channel(16);
        thread::spawn(move || {
            let mut reader = BufReader::new(output);
            loop {
                let mut line = Vec::new();
                let read = reader
                    .by_ref()
                    .take(CONTROL_LIMIT + 1)
                    .read_until(b'\n', &mut line);
                if matches!(read, Ok(0)) {
                    break;
                }
                if read.is_err() || line.len() as u64 > CONTROL_LIMIT || line.last() != Some(&b'\n')
                {
                    let _ = sender.send(Err(()));
                    break;
                }
                let value = serde_json::from_slice(&line).map_err(|_| ());
                let failed = value.is_err();
                if sender.send(value).is_err() || failed {
                    break;
                }
            }
        });
        Ok(Self {
            child: Some(child),
            input: Some(writes),
            responses,
            sequence: 0,
            wait: WAIT,
        })
    }

    fn request(&mut self, command: &str, args: Value) -> Result<Value, String> {
        self.sequence += 1;
        let id = format!("native{}", self.sequence);
        let mut bytes = serde_json::to_vec(
            &json!({ "protocol": 1, "id": id, "command": command, "args": args }),
        )
        .map_err(|_| "CONTROL_INVALID".to_string())?;
        bytes.push(b'\n');
        if bytes.len() as u64 > CONTROL_LIMIT {
            return Err("CONTROL_TOO_LARGE".into());
        }
        let input = self.input.as_ref().ok_or("SERVICE_UNAVAILABLE")?;
        let (reply, written) = mpsc::sync_channel(1);
        input
            .try_send((bytes, reply))
            .map_err(|_| "SERVICE_UNAVAILABLE".to_string())?;
        written
            .recv_timeout(self.wait)
            .map_err(|_| "SERVICE_UNAVAILABLE".to_string())?
            .map_err(|_| "SERVICE_UNAVAILABLE".to_string())?;
        let response = self
            .responses
            .recv_timeout(self.wait)
            .map_err(|_| "SERVICE_UNAVAILABLE".to_string())?
            .map_err(|_| "CONTROL_INVALID".to_string())?;
        if response["protocol"] != 1 || response["id"] != id {
            return Err("CONTROL_INVALID".into());
        }
        if response["ok"] != true {
            // Only a small set of action-relevant codes crosses the native boundary.
            return Err(match response["error"]["code"].as_str() {
                Some("WRONG_LIBRARY") => "WRONG_LIBRARY",
                Some("CLOUD_CONFLICT") => "CLOUD_CONFLICT",
                Some("HASH_MISMATCH") => "HASH_MISMATCH",
                _ => "SERVICE_UNAVAILABLE",
            }
            .into());
        }
        Ok(response["result"].clone())
    }

    fn exited(&mut self) -> Result<bool, String> {
        self.child
            .as_mut()
            .ok_or("SERVICE_UNAVAILABLE")?
            .try_wait()
            .map(|status| status.is_some())
            .map_err(|_| "SERVICE_UNAVAILABLE".into())
    }

    fn stop(&mut self) -> Result<(), String> {
        if self.exited()? {
            self.input.take();
            return Ok(());
        }
        if self.input.is_some() {
            // Stop acknowledgement is sent only after accepted HTTP writes drain.
            let _ = self.request("stop", json!({}));
            self.input.take();
        }
        let deadline = Instant::now() + WAIT;
        while !self.exited()? {
            if Instant::now() >= deadline {
                return Err("STOP_PENDING".into());
            }
            thread::sleep(Duration::from_millis(20));
        }
        Ok(())
    }
}

impl Drop for Helper {
    fn drop(&mut self) {
        self.input.take();
        if let Some(mut child) = self.child.take() {
            // EOF requests graceful drain, including when startup/readback fails.
            thread::spawn(move || {
                let _ = child.wait();
            });
        }
    }
}

struct Running {
    helper: Helper,
    credential: DesktopCredential,
    base_url: String,
    stopping: bool,
}

pub struct LibraryService {
    running: Mutex<Option<Running>>,
    active: AtomicBool,
    last_error: Mutex<Option<String>>,
}

impl Default for LibraryService {
    fn default() -> Self {
        Self {
            running: Mutex::new(None),
            active: AtomicBool::new(false),
            last_error: Mutex::new(None),
        }
    }
}

impl LibraryService {
    pub fn active(&self) -> bool {
        self.active.load(Ordering::SeqCst)
    }

    // Called by the native picker/migration owner, never by a supplied shell command.
    pub fn start(
        &self,
        node: PathBuf,
        entry: PathBuf,
        directory: PathBuf,
        library_id: String,
    ) -> Result<ServiceStatus, String> {
        if !directory.is_absolute() || !valid_id(&library_id) {
            return Err("INVALID_LIBRARY".into());
        }
        self.start_with(node, entry, directory, || desktop_credential(&library_id))
    }

    fn start_with(
        &self,
        node: PathBuf,
        entry: PathBuf,
        directory: PathBuf,
        load_credential: impl FnOnce() -> Result<DesktopCredential, String>,
    ) -> Result<ServiceStatus, String> {
        let mut running = self
            .running
            .lock()
            .map_err(|_| "SERVICE_UNAVAILABLE".to_string())?;
        if running.is_some() {
            return Err("ALREADY_RUNNING".into());
        }
        self.active.store(true, Ordering::SeqCst);
        // Serialize platform credential access with ownership, including startup races.
        let credential = match load_credential() {
            Ok(value) => value,
            Err(error) => {
                self.active.store(false, Ordering::SeqCst);
                *self
                    .last_error
                    .lock()
                    .map_err(|_| "SERVICE_UNAVAILABLE".to_string())? = Some(error.clone());
                return Err(error);
            }
        };
        let result: Result<Running, String> = (|| {
            let mut helper = Helper::spawn(&node, &entry)?;
            let origin = if cfg!(windows) {
                "http://tauri.localhost"
            } else {
                "tauri://localhost"
            };
            let response = helper.request("start", json!({ "directory": directory, "libraryId": credential.library_id,
                "credentials": [{ "id": "desktop", "token": credential.token, "expiresAt": credential.expires_at, "scopes": ["read", "write"], "origin": origin }] }))?;
            let base_url = response["baseUrl"]
                .as_str()
                .ok_or("CONTROL_INVALID")?
                .to_string();
            let port = base_url
                .strip_prefix("http://127.0.0.1:")
                .and_then(|value| value.parse::<u16>().ok());
            if port.is_none()
                || port == Some(0)
                || response["state"] != "running"
                || response["libraryId"] != credential.library_id
            {
                return Err("CONTROL_INVALID".into());
            }
            Ok(Running {
                helper,
                credential,
                base_url,
                stopping: false,
            })
        })();
        match result {
            Ok(value) => {
                *running = Some(value);
                *self
                    .last_error
                    .lock()
                    .map_err(|_| "SERVICE_UNAVAILABLE".to_string())? = None;
            }
            Err(error) => {
                self.active.store(false, Ordering::SeqCst);
                *self
                    .last_error
                    .lock()
                    .map_err(|_| "SERVICE_UNAVAILABLE".to_string())? = Some(error.clone());
                return Err(error);
            }
        }
        drop(running);
        self.status()
    }

    pub fn status(&self) -> Result<ServiceStatus, String> {
        let mut running = self
            .running
            .lock()
            .map_err(|_| "SERVICE_UNAVAILABLE".to_string())?;
        if let Some(value) = running.as_mut() {
            if !value.helper.exited()? {
                return Ok(ServiceStatus {
                    state: if value.stopping {
                        "stopping"
                    } else {
                        "running"
                    },
                    library_id: Some(value.credential.library_id.clone()),
                    base_url: Some(value.base_url.clone()),
                    error: None,
                });
            }
            *running = None;
            self.active.store(false, Ordering::SeqCst);
            *self
                .last_error
                .lock()
                .map_err(|_| "SERVICE_UNAVAILABLE".to_string())? =
                Some("SERVICE_UNAVAILABLE".into());
        }
        let error = self
            .last_error
            .lock()
            .map_err(|_| "SERVICE_UNAVAILABLE".to_string())?
            .clone();
        Ok(ServiceStatus {
            state: if error.is_some() {
                "unavailable"
            } else {
                "stopped"
            },
            library_id: None,
            base_url: None,
            error,
        })
    }

    pub fn connection(&self) -> Result<Connection, String> {
        let status = self.status()?;
        if status.state != "running" {
            return Err("SERVICE_UNAVAILABLE".into());
        }
        let running = self
            .running
            .lock()
            .map_err(|_| "SERVICE_UNAVAILABLE".to_string())?;
        let value = running.as_ref().ok_or("SERVICE_UNAVAILABLE")?;
        if value.stopping {
            return Err("STOP_PENDING".into());
        }
        if !valid_credential(&value.credential, &value.credential.library_id, now()?) {
            return Err("CREDENTIAL_EXPIRED".into());
        }
        Ok(Connection {
            library_id: value.credential.library_id.clone(),
            base_url: value.base_url.clone(),
            token: value.credential.token.clone(),
            expires_at: value.credential.expires_at,
        })
    }

    pub fn stop(&self) -> Result<(), String> {
        let mut running = self
            .running
            .lock()
            .map_err(|_| "SERVICE_UNAVAILABLE".to_string())?;
        if let Some(value) = running.as_mut() {
            value.stopping = true;
            value.helper.stop()?;
        }
        *running = None;
        self.active.store(false, Ordering::SeqCst);
        *self
            .last_error
            .lock()
            .map_err(|_| "SERVICE_UNAVAILABLE".to_string())? = None;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    struct Fixture {
        root: PathBuf,
        node: PathBuf,
        entry: PathBuf,
    }
    impl Fixture {
        fn new(script: &str) -> Self {
            let unique = new_credential("fixture", now().unwrap()).unwrap().token;
            let root = std::env::temp_dir().join(format!("promptlab-native-{}", &unique[..16]));
            fs::create_dir(&root).unwrap();
            let entry = root.join("worker.mjs");
            fs::write(&entry, script).unwrap();
            let result = Command::new("node")
                .args(["-p", "process.execPath"])
                .output()
                .unwrap();
            assert!(result.status.success());
            let node = PathBuf::from(String::from_utf8(result.stdout).unwrap().trim());
            Self { root, node, entry }
        }
        fn start(&self, service: &LibraryService) -> Result<ServiceStatus, String> {
            service.start_with(
                self.node.clone(),
                self.entry.clone(),
                self.root.clone(),
                || new_credential("fixture", now()?),
            )
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    const WORKER: &str = r#"
import { createInterface } from 'node:readline';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const input = createInterface({ input: process.stdin });
let directory;
for await (const line of input) {
  const frame = JSON.parse(line);
  if (frame.command === 'start') {
    directory = frame.args.directory;
    process.stdout.write(JSON.stringify({protocol:1,id:frame.id,ok:true,result:{state:'running',libraryId:frame.args.libraryId,baseUrl:'http://127.0.0.1:23456'}})+'\n');
  } else if (frame.command === 'stop') {
    await writeFile(join(directory,'stop.completed'),'accepted work settled');
    process.stdout.write(JSON.stringify({protocol:1,id:frame.id,ok:true,result:{state:'stopped'}})+'\n');
    input.close(); break;
  }
}
"#;

    #[test]
    fn native_owner_retains_one_child_and_waits_for_stop() {
        let fixture = Fixture::new(WORKER);
        let service = LibraryService::default();
        assert_eq!(service.status().unwrap().state, "stopped");
        let started = fixture.start(&service).unwrap();
        assert_eq!(started.state, "running");
        assert!(service.active());
        let connection = service.connection().unwrap();
        assert_eq!(connection.library_id, "fixture");
        let status = serde_json::to_string(&service.status().unwrap()).unwrap();
        assert!(!status.contains(&connection.token));
        let second = service.start_with(
            fixture.node.clone(),
            fixture.entry.clone(),
            fixture.root.clone(),
            || panic!("second startup must not touch secure storage"),
        );
        assert_eq!(second.err().as_deref(), Some("ALREADY_RUNNING"));
        service.stop().unwrap();
        assert!(!service.active());
        assert_eq!(
            fs::read_to_string(fixture.root.join("stop.completed")).unwrap(),
            "accepted work settled"
        );
        assert_eq!(service.status().unwrap().state, "stopped");
        assert!(service.connection().is_err());
        service.stop().unwrap();
        fixture.start(&service).unwrap();
        service.stop().unwrap();
    }

    #[test]
    fn native_owner_fails_closed_when_secure_storage_is_unavailable() {
        let service = LibraryService::default();
        let result = service.start_with(
            PathBuf::from("must-not-run"),
            PathBuf::from("must-not-read"),
            PathBuf::from("must-not-create"),
            || Err("SECURE_STORE_UNAVAILABLE".into()),
        );
        assert_eq!(result.err().as_deref(), Some("SECURE_STORE_UNAVAILABLE"));
        assert!(!service.active());
        assert_eq!(service.status().unwrap().state, "unavailable");
    }

    #[test]
    fn malformed_child_output_cannot_supply_an_endpoint() {
        for script in ["process.stdout.write('x'.repeat(65537));", "process.stdout.write('{bad}\\n');", "process.stdout.write(JSON.stringify({protocol:1,id:'wrong',ok:true,result:{}})+'\\n');"] {
            let fixture = Fixture::new(script); let service = LibraryService::default();
            assert!(fixture.start(&service).is_err()); assert!(!service.active());
            assert!(service.connection().is_err());
        }
    }

    #[test]
    fn unresponsive_child_cannot_hold_private_control_call() {
        let fixture = Fixture::new("setInterval(() => {}, 1000);");
        let mut helper = Helper::spawn(&fixture.node, &fixture.entry).unwrap();
        helper.wait = Duration::from_millis(200);
        let started = Instant::now();
        let result = helper.request("start", json!({ "synthetic": "x".repeat(60_000) }));
        // This synthetic child never accepts a library or a write.
        helper.child.as_mut().unwrap().kill().unwrap();
        helper.child.as_mut().unwrap().wait().unwrap();
        assert!(result.is_err());
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn missing_runtime_is_unavailable_without_fallback() {
        let service = LibraryService::default();
        let result = service.start_with(
            std::env::temp_dir().join("missing-promptlab-runtime"),
            std::env::temp_dir().join("missing-entry"),
            std::env::temp_dir(),
            || new_credential("fixture", now()?),
        );
        assert!(result.is_err());
        assert!(!service.active());
        assert_eq!(service.status().unwrap().state, "unavailable");
    }

    #[test]
    fn credentials_are_bound_expiring_and_never_predictable() {
        let at = now().unwrap();
        let first = new_credential("library-one", at).unwrap();
        let second = new_credential("library-one", at).unwrap();
        assert_ne!(first.token, second.token);
        assert!(valid_credential(&first, "library-one", at));
        assert!(!valid_credential(&first, "library-two", at));
        assert!(!valid_credential(&first, "library-one", first.expires_at));
        assert!(!valid_id(""));
        assert!(!valid_id("bad\nname"));
        let mut invalid = first.clone();
        invalid.token = "0".repeat(32);
        assert!(!valid_credential(&invalid, "library-one", at));
        invalid = first.clone();
        invalid.expires_at += 1;
        assert!(!valid_credential(&invalid, "library-one", at));
    }

    #[cfg(any(target_os = "macos", windows))]
    #[test]
    #[ignore = "requires explicit acceptance against the real platform credential store"]
    fn secure_store_roundtrip_and_expiry_rotation() {
        let name = format!(
            "disposable-test-{}",
            &new_credential("fixture", now().unwrap()).unwrap().token[..16]
        );
        let entry = keyring::Entry::new(CREDENTIAL_SERVICE, &name).unwrap();
        assert!(matches!(entry.get_secret(), Err(keyring::Error::NoEntry)));
        struct Cleanup<'a>(&'a keyring::Entry);
        impl Drop for Cleanup<'_> {
            fn drop(&mut self) {
                let _ = self.0.delete_credential();
            }
        }
        let _cleanup = Cleanup(&entry);
        let first = desktop_credential(&name).unwrap();
        assert!(first.token == desktop_credential(&name).unwrap().token);
        let mut expired = first.clone();
        expired.expires_at = 0;
        entry
            .set_secret(&serde_json::to_vec(&expired).unwrap())
            .unwrap();
        let next = desktop_credential(&name).unwrap();
        assert!(first.token != next.token);
        assert!(valid_credential(&next, &name, now().unwrap()));
        entry.delete_credential().unwrap();
        assert!(matches!(entry.get_secret(), Err(keyring::Error::NoEntry)));
    }
}
