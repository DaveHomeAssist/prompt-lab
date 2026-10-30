use crate::library_access::{self, AccessStore, AgentConnection, AgentRequest, AgentSummary};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs::File,
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
const CREDENTIAL_LIFETIME_MS: u64 = 86_400_000;
const RENEW_BEFORE_MS: u64 = 300_000;
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

fn new_instance() -> Result<String, String> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|_| "RANDOM_UNAVAILABLE".to_string())?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 200 && !id.chars().any(char::is_control)
}

fn valid_credential(value: &DesktopCredential, library_id: &str, at: u64) -> bool {
    value.library_id == library_id
        && value.token.len() == 64
        && value.token.bytes().all(|byte| byte.is_ascii_hexdigit())
        && value.expires_at > at
        && value.expires_at <= at.saturating_add(CREDENTIAL_LIFETIME_MS)
}

fn credential_ready(value: &DesktopCredential, library_id: &str, at: u64) -> bool {
    valid_credential(value, library_id, at) && value.expires_at.saturating_sub(at) > RENEW_BEFORE_MS
}

fn desktop_access(value: &DesktopCredential) -> Value {
    let origin = if cfg!(windows) {
        "http://tauri.localhost"
    } else {
        "tauri://localhost"
    };
    json!({ "id": "desktop", "token": value.token, "expiresAt": value.expires_at,
        "scopes": ["read", "write"], "origin": origin })
}

