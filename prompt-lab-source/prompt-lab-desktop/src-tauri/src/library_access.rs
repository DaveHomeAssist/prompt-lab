use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;

const LIFETIME: u64 = 86_400_000;
const MAX_CLIENTS: usize = 32;
#[cfg(any(target_os = "macos", windows))]
const SERVICE: &str = "com.promptlab.desktop.folder-agents";

#[derive(Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AgentAccess {
    ReadOnly,
    ReadWrite,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentRequest {
    pub label: String,
    pub access: AgentAccess,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSummary {
    pub id: String,
    pub label: String,
    pub access: AgentAccess,
    pub expires_at: u64,
    pub expired: bool,
}

// Only the trusted native review flow may receive this value. Never log it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentConnection {
    pub client: AgentSummary,
    pub library_id: String,
    pub base_url: String,
    pub token: String,
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AgentCredential {
    id: String,
    label: String,
    access: AgentAccess,
    token: String,
    expires_at: u64,
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AccessStore {
    version: u8,
    library_id: String,
    clients: Vec<AgentCredential>,
}

fn hex(value: &str, length: usize) -> bool {
    value.len() == length && value.bytes().all(|c| c.is_ascii_hexdigit())
}

fn label(value: &str) -> bool {
    !value.is_empty()
        && value == value.trim()
        && value.chars().count() <= 80
        && !value.chars().any(char::is_control)
}

fn random_hex<const N: usize>() -> Result<String, String> {
    let mut bytes = [0u8; N];
    getrandom::fill(&mut bytes).map_err(|_| "RANDOM_UNAVAILABLE".to_string())?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

impl AccessStore {
    pub(crate) fn empty(library_id: &str) -> Self {
        Self {
            version: 1,
            library_id: library_id.into(),
            clients: Vec::new(),
        }
    }

    fn valid(&self, library_id: &str, at: u64) -> bool {
        let mut ids = HashSet::new();
        let mut tokens = HashSet::new();
        self.version == 1
            && self.library_id == library_id
            && !library_id.is_empty()
            && library_id.len() <= 200
            && !library_id.chars().any(char::is_control)
            && self.clients.len() <= MAX_CLIENTS
            && self.clients.iter().all(|item| {
                item.id.strip_prefix("agent_").is_some_and(|id| hex(id, 32))
                    && label(&item.label)
                    && hex(&item.token, 64)
                    && item.expires_at > 0
                    && item.expires_at <= at.saturating_add(LIFETIME)
                    && ids.insert(&item.id)
                    && tokens.insert(&item.token)
            })
    }

    fn decode(bytes: Option<&[u8]>, library_id: &str, at: u64) -> Result<Self, String> {
        let value = match bytes {
            None => Self::empty(library_id),
            Some(bytes) if bytes.len() <= 64 * 1024 => {
                serde_json::from_slice(bytes).map_err(|_| "ACCESS_STORE_INVALID".to_string())?
            }
            Some(_) => return Err("ACCESS_STORE_INVALID".into()),
        };
        if !value.valid(library_id, at) {
            return Err("ACCESS_STORE_INVALID".into());
        }
        Ok(value)
    }

    pub(crate) fn credentials(&self, at: u64) -> Vec<Value> {
        self.clients
            .iter()
            .filter(|item| item.expires_at > at)
            .map(|item| {
                let scopes = match item.access {
                    AgentAccess::ReadOnly => vec!["read"],
                    AgentAccess::ReadWrite => vec!["read", "write"],
                };
                json!({ "id": item.id, "token": item.token, "scopes": scopes,
                "expiresAt": item.expires_at, "origin": null })
            })
            .collect()
    }

    pub(crate) fn summaries(&self, at: u64) -> Vec<AgentSummary> {
        self.clients
            .iter()
            .map(|item| AgentSummary {
                id: item.id.clone(),
                label: item.label.clone(),
                access: item.access,
                expires_at: item.expires_at,
                expired: item.expires_at <= at,
            })
            .collect()
    }

    pub(crate) fn grant(&self, request: AgentRequest, at: u64) -> Result<(Self, String), String> {
        if !label(&request.label) {
            return Err("INVALID_CLIENT".into());
        }
        if self.clients.len() >= MAX_CLIENTS {
            return Err("CLIENT_LIMIT".into());
        }
        let id = format!("agent_{}", random_hex::<16>()?);
        let mut next = self.clone();
        next.clients.push(AgentCredential {
            id: id.clone(),
            label: request.label,
            access: request.access,
            token: random_hex::<32>()?,
            expires_at: at.saturating_add(LIFETIME),
        });
        if !next.valid(&self.library_id, at) {
            return Err("ACCESS_STORE_INVALID".into());
        }
        Ok((next, id))
    }

    pub(crate) fn revoke(&self, id: &str) -> Result<Self, String> {
        if !self.clients.iter().any(|item| item.id == id) {
            return Err("CLIENT_NOT_FOUND".into());
        }
        let mut next = self.clone();
        next.clients.retain(|item| item.id != id);
        Ok(next)
    }

    pub(crate) fn connection(
        &self,
        id: &str,
        base_url: &str,
        at: u64,
    ) -> Result<AgentConnection, String> {
        let item = self
            .clients
            .iter()
            .find(|item| item.id == id && item.expires_at > at)
            .ok_or("CLIENT_UNAVAILABLE")?;
        let client = self
            .summaries(at)
            .into_iter()
            .find(|item| item.id == id)
            .ok_or("CLIENT_UNAVAILABLE")?;
        Ok(AgentConnection {
            client,
            library_id: self.library_id.clone(),
            base_url: base_url.into(),
            token: item.token.clone(),
        })
    }
}

#[cfg(any(target_os = "macos", windows))]
fn entry(library_id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, library_id).map_err(|_| "SECURE_STORE_UNAVAILABLE".into())
}

#[cfg(any(target_os = "macos", windows))]
fn read(entry: &keyring::Entry) -> Result<Option<Vec<u8>>, String> {
    match entry.get_secret() {
        Ok(bytes) => Ok(Some(bytes)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err("SECURE_STORE_UNAVAILABLE".into()),
    }
}

#[cfg(any(target_os = "macos", windows))]
pub(crate) fn load(library_id: &str, at: u64) -> Result<AccessStore, String> {
    AccessStore::decode(read(&entry(library_id)?)?.as_deref(), library_id, at)
}

fn save_with(
    previous: &AccessStore,
    next: &AccessStore,
    at: u64,
    mut read: impl FnMut() -> Result<Option<Vec<u8>>, String>,
    mut write: impl FnMut(&[u8]) -> Result<(), String>,
) -> Result<(), String> {
    if !next.valid(&previous.library_id, at) {
        return Err("ACCESS_STORE_INVALID".into());
    }
    if AccessStore::decode(read()?.as_deref(), &previous.library_id, at)? != *previous {
        return Err("ACCESS_STORE_CHANGED".into());
    }
    let bytes = serde_json::to_vec(next).map_err(|_| "ACCESS_STORE_INVALID".to_string())?;
    write(&bytes)?;
    if read()?.as_deref() != Some(bytes.as_slice()) {
        return Err("SECURE_STORE_UNVERIFIED".into());
    }
    Ok(())
}

#[cfg(any(target_os = "macos", windows))]
pub(crate) fn save(previous: &AccessStore, next: &AccessStore, at: u64) -> Result<(), String> {
    let entry = entry(&previous.library_id)?;
    save_with(
        previous,
        next,
        at,
        || read(&entry),
        |bytes| {
            entry
                .set_secret(bytes)
                .map_err(|_| "SECURE_STORE_UNAVAILABLE".into())
        },
    )
}

#[cfg(not(any(target_os = "macos", windows)))]
pub(crate) fn load(_library_id: &str, _at: u64) -> Result<AccessStore, String> {
    Err("PLATFORM_NOT_QUALIFIED".into())
}

#[cfg(not(any(target_os = "macos", windows)))]
pub(crate) fn save(_previous: &AccessStore, _next: &AccessStore, _at: u64) -> Result<(), String> {
    Err("PLATFORM_NOT_QUALIFIED".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};

    fn grant(store: &AccessStore, access: AgentAccess, at: u64) -> (AccessStore, String) {
        store
            .grant(
                AgentRequest {
                    label: "Disposable client".into(),
                    access,
                },
                at,
            )
            .unwrap()
    }

    #[test]
    fn scopes_expiry_and_public_metadata_are_bounded() {
        let initial = AccessStore::empty("fixture");
        let (read, id) = grant(&initial, AgentAccess::ReadOnly, 100);
        let (both, _) = grant(&read, AgentAccess::ReadWrite, 100);
        let credentials = both.credentials(100);
        assert_eq!(credentials[0]["scopes"], json!(["read"]));
        assert_eq!(credentials[1]["scopes"], json!(["read", "write"]));
        assert!(credentials.iter().all(|item| item["origin"].is_null()));
        assert_eq!(both.summaries(100)[0].expires_at, 100 + LIFETIME);
        assert!(both.credentials(100 + LIFETIME).is_empty());
        assert!(both
            .summaries(100 + LIFETIME)
            .iter()
            .all(|item| item.expired));
        assert_eq!(
            both.connection(&id, "http://127.0.0.1:1", 100 + LIFETIME)
                .err()
                .as_deref(),
            Some("CLIENT_UNAVAILABLE")
        );
        let metadata = serde_json::to_string(&both.summaries(100)).unwrap();
        for item in &both.clients {
            assert!(!metadata.contains(&item.token));
        }
        assert!(initial.clients.is_empty());
        assert_eq!(read.clients.len(), 1);
        assert!(both.clients[0].token != both.clients[1].token);
    }

    #[test]
    fn malformed_or_foreign_stores_are_rejected() {
        let (store, _) = grant(&AccessStore::empty("fixture"), AgentAccess::ReadOnly, 100);
        let valid = serde_json::to_vec(&store).unwrap();
        assert!(AccessStore::decode(Some(&valid), "other", 100).is_err());
        assert!(AccessStore::decode(Some(&vec![b' '; 65_537]), "fixture", 100).is_err());
        assert!(AccessStore::decode(Some(b"{}"), "fixture", 100).is_err());
        assert!(AccessStore::decode(None, "", 100).is_err());
        let value = serde_json::to_value(&store).unwrap();
        for (path, replacement) in [
            ("/version", json!(2)),
            ("/extra", json!(true)),
            ("/clients/0/id", json!("desktop")),
            ("/clients/0/token", json!("invalid")),
            ("/clients/0/label", json!(" padded ")),
            ("/clients/0/access", json!("admin")),
            ("/clients/0/expiresAt", json!(0)),
            ("/clients/0/expiresAt", json!(101 + LIFETIME)),
        ] {
            let mut changed = value.clone();
            if path == "/extra" {
                changed["extra"] = replacement;
            } else {
                *changed.pointer_mut(path).unwrap() = replacement;
            }
            assert!(
                AccessStore::decode(Some(&serde_json::to_vec(&changed).unwrap()), "fixture", 100)
                    .is_err(),
                "invalid field accepted: {path}"
            );
        }
        let mut duplicate = store.clone();
        duplicate.clients.push(store.clients[0].clone());
        assert!(!duplicate.valid("fixture", 100));
        duplicate.clients[1].id = format!("agent_{}", "b".repeat(32));
        assert!(!duplicate.valid("fixture", 100));
        assert!(AccessStore::decode(Some(&valid), "fixture", 100 + LIFETIME).is_ok());
    }

    #[test]
    fn labels_and_retained_client_count_have_limits() {
        let mut store = AccessStore::empty("fixture");
        for label in [
            "".to_string(),
            " ".into(),
            "trailing ".into(),
            "line\nbreak".into(),
            "x".repeat(81),
        ] {
            assert_eq!(
                store
                    .grant(
                        AgentRequest {
                            label,
                            access: AgentAccess::ReadOnly
                        },
                        100
                    )
                    .err()
                    .as_deref(),
                Some("INVALID_CLIENT")
            );
        }
        for _ in 0..MAX_CLIENTS {
            store = grant(&store, AgentAccess::ReadOnly, 100).0;
        }
        assert_eq!(
            store
                .grant(
                    AgentRequest {
                        label: "Overflow".into(),
                        access: AgentAccess::ReadOnly
                    },
                    100 + LIFETIME
                )
                .err()
                .as_deref(),
            Some("CLIENT_LIMIT")
        );
        let next = store.revoke(&store.clients[0].id).unwrap();
        assert!(next
            .grant(
                AgentRequest {
                    label: "Replacement".into(),
                    access: AgentAccess::ReadOnly
                },
                100 + LIFETIME
            )
            .is_ok());
    }

    #[test]
    fn persisted_grants_and_revocations_survive_reload_without_resurrection() {
        let initial = AccessStore::empty("fixture");
        let (next, id) = grant(&initial, AgentAccess::ReadOnly, 100);
        let bytes = RefCell::new(None);
        let save = |previous: &AccessStore, next: &AccessStore| {
            save_with(
                previous,
                next,
                100,
                || Ok(bytes.borrow().clone()),
                |value| {
                    *bytes.borrow_mut() = Some(value.to_vec());
                    Ok(())
                },
            )
        };
        save(&initial, &next).unwrap();
        let loaded = AccessStore::decode(bytes.borrow().as_deref(), "fixture", 100).unwrap();
        assert!(loaded == next);
        let revoked = loaded.revoke(&id).unwrap();
        save(&loaded, &revoked).unwrap();
        assert!(
            AccessStore::decode(bytes.borrow().as_deref(), "fixture", 100)
                .unwrap()
                .credentials(100)
                .is_empty()
        );
        assert_eq!(
            revoked.revoke(&id).err().as_deref(),
            Some("CLIENT_NOT_FOUND")
        );
    }

    #[test]
    fn stale_registry_denial_and_uncertain_readback_never_report_success() {
        let initial = AccessStore::empty("fixture");
        let (next, _) = grant(&initial, AgentAccess::ReadOnly, 100);
        let bytes = serde_json::to_vec(&next).unwrap();
        let writes = Cell::new(0);
        let stale = save_with(
            &initial,
            &next,
            100,
            || Ok(Some(bytes.clone())),
            |_| {
                writes.set(writes.get() + 1);
                Ok(())
            },
        );
        assert_eq!(stale.err().as_deref(), Some("ACCESS_STORE_CHANGED"));
        assert_eq!(writes.get(), 0);
        assert_eq!(
            save_with(
                &initial,
                &next,
                100,
                || Err("DENIED".into()),
                |_| panic!("denied read must not write")
            )
            .err()
            .as_deref(),
            Some("DENIED")
        );
        assert_eq!(
            save_with(&initial, &next, 100, || Ok(None), |_| Err("DENIED".into()))
                .err()
                .as_deref(),
            Some("DENIED")
        );
        assert_eq!(
            save_with(&initial, &next, 100, || Ok(None), |_| Ok(()))
                .err()
                .as_deref(),
            Some("SECURE_STORE_UNVERIFIED")
        );
    }

    #[cfg(any(target_os = "macos", windows))]
    #[test]
    #[ignore = "requires explicit acceptance against a disposable platform credential entry"]
    fn real_secure_store_retains_grant_and_revocation() {
        let id = format!("disposable-agent-{}", random_hex::<16>().unwrap());
        let entry = entry(&id).unwrap();
        assert!(read(&entry).unwrap().is_none());
        struct Cleanup(keyring::Entry);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                let _ = self.0.delete_credential();
            }
        }
        let cleanup = Cleanup(entry);
        let at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;
        let initial = load(&id, at).unwrap();
        let (next, client) = grant(&initial, AgentAccess::ReadWrite, at);
        save(&initial, &next, at).unwrap();
        assert!(load(&id, at).unwrap() == next);
        let revoked = next.revoke(&client).unwrap();
        save(&next, &revoked, at).unwrap();
        assert!(load(&id, at).unwrap().credentials(at).is_empty());
        cleanup.0.delete_credential().unwrap();
        assert!(read(&cleanup.0).unwrap().is_none());
    }
}