#[cfg(any(target_os = "macos", windows, test))]
fn new_credential(library_id: &str, at: u64) -> Result<DesktopCredential, String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|_| "RANDOM_UNAVAILABLE".to_string())?;
    Ok(DesktopCredential {
        library_id: library_id.into(),
        token: bytes.iter().map(|byte| format!("{byte:02x}")).collect(),
        expires_at: at.saturating_add(CREDENTIAL_LIFETIME_MS),
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
            if credential_ready(&previous, library_id, at) {
                return Ok(previous);
            }
            if previous.expires_at > at && !valid_credential(&previous, library_id, at) {
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

// Native-only approval binding. A restarted service invalidates pending consent.
pub struct AccessReview {
    pub library_id: String,
    instance: String,
}

type WriteRequest = (Vec<u8>, mpsc::SyncSender<Result<(), ()>>);

#[cfg(unix)]
fn acquire_owner(path: &Path) -> Result<File, String> {
    use std::{
        fs,
        io::ErrorKind,
        os::unix::fs::{MetadataExt, OpenOptionsExt},
    };
    let unavailable = || "OWNERSHIP_UNAVAILABLE".to_string();
    if !path.is_absolute() {
        return Err(unavailable());
    }
    // Never truncate, replace or unlink this file. Its live descriptor owns the lock.
    match fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)
    {
        Ok(file) => drop(file),
        Err(error) if error.kind() == ErrorKind::AlreadyExists => {}
        Err(_) => return Err(unavailable()),
    }
    let before = fs::symlink_metadata(path).map_err(|_| unavailable())?;
    if !before.is_file() || before.nlink() != 1 || before.len() != 0 {
        return Err(unavailable());
    }
    // The helper inherits this as stderr. A read-only descriptor cannot log secrets.
    let file = File::open(path).map_err(|_| unavailable())?;
    let opened = file.metadata().map_err(|_| unavailable())?;
    if (before.dev(), before.ino()) != (opened.dev(), opened.ino()) {
        return Err(unavailable());
    }
    file.try_lock().map_err(|error| match error {
        fs::TryLockError::WouldBlock => "OWNER_BUSY".to_string(),
        fs::TryLockError::Error(_) => unavailable(),
    })?;
    let current = fs::symlink_metadata(path).map_err(|_| unavailable())?;
    if !current.is_file()
        || current.nlink() != 1
        || current.len() != 0
        || (current.dev(), current.ino()) != (opened.dev(), opened.ino())
    {
        return Err(unavailable());
    }
    Ok(file)
}

#[cfg(not(unix))]
fn acquire_owner(_path: &Path) -> Result<File, String> {
    Err("PLATFORM_NOT_QUALIFIED".into())
}

struct Helper {
    child: Option<Child>,
    input: Option<mpsc::SyncSender<WriteRequest>>,
    responses: mpsc::Receiver<Result<Value, ()>>,
    sequence: u64,
    wait: Duration,
}

impl Helper {
    fn spawn(node: &Path, entry: &Path, owner: Option<File>) -> Result<Self, String> {
        if !node.is_absolute() || !entry.is_absolute() {
            return Err("INVALID_RUNTIME".into());
        }
        let mut command = Command::new(node);
        command
            .arg(entry)
            .env_clear()
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(owner.map(Stdio::from).unwrap_or_else(Stdio::null));
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
                Some("UNRECOGNIZED_FOLDER") => "UNRECOGNIZED_FOLDER",
                Some("INCOMPLETE_STORE") => "INCOMPLETE_STORE",
                Some("MISSING_OBJECT") => "MISSING_OBJECT",
                Some("UNSAFE_DIRECTORY") => "UNSAFE_DIRECTORY",
                Some("FOLDER_CHANGED") => "FOLDER_CHANGED",
                Some("UNSUPPORTED_TRANSACTION") => "UNSUPPORTED_TRANSACTION",
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
    agents: AccessStore,
    instance: String,
    base_url: String,
    stopping: bool,
    error: Option<String>,
}

fn access_credentials(
    desktop: &DesktopCredential,
    agents: &AccessStore,
) -> Result<Vec<Value>, String> {
    let mut credentials = vec![desktop_access(desktop)];
    credentials.extend(agents.credentials(now()?));
    Ok(credentials)
}

impl Running {
    fn unavailable(&mut self, error: &str) {
        self.stopping = true;
        self.error = Some(error.into());
        self.helper.input.take();
    }

    fn install_access(
        &mut self,
        desktop: &DesktopCredential,
        agents: &AccessStore,
    ) -> Result<(), String> {
        let credentials = access_credentials(desktop, agents)?;
        let ids: Vec<_> = credentials.iter().map(|item| item["id"].clone()).collect();
        let confirmed = self
            .helper
            .request("credentials", json!({ "credentials": credentials }));
        if !matches!(confirmed, Ok(ref response)
            if response["state"] == "running" && response["credentialIds"] == json!(ids))
        {
            // Preserve ownership while an uncertain helper drains; never expose a grant.
            self.unavailable("CREDENTIAL_UPDATE_FAILED");
            return Err("CREDENTIAL_UPDATE_FAILED".into());
        }
        Ok(())
    }
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
    pub fn inspect_folder(
        node: PathBuf,
        entry: PathBuf,
        directory: PathBuf,
    ) -> Result<Value, String> {
        if !directory.is_absolute() {
            return Err("INVALID_LIBRARY".into());
        }
        let mut helper = Helper::spawn(&node, &entry, None)?;
        let result = helper.request("inspect", json!({ "directory": directory }))?;
        helper.stop()?;
        if result["format"] != "promptlab-folder-inspection" || result["schemaVersion"] != 1 {
            return Err("CONTROL_INVALID".into());
        }
        Ok(result)
    }

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
        ownership: PathBuf,
    ) -> Result<ServiceStatus, String> {
        if !directory.is_absolute() || !valid_id(&library_id) {
            return Err("INVALID_LIBRARY".into());
        }
        self.start_bound(node, entry, directory, Some(&ownership), || {
            Ok((
                desktop_credential(&library_id)?,
                library_access::load(&library_id, now()?)?,
            ))
        })
    }

    #[cfg(test)]
    fn start_with(
        &self,
        node: PathBuf,
        entry: PathBuf,
        directory: PathBuf,
        load_credential: impl FnOnce() -> Result<DesktopCredential, String>,
    ) -> Result<ServiceStatus, String> {
        self.start_owned_with(node, entry, directory, None, load_credential)
    }

    #[cfg(test)]
    fn start_owned_with(
        &self,
        node: PathBuf,
        entry: PathBuf,
        directory: PathBuf,
        ownership: Option<&Path>,
        load_credential: impl FnOnce() -> Result<DesktopCredential, String>,
    ) -> Result<ServiceStatus, String> {
        self.start_bound(node, entry, directory, ownership, || {
            let credential = load_credential()?;
            let agents = AccessStore::empty(&credential.library_id);
            Ok((credential, agents))
        })
    }

    fn start_bound(
        &self,
        node: PathBuf,
        entry: PathBuf,
        directory: PathBuf,
        ownership: Option<&Path>,
        load_credential: impl FnOnce() -> Result<(DesktopCredential, AccessStore), String>,
    ) -> Result<ServiceStatus, String> {
        let mut running = self
            .running
            .lock()
            .map_err(|_| "SERVICE_UNAVAILABLE".to_string())?;
        if running.is_some() {
            return Err("ALREADY_RUNNING".into());
        }
        // Acquire before credential access or helper startup, including after app crash.
        let owner = ownership.map(acquire_owner).transpose()?;
        self.active.store(true, Ordering::SeqCst);
        // Serialize platform credential access with ownership, including startup races.
        let (credential, agents) = match load_credential() {
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
            let mut helper = Helper::spawn(&node, &entry, owner)?;
            let response = helper.request(
                "start",
                json!({ "directory": directory, "libraryId": credential.library_id,
                "credentials": access_credentials(&credential, &agents)? }),
            )?;
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
                agents,
                instance: new_instance()?,
                base_url,
                stopping: false,
                error: None,
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
                    error: value.error.clone(),
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
        self.connection_with(desktop_credential)
    }

    fn connection_with(
        &self,
        load_credential: impl FnOnce(&str) -> Result<DesktopCredential, String>,
    ) -> Result<Connection, String> {
        let status = self.status()?;
        if status.state == "stopping" {
            return Err("STOP_PENDING".into());
        }
        if status.state != "running" {
            return Err("SERVICE_UNAVAILABLE".into());
        }
        let mut running = self
            .running
            .lock()
            .map_err(|_| "SERVICE_UNAVAILABLE".to_string())?;
        let value = running.as_mut().ok_or("SERVICE_UNAVAILABLE")?;
        if value.stopping {
            return Err("STOP_PENDING".into());
        }
        if !credential_ready(&value.credential, &value.credential.library_id, now()?) {
            let next = match load_credential(&value.credential.library_id) {
                Ok(next) => next,
                Err(error) => {
                    value.error = Some(error.clone());
                    return Err(error);
                }
            };
            if !credential_ready(&next, &value.credential.library_id, now()?)
                || next.token == value.credential.token
            {
                value.error = Some("SECURE_STORE_INVALID".into());
                return Err("SECURE_STORE_INVALID".into());
            }
            value.install_access(&next, &value.agents.clone())?;
            value.credential = next;
        }
        value.error = None;
        Ok(Connection {
            library_id: value.credential.library_id.clone(),
            base_url: value.base_url.clone(),
            token: value.credential.token.clone(),
            expires_at: value.credential.expires_at,
        })
    }

    pub fn agent_access(&self, library_id: &str) -> Result<Vec<AgentSummary>, String> {
        let mut running = self
            .running
            .lock()
            .map_err(|_| "SERVICE_UNAVAILABLE".to_string())?;
        let value = running.as_mut().ok_or("SERVICE_UNAVAILABLE")?;
        if value.stopping || value.helper.exited()? {
            return Err("SERVICE_UNAVAILABLE".into());
        }
        if value.credential.library_id != library_id {
            return Err("WRONG_LIBRARY".into());
        }
        Ok(value.agents.summaries(now()?))
    }

    pub fn access_review(&self, library_id: &str) -> Result<AccessReview, String> {
        let mut running = self.running.lock().map_err(|_| "SERVICE_UNAVAILABLE")?;
        let value = running.as_mut().ok_or("SERVICE_UNAVAILABLE")?;
        if value.stopping || value.helper.exited()? {
            return Err("SERVICE_UNAVAILABLE".into());
        }
        if value.credential.library_id != library_id {
            return Err("WRONG_LIBRARY".into());
        }
        Ok(AccessReview {
            library_id: library_id.into(),
            instance: value.instance.clone(),
        })
    }

    // The native prompt must finish before calling this. No lock spans user consent.
    pub fn grant_agent(
        &self,
        review: &AccessReview,
        request: AgentRequest,
    ) -> Result<AgentConnection, String> {
        self.grant_reviewed(
            &review.library_id,
            Some(&review.instance),
            request,
            library_access::save,
        )
    }

    #[cfg(test)]
    fn grant_agent_with(
        &self,
        library_id: &str,
        request: AgentRequest,
        save: impl FnOnce(&AccessStore, &AccessStore, u64) -> Result<(), String>,
    ) -> Result<AgentConnection, String> {
        self.grant_reviewed(library_id, None, request, save)
    }

    fn grant_reviewed(
        &self,
        library_id: &str,
        instance: Option<&str>,
        request: AgentRequest,
        save: impl FnOnce(&AccessStore, &AccessStore, u64) -> Result<(), String>,
    ) -> Result<AgentConnection, String> {
        let mut running = self
            .running
            .lock()
            .map_err(|_| "SERVICE_UNAVAILABLE".to_string())?;
        let value = running.as_mut().ok_or("SERVICE_UNAVAILABLE")?;
        if value.stopping || value.helper.exited()? {
            return Err("SERVICE_UNAVAILABLE".into());
        }
        if value.credential.library_id != library_id {
            return Err("WRONG_LIBRARY".into());
        }
        if instance.is_some_and(|id| id != value.instance) {
            return Err("REVIEW_CHANGED".into());
        }
        let at = now()?;
        let (next, id) = value.agents.grant(request, at)?;
        if let Err(error) = save(&value.agents, &next, at) {
            value.unavailable(&error);
            return Err(error);
        }
        value.install_access(&value.credential.clone(), &next)?;
        value.agents = next;
        value.error = None;
        value.agents.connection(&id, &value.base_url, now()?)
    }

    pub fn revoke_agent(&self, review: &AccessReview, client_id: &str) -> Result<(), String> {
        self.revoke_reviewed(
            &review.library_id,
            Some(&review.instance),
            client_id,
            library_access::save,
        )
    }

    #[cfg(test)]
    fn revoke_agent_with(
        &self,
        library_id: &str,
        client_id: &str,
        save: impl FnOnce(&AccessStore, &AccessStore, u64) -> Result<(), String>,
    ) -> Result<(), String> {
        self.revoke_reviewed(library_id, None, client_id, save)
    }

    fn revoke_reviewed(
        &self,
        library_id: &str,
        instance: Option<&str>,
        client_id: &str,
        save: impl FnOnce(&AccessStore, &AccessStore, u64) -> Result<(), String>,
    ) -> Result<(), String> {
        let mut running = self
            .running
            .lock()
            .map_err(|_| "SERVICE_UNAVAILABLE".to_string())?;
        let value = running.as_mut().ok_or("SERVICE_UNAVAILABLE")?;
        if value.stopping || value.helper.exited()? {
            return Err("SERVICE_UNAVAILABLE".into());
        }
        if value.credential.library_id != library_id {
            return Err("WRONG_LIBRARY".into());
        }
        if instance.is_some_and(|id| id != value.instance) {
            return Err("REVIEW_CHANGED".into());
        }
        let next = value.agents.revoke(client_id)?;
        if let Err(error) = save(&value.agents, &next, now()?) {
            // A write or readback may be uncertain. Do not leave old access live.
            value.unavailable(&error);
            return Err(error);
        }
        value.install_access(&value.credential.clone(), &next)?;
        value.agents = next;
        value.error = None;
        Ok(())
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
  } else if (frame.command === 'credentials') {
    process.stdout.write(JSON.stringify({protocol:1,id:frame.id,ok:true,result:{state:'running',credentialIds:frame.args.credentials.map(item=>item.id)}})+'\n');
  }
}
"#;

    #[cfg(unix)]
    fn owned_start(fixture: &Fixture, service: &LibraryService) -> Result<ServiceStatus, String> {
        service.start_owned_with(
            fixture.node.clone(),
            fixture.entry.clone(),
            fixture.root.join("library"),
            Some(&fixture.root.join("owner.lock")),
            || new_credential("fixture", now()?),
        )
    }

    #[cfg(unix)]
    fn wait_until(mut condition: impl FnMut() -> bool) {
        let deadline = Instant::now() + Duration::from_secs(5);
        while !condition() {
            assert!(
                Instant::now() < deadline,
                "disposable process did not settle"
            );
            thread::sleep(Duration::from_millis(10));
        }
    }

    #[cfg(unix)]
    fn reject_competitor(fixture: &Fixture) {
        let service = LibraryService::default();
        let result = service.start_owned_with(
            fixture.node.clone(),
            fixture.entry.clone(),
            fixture.root.join("library"),
            Some(&fixture.root.join("owner.lock")),
            || panic!("competing owner must not read or rotate credentials"),
        );
        assert_eq!(result.err().as_deref(), Some("OWNER_BUSY"));
        assert!(!service.active());
    }

    #[cfg(unix)]
    #[test]
    fn owner_lock_is_read_only_and_rejects_invalid_paths() {
        use std::os::unix::fs::symlink;
        let fixture = Fixture::new(WORKER);
        let path = fixture.root.join("owner.lock");
        let mut first = acquire_owner(&path).unwrap();
        assert!(first
            .write_all(b"private content must not persist")
            .is_err());
        assert_eq!(fs::metadata(&path).unwrap().len(), 0);
        assert_eq!(acquire_owner(&path).err().as_deref(), Some("OWNER_BUSY"));
        drop(first);
        drop(acquire_owner(&path).unwrap());
        let alias = fixture.root.join("alias");
        symlink(&path, &alias).unwrap();
        assert_eq!(
            acquire_owner(&alias).err().as_deref(),
            Some("OWNERSHIP_UNAVAILABLE")
        );
        assert!(acquire_owner(Path::new("relative.lock")).is_err());
        assert!(acquire_owner(&fixture.root).is_err());
        let retained = fixture.root.join("retained");
        fs::write(&retained, "existing content").unwrap();
        assert!(acquire_owner(&retained).is_err());
        assert_eq!(fs::read_to_string(&retained).unwrap(), "existing content");
        assert!(acquire_owner(&fixture.root.join("missing/owner.lock")).is_err());
        let hard_link = fixture.root.join("hard-link");
        fs::hard_link(&path, &hard_link).unwrap();
        assert!(acquire_owner(&path).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn native_lock_releases_after_stop_or_failed_spawn_without_touching_library() {
        let fixture = Fixture::new(WORKER);
        fs::create_dir(fixture.root.join("library")).unwrap();
        fs::write(fixture.root.join("library/original"), "preserved").unwrap();
        let service = LibraryService::default();
        owned_start(&fixture, &service).unwrap();
        reject_competitor(&fixture);
        service.stop().unwrap();
        wait_until(|| acquire_owner(&fixture.root.join("owner.lock")).is_ok());
        let failed = service.start_owned_with(
            fixture.root.join("missing-node"),
            fixture.entry.clone(),
            fixture.root.join("library"),
            Some(&fixture.root.join("owner.lock")),
            || new_credential("fixture", now()?),
        );
        assert_eq!(failed.err().as_deref(), Some("SERVICE_UNAVAILABLE"));
        // Concurrent process creation can briefly inherit a descriptor before exec.
        // Observe release; never bypass the production busy result during that interval.
        wait_until(|| acquire_owner(&fixture.root.join("owner.lock")).is_ok());
        let denied = service.start_owned_with(
            fixture.node.clone(),
            fixture.entry.clone(),
            fixture.root.join("library"),
            Some(&fixture.root.join("owner.lock")),
            || Err("SECURE_STORE_UNAVAILABLE".into()),
        );
        assert_eq!(denied.err().as_deref(), Some("SECURE_STORE_UNAVAILABLE"));
        owned_start(&fixture, &service).unwrap();
        service.stop().unwrap();
        assert_eq!(
            fs::read_to_string(fixture.root.join("library/original")).unwrap(),
            "preserved"
        );
        assert_eq!(
            fs::metadata(fixture.root.join("owner.lock")).unwrap().len(),
            0
        );
    }

    #[cfg(unix)]
    const DRAIN_WORKER: &str = r#"
import { createInterface } from 'node:readline';
import { existsSync, writeFileSync, writeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('.', import.meta.url));
try { writeSync(2, 'must not persist'); throw Error('stderr is writable'); }
catch (error) { if (error.code !== 'EBADF') throw error; }
const deadline = setTimeout(() => process.exit(2), 20000);
for await (const line of createInterface({input:process.stdin})) {
  const frame = JSON.parse(line);
  process.stdout.write(JSON.stringify({protocol:1,id:frame.id,ok:true,result:{state:'running',libraryId:frame.args.libraryId,baseUrl:'http://127.0.0.1:23456'}})+'\n');
}
writeFileSync(root+'drain.started', 'owner input closed');
while (!existsSync(root+'drain.release')) await new Promise(resolve => setTimeout(resolve, 10));
writeFileSync(root+'drain.completed', 'accepted work settled');
clearTimeout(deadline);
"#;

    #[cfg(unix)]
    struct DrainCleanup {
        root: PathBuf,
        owner: Option<Child>,
    }

    #[cfg(unix)]
    impl Drop for DrainCleanup {
        fn drop(&mut self) {
            if let Some(owner) = self.owner.as_mut() {
                let _ = owner.kill();
                let _ = owner.wait();
            }
            let _ = fs::write(self.root.join("drain.release"), "release");
            let deadline = Instant::now() + Duration::from_secs(5);
            while Instant::now() < deadline {
                if acquire_owner(&self.root.join("owner.lock")).is_ok() {
                    break;
                }
                thread::sleep(Duration::from_millis(10));
            }
        }
    }

    #[cfg(unix)]
    #[test]
    #[ignore = "disposable child process invoked by crash ownership acceptance"]
    fn crash_owner_fixture() {
        let root = PathBuf::from(std::env::var_os("PROMPTLAB_CRASH_OWNER_ROOT").unwrap());
        let node = PathBuf::from(std::env::var_os("PROMPTLAB_CRASH_OWNER_NODE").unwrap());
        let service = LibraryService::default();
        service
            .start_owned_with(
                node,
                root.join("worker.mjs"),
                root.join("library"),
                Some(&root.join("owner.lock")),
                || new_credential("fixture", now()?),
            )
            .unwrap();
        fs::write(root.join("owner.ready"), "started").unwrap();
        // Parent acceptance kills this owned disposable process, never the real app.
        thread::sleep(Duration::from_secs(20));
        panic!("parent acceptance did not terminate its disposable owner");
    }

    #[cfg(unix)]
    #[test]
    fn app_crash_keeps_helper_ownership_through_drain_and_allows_restart() {
        let fixture = Fixture::new(DRAIN_WORKER);
        fs::create_dir(fixture.root.join("library")).unwrap();
        fs::write(fixture.root.join("library/original"), "preserved").unwrap();
        let owner = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "library_service::tests::crash_owner_fixture",
                "--ignored",
            ])
            .env("PROMPTLAB_CRASH_OWNER_ROOT", &fixture.root)
            .env("PROMPTLAB_CRASH_OWNER_NODE", &fixture.node)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let mut cleanup = DrainCleanup {
            root: fixture.root.clone(),
            owner: Some(owner),
        };
        wait_until(|| fixture.root.join("owner.ready").is_file());
        reject_competitor(&fixture);
        cleanup.owner.as_mut().unwrap().kill().unwrap();
        assert!(!cleanup.owner.as_mut().unwrap().wait().unwrap().success());
        cleanup.owner = None;
        wait_until(|| fixture.root.join("drain.started").is_file());
        reject_competitor(&fixture);
        assert!(!fixture.root.join("drain.completed").exists());
        fs::write(fixture.root.join("drain.release"), "release").unwrap();
        wait_until(|| acquire_owner(&fixture.root.join("owner.lock")).is_ok());
        assert_eq!(
            fs::read_to_string(fixture.root.join("drain.completed")).unwrap(),
            "accepted work settled"
        );
        assert_eq!(
            fs::metadata(fixture.root.join("owner.lock")).unwrap().len(),
            0
        );
        assert_eq!(
            fs::read_to_string(fixture.root.join("library/original")).unwrap(),
            "preserved"
        );
        fs::write(&fixture.entry, WORKER).unwrap();
        let restarted = LibraryService::default();
        owned_start(&fixture, &restarted).unwrap();
        restarted.stop().unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn failed_start_keeps_ownership_until_helper_exits() {
        let fixture = Fixture::new(&DRAIN_WORKER.replace("state:'running'", "state:'invalid'"));
        let _cleanup = DrainCleanup {
            root: fixture.root.clone(),
            owner: None,
        };
        let service = LibraryService::default();
        assert_eq!(
            owned_start(&fixture, &service).err().as_deref(),
            Some("CONTROL_INVALID")
        );
        wait_until(|| fixture.root.join("drain.started").is_file());
        reject_competitor(&fixture);
        fs::write(fixture.root.join("drain.release"), "release").unwrap();
        wait_until(|| acquire_owner(&fixture.root.join("owner.lock")).is_ok());
        assert!(fixture.root.join("drain.completed").is_file());
    }

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
        let mut helper = Helper::spawn(&fixture.node, &fixture.entry, None).unwrap();
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

    fn expire_connection(service: &LibraryService, near: bool) -> DesktopCredential {
        let mut owner = service.running.lock().unwrap();
        let value = owner.as_mut().unwrap();
        value.credential.expires_at = if near {
            now().unwrap() + RENEW_BEFORE_MS
        } else {
            0
        };
        value.credential.clone()
    }

    fn agent_request(access: crate::library_access::AgentAccess) -> AgentRequest {
        AgentRequest {
            label: "Disposable acceptance client".into(),
            access,
        }
    }

    #[test]
    fn consent_cannot_authorize_a_restarted_service_even_for_the_same_library() {
        use crate::library_access::AgentAccess;
        let fixture = Fixture::new(WORKER);
        let service = LibraryService::default();
        fixture.start(&service).unwrap();
        let review = service.access_review("fixture").unwrap();
        service.stop().unwrap();
        fixture.start(&service).unwrap();
        let granted = service.grant_reviewed(
            "fixture",
            Some(&review.instance),
            agent_request(AgentAccess::ReadOnly),
            |_, _, _| panic!("stale review must not read or write credentials"),
        );
        assert_eq!(granted.err().as_deref(), Some("REVIEW_CHANGED"));
        let revoked =
            service.revoke_reviewed("fixture", Some(&review.instance), "missing", |_, _, _| {
                panic!("stale review must not read or write credentials")
            });
        assert_eq!(revoked.err().as_deref(), Some("REVIEW_CHANGED"));
        assert!(service.agent_access("fixture").unwrap().is_empty());
        service.stop().unwrap();
    }

    #[test]
    fn agent_grants_serialize_and_reject_a_different_reviewed_library() {
        use crate::library_access::AgentAccess;
        use std::sync::{Arc, Barrier};
        let fixture = Fixture::new(WORKER);
        let service = Arc::new(LibraryService::default());
        fixture.start(&service).unwrap();
        let wrong = service.grant_agent_with(
            "foreign",
            agent_request(AgentAccess::ReadWrite),
            |_, _, _| panic!("wrong library must not persist"),
        );
        assert_eq!(wrong.err().as_deref(), Some("WRONG_LIBRARY"));
        assert!(service.agent_access("foreign").is_err());
        assert!(service
            .revoke_agent_with("foreign", "missing", |_, _, _| panic!(
                "wrong library must not persist"
            ))
            .is_err());
        let stored = Arc::new(Mutex::new(AccessStore::empty("fixture")));
        let barrier = Arc::new(Barrier::new(4));
        let callers: Vec<_> = (0..4)
            .map(|_| {
                let (service, stored, barrier) = (service.clone(), stored.clone(), barrier.clone());
                thread::spawn(move || {
                    barrier.wait();
                    service
                        .grant_agent_with(
                            "fixture",
                            agent_request(AgentAccess::ReadOnly),
                            |previous, next, _| {
                                let mut current = stored.lock().unwrap();
                                assert!(*current == *previous);
                                *current = next.clone();
                                Ok(())
                            },
                        )
                        .unwrap()
                })
            })
            .collect();
        let grants: Vec<_> = callers
            .into_iter()
            .map(|caller| caller.join().unwrap())
            .collect();
        assert_eq!(stored.lock().unwrap().summaries(now().unwrap()).len(), 4);
        let metadata = serde_json::to_string(&service.agent_access("fixture").unwrap()).unwrap();
        for grant in grants {
            assert!(!metadata.contains(&grant.token));
        }
        service.stop().unwrap();
    }

    #[test]
    fn uncertain_agent_changes_drain_without_returning_success() {
        use crate::library_access::AgentAccess;
        let ack = "credentialIds:frame.args.credentials.map(item=>item.id)";
        for revoke in [false, true] {
            for denied in [false, true] {
                // A revoke needs a successful grant before deliberately broken acknowledgement.
                let script = WORKER.replace(ack, if revoke {
                    "credentialIds:frame.args.credentials.length === 2 ? frame.args.credentials.map(item=>item.id) : ['wrong']"
                } else { "credentialIds:['wrong']" });
                let fixture = Fixture::new(&script);
                let service = LibraryService::default();
                fixture.start(&service).unwrap();
                let result = if revoke {
                    let grant = service
                        .grant_agent_with(
                            "fixture",
                            agent_request(AgentAccess::ReadWrite),
                            |_, _, _| Ok(()),
                        )
                        .unwrap();
                    service.revoke_agent_with("fixture", &grant.client.id, |_, _, _| {
                        if denied {
                            Err("SECURE_STORE_UNVERIFIED".into())
                        } else {
                            Ok(())
                        }
                    })
                } else {
                    service
                        .grant_agent_with(
                            "fixture",
                            agent_request(AgentAccess::ReadWrite),
                            |_, _, _| {
                                if denied {
                                    Err("SECURE_STORE_UNVERIFIED".into())
                                } else {
                                    Ok(())
                                }
                            },
                        )
                        .map(|_| ())
                };
                assert!(result.is_err());
                let owner = service.running.lock().unwrap();
                assert!(owner.as_ref().unwrap().stopping);
                assert!(owner.as_ref().unwrap().helper.input.is_none());
                drop(owner);
                assert!(service.connection().is_err());
                service.stop().unwrap();
            }
        }
    }

    #[cfg(unix)]
    #[test]
    fn real_folder_inspection_preserves_files_and_returns_actionable_rejections() {
        let fixture = Fixture::new(WORKER);
        let helper = std::env::var_os("PL_TEST_LIBRARY_HELPER")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join("../../library-storage/service-worker.mjs")
            });
        let directory = fixture.root.join("selected");
        fs::create_dir(&directory).unwrap();
        let inspect = || {
            LibraryService::inspect_folder(fixture.node.clone(), helper.clone(), directory.clone())
        };
        let review = inspect().unwrap();
        assert_eq!(review["headCount"], 0);
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 0);
        let unrelated = directory.join("keep.txt");
        fs::write(&unrelated, "untouched").unwrap();
        assert_eq!(inspect().err().as_deref(), Some("UNRECOGNIZED_FOLDER"));
        assert_eq!(fs::read_to_string(&unrelated).unwrap(), "untouched");
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 1);
        fs::remove_file(&unrelated).unwrap();
        fs::create_dir(directory.join("transactions")).unwrap();
        fs::write(
            directory.join("transactions/interrupted.pending"),
            "retained",
        )
        .unwrap();
        assert_eq!(inspect().err().as_deref(), Some("INCOMPLETE_STORE"));
        assert_eq!(
            fs::read_to_string(directory.join("transactions/interrupted.pending")).unwrap(),
            "retained"
        );
    }

    #[cfg(unix)]
    #[test]
    fn agent_access_reaches_real_helper_and_survives_renewal_and_restart() {
        use crate::library_access::AgentAccess;
        use std::net::TcpStream;
        fn request(
            base: &str,
            token: &str,
            method: &str,
            path: &str,
            origin: Option<&str>,
            body: &str,
        ) -> u16 {
            let address = base.strip_prefix("http://").unwrap();
            let mut stream = TcpStream::connect(address).unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            stream
                .set_write_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let origin = origin
                .map(|value| format!("Origin: {value}\r\n"))
                .unwrap_or_default();
            let bytes = format!("{method} {path} HTTP/1.1\r\nHost: {address}\r\nAuthorization: Bearer {token}\r\n{origin}Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
            stream.write_all(bytes.as_bytes()).unwrap();
            let mut line = String::new();
            BufReader::new(stream).read_line(&mut line).unwrap();
            line.split_whitespace().nth(1).unwrap().parse().unwrap()
        }
        let fixture = Fixture::new(WORKER);
        let helper = std::env::var_os("PL_TEST_LIBRARY_HELPER")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join("../../library-storage/service-worker.mjs")
            });
        assert!(
            helper.is_file(),
            "real helper source required for acceptance"
        );
        let stored = Mutex::new(AccessStore::empty("fixture"));
        let service = LibraryService::default();
        let start = || {
            service
                .start_bound(
                    fixture.node.clone(),
                    helper.clone(),
                    fixture.root.join("library"),
                    None,
                    || {
                        Ok((
                            new_credential("fixture", now()?)?,
                            stored.lock().unwrap().clone(),
                        ))
                    },
                )
                .unwrap()
        };
        let save = |previous: &AccessStore, next: &AccessStore, _: u64| {
            let mut current = stored.lock().unwrap();
            assert!(*current == *previous);
            *current = next.clone();
            Ok(())
        };
        let base = start().base_url.unwrap();
        let reader = service
            .grant_agent_with("fixture", agent_request(AgentAccess::ReadOnly), save)
            .unwrap();
        let writer = service
            .grant_agent_with("fixture", agent_request(AgentAccess::ReadWrite), save)
            .unwrap();
        assert_eq!(
            request(&base, &reader.token, "GET", "/v1/library", None, ""),
            200
        );
        assert_eq!(
            request(
                &base,
                &reader.token,
                "POST",
                "/v1/library/previews",
                None,
                "{}"
            ),
            403
        );
        assert_eq!(
            request(
                &base,
                &writer.token,
                "GET",
                "/v1/library",
                Some("tauri://localhost"),
                ""
            ),
            403
        );
        let preview =
            r#"{"libraryId":"fixture","expectedRevision":null,"sourceText":"{\"library\":[]}"}"#;
        assert_eq!(
            request(
                &base,
                &writer.token,
                "POST",
                "/v1/library/previews",
                None,
                preview
            ),
            201
        );
        expire_connection(&service, false);
        service
            .connection_with(|id| new_credential(id, now()?))
            .unwrap();
        assert_eq!(
            request(&base, &reader.token, "GET", "/v1/library", None, ""),
            200
        );
        service.stop().unwrap();
        let restarted = start().base_url.unwrap();
        assert_eq!(
            request(&restarted, &writer.token, "GET", "/v1/library", None, ""),
            200
        );
        service
            .revoke_agent_with("fixture", &writer.client.id, save)
            .unwrap();
        assert_eq!(
            request(&restarted, &writer.token, "GET", "/v1/library", None, ""),
            401
        );
        assert_eq!(
            request(&restarted, &reader.token, "GET", "/v1/library", None, ""),
            200
        );
        service.stop().unwrap();
        let final_base = start().base_url.unwrap();
        assert_eq!(
            request(&final_base, &writer.token, "GET", "/v1/library", None, ""),
            401
        );
        assert_eq!(
            request(&final_base, &reader.token, "GET", "/v1/library", None, ""),
            200
        );
        service.stop().unwrap();
    }

    #[test]
    fn native_connection_renews_before_expiry_and_reuses_confirmed_token() {
        for near in [false, true] {
            let fixture = Fixture::new(WORKER);
            let service = LibraryService::default();
            fixture.start(&service).unwrap();
            let original = service
                .connection_with(|_| panic!("fresh credentials need no store access"))
                .unwrap();
            expire_connection(&service, near);
            let next = service
                .connection_with(|id| new_credential(id, now()?))
                .unwrap();
            assert!(original.token != next.token);
            assert_eq!(next.library_id, original.library_id);
            assert_eq!(next.base_url, original.base_url);
            let repeated = service
                .connection_with(|_| panic!("confirmed renewal must be reused"))
                .unwrap();
            assert!(repeated.token == next.token);
            let status = serde_json::to_string(&service.status().unwrap()).unwrap();
            assert!(!status.contains(&next.token));
            service.stop().unwrap();
        }
    }

    #[test]
    fn renewal_store_failure_preserves_owner_and_can_retry() {
        let fixture = Fixture::new(WORKER);
        let service = LibraryService::default();
        fixture.start(&service).unwrap();
        let previous = expire_connection(&service, false);
        let failed = service.connection_with(|_| Err("SECURE_STORE_UNAVAILABLE".into()));
        assert_eq!(failed.err().as_deref(), Some("SECURE_STORE_UNAVAILABLE"));
        assert_eq!(
            service.status().unwrap().error.as_deref(),
            Some("SECURE_STORE_UNAVAILABLE")
        );
        assert!(service.active());
        assert!(
            service
                .running
                .lock()
                .unwrap()
                .as_ref()
                .unwrap()
                .credential
                .token
                == previous.token
        );
        let recovered = service
            .connection_with(|id| new_credential(id, now()?))
            .unwrap();
        assert!(recovered.token != previous.token);
        assert!(service.status().unwrap().error.is_none());
        service.stop().unwrap();
    }

    #[test]
    fn invalid_renewals_cannot_change_the_running_credential() {
        let fixture = Fixture::new(WORKER);
        let service = LibraryService::default();
        fixture.start(&service).unwrap();
        let previous = expire_connection(&service, false);
        let mut reused = previous.clone();
        reused.expires_at = now().unwrap() + CREDENTIAL_LIFETIME_MS;
        let mut near = new_credential("fixture", now().unwrap()).unwrap();
        near.expires_at = now().unwrap() + RENEW_BEFORE_MS;
        let mut malformed = new_credential("fixture", now().unwrap()).unwrap();
        malformed.token = "invalid".into();
        for next in [
            new_credential("foreign", now().unwrap()).unwrap(),
            reused,
            near,
            malformed,
        ] {
            let result = service.connection_with(|_| Ok(next));
            assert_eq!(result.err().as_deref(), Some("SECURE_STORE_INVALID"));
            let owner = service.running.lock().unwrap();
            assert!(owner.as_ref().unwrap().credential.token == previous.token);
            assert!(!owner.as_ref().unwrap().stopping);
        }
        service.stop().unwrap();
    }

    #[test]
    fn concurrent_connections_perform_one_confirmed_renewal() {
        use std::sync::{atomic::AtomicUsize, Arc, Barrier};
        let fixture = Fixture::new(WORKER);
        let service = Arc::new(LibraryService::default());
        fixture.start(&service).unwrap();
        expire_connection(&service, false);
        let count = Arc::new(AtomicUsize::new(0));
        let barrier = Arc::new(Barrier::new(4));
        let callers: Vec<_> = (0..4)
            .map(|_| {
                let service = service.clone();
                let count = count.clone();
                let barrier = barrier.clone();
                thread::spawn(move || {
                    barrier.wait();
                    service
                        .connection_with(|id| {
                            count.fetch_add(1, Ordering::SeqCst);
                            new_credential(id, now()?)
                        })
                        .unwrap()
                })
            })
            .collect();
        let results: Vec<_> = callers
            .into_iter()
            .map(|caller| caller.join().unwrap())
            .collect();
        assert_eq!(count.load(Ordering::SeqCst), 1);
        assert!(results
            .iter()
            .all(|result| result.token == results[0].token));
        service.stop().unwrap();
    }

    #[test]
    fn uncertain_renewal_drains_the_child_without_returning_a_token() {
        let acknowledgement = "process.stdout.write(JSON.stringify({protocol:1,id:frame.id,ok:true,result:{state:'running',credentialIds:frame.args.credentials.map(item=>item.id)}})+'\\n');";
        for replacement in [
            "process.stdout.write(JSON.stringify({protocol:1,id:frame.id,ok:true,result:{state:'stopped',credentialIds:['desktop']}})+'\\n');",
            "process.stdout.write(JSON.stringify({protocol:1,id:frame.id,ok:true,result:{state:'running',credentialIds:['foreign']}})+'\\n');",
            "process.stdout.write(JSON.stringify({protocol:1,id:frame.id,ok:false,error:{code:'INVALID_CREDENTIALS'}})+'\\n');",
            "process.stdout.write('{bad}\\n');",
            "",
        ] {
            assert!(WORKER.contains(acknowledgement));
            let fixture = Fixture::new(&WORKER.replace(acknowledgement, replacement));
            let service = LibraryService::default();
            fixture.start(&service).unwrap();
            let previous = expire_connection(&service, false);
            service.running.lock().unwrap().as_mut().unwrap().helper.wait = Duration::from_millis(200);
            let result = service.connection_with(|id| new_credential(id, now()?));
            assert_eq!(result.err().as_deref(), Some("CREDENTIAL_UPDATE_FAILED"));
            {
                let owner = service.running.lock().unwrap();
                let value = owner.as_ref().unwrap();
                assert!(value.stopping); assert!(value.helper.input.is_none());
                assert!(value.credential.token == previous.token);
                assert!(service.active());
            }
            let second = fixture.start(&service);
            assert_eq!(second.err().as_deref(), Some("ALREADY_RUNNING"));
            service.stop().unwrap();
            assert!(!service.active());
            fixture.start(&service).unwrap(); service.stop().unwrap();
        }
    }

    #[cfg(any(target_os = "macos", windows))]
    #[test]
    #[ignore = "requires explicit acceptance against the real platform credential store"]
    fn native_connection_renews_with_real_keychain() {
        let name = format!(
            "disposable-renewal-{}",
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
        let fixture = Fixture::new(WORKER);
        let service = LibraryService::default();
        service
            .start_with(
                fixture.node.clone(),
                fixture.entry.clone(),
                fixture.root.clone(),
                || desktop_credential(&name),
            )
            .unwrap();
        let previous = {
            let mut owner = service.running.lock().unwrap();
            let value = owner.as_mut().unwrap();
            value.credential.expires_at = 0;
            entry
                .set_secret(&serde_json::to_vec(&value.credential).unwrap())
                .unwrap();
            value.credential.clone()
        };
        let result = service.connection();
        service.stop().unwrap();
        let stored: DesktopCredential =
            serde_json::from_slice(&entry.get_secret().unwrap()).unwrap();
        entry.delete_credential().unwrap();
        assert!(matches!(entry.get_secret(), Err(keyring::Error::NoEntry)));
        let connection = result.unwrap();
        assert!(connection.token != previous.token);
        assert!(connection.token == stored.token);
        assert_eq!(connection.library_id, name);
        assert!(valid_credential(&stored, &name, now().unwrap()));
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
        let mut near = next.clone();
        near.expires_at = now().unwrap() + RENEW_BEFORE_MS;
        entry
            .set_secret(&serde_json::to_vec(&near).unwrap())
            .unwrap();
        let renewed = desktop_credential(&name).unwrap();
        assert!(renewed.token != next.token);
        assert!(credential_ready(&renewed, &name, now().unwrap()));
        entry.delete_credential().unwrap();
        assert!(matches!(entry.get_secret(), Err(keyring::Error::NoEntry)));
    }
}
