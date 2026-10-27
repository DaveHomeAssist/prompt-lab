use crate::diagnostics_store::{export_path, LogStore, Watchdog};
use serde_json::{json, Value};
use std::{fs, sync::{Arc, Mutex}, time::{Duration, Instant, SystemTime, UNIX_EPOCH}};
use tauri::{Emitter, Manager};

const FRONT_CODES: &[&str] = &["session_start", "session_end", "renderer_ready", "react_error", "uncaught_error", "unhandled_rejection", "storage_warning", "storage_error", "operation_start", "operation_end", "operation_error", "operation_cancel", "report_preview", "report_export"];
const NATIVE_CODES: &[&str] = &["native_start", "native_exit", "native_panic", "interrupted_session", "renderer_hang_suspected", "renderer_recovered", "monitor_gap", "export_written"];
fn timestamp_ms() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64 }
fn valid_id(value: &str) -> bool { (8..=64).contains(&value.len()) && value.bytes().all(|c| c.is_ascii_hexdigit() || c == b'-') }
fn frame(value: &str) -> bool {
    let parts: Vec<_> = value.split(':').collect();
    let source = ["App.jsx", "main.jsx", "main-web.jsx", "main-desktop.jsx", "ErrorBoundary.jsx", "ReportProblemHost.jsx", "diagnostics.js", "desktopApi.js", "logger.js", "useExecutionFlow.js", "useExecutionFlow.jsx"].contains(&parts[0]);
    let bundle = option_env!("PROMPTLAB_DIAGNOSTIC_FILES").unwrap_or("").split(',').any(|s| !s.is_empty() && s == parts[0]);
    parts.len() == 3 && (source || bundle) && parts[0].len() <= 100 && parts[0].bytes().all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
        && [".js", ".jsx", ".ts", ".tsx"].iter().any(|ext| parts[0].ends_with(ext))
        && parts[1..].iter().all(|s| !s.is_empty() && s.len() <= 7 && s.bytes().all(|b| b.is_ascii_digit()))
}
fn metadata(value: &Value) -> Value {
    let mut result = serde_json::Map::new();
    for key in ["durationMs", "status", "heapBytes", "gapMs"] {
        if let Some(number) = value.get(key).and_then(Value::as_f64) { if number.is_finite() && (0.0..=9_007_199_254_740_991.0).contains(&number) { result.insert(key.into(), json!(number)); } }
    }
    if let Some(visible) = value.get("visible").and_then(Value::as_bool) { result.insert("visible".into(), json!(visible)); }
    for (key, allowed) in [
        ("provider", &["anthropic", "openai", "gemini", "openrouter", "ollama", "unknown"][..]),
        ("operation", &["model", "enhance", "test", "storage", "report", "unknown"][..]),
        ("errorType", &["Error", "TypeError", "RangeError", "SyntaxError", "AbortError", "QuotaExceededError", "SecurityError", "UnknownError"][..]),
    ] { if let Some(text) = value.get(key).and_then(Value::as_str) { if allowed.contains(&text) { result.insert(key.into(), json!(text)); } } }
    Value::Object(result)
}
fn normalized(input: &Value, code: &str, timestamp: u64, session: &str) -> Value {
    let revision = input["revision"].as_str().filter(|s| (7..=40).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_hexdigit()))
        .unwrap_or(option_env!("PROMPTLAB_REVISION").unwrap_or("unknown"));
    let version = input["version"].as_str().filter(|s| s.len() <= 16 && s.bytes().all(|b| b.is_ascii_digit() || b == b'.')).unwrap_or(env!("CARGO_PKG_VERSION"));
    let severity = if code.contains("error") || code.contains("panic") || code.contains("rejection") { "error" } else if code.contains("warning") || code.contains("suspected") || code == "interrupted_session" { "warning" } else { "info" };
    let mut result = json!({"schemaVersion": 1, "timestampMs": timestamp, "code": code,
        "version": version, "revision": revision, "severity":severity,
        "surface": "desktop", "nativeSessionId": session, "metadata": metadata(&input["metadata"])});
    for key in ["sessionId", "operationId", "eventId"] {
        if let Some(id) = input.get(key).and_then(Value::as_str) { if valid_id(id) { result[key] = json!(id); } }
    }
    result["frames"] = json!(input["frames"].as_array().map(|items| items.iter().filter_map(Value::as_str).filter(|s| frame(s)).take(12).collect::<Vec<_>>()).unwrap_or_default());
    result
}

struct Inner {
    store: Option<LogStore>, memory: Vec<Value>, warnings: u64, session: String,
    started: Instant, monitor: Watchdog, rate_second: u64, rate_count: u32, dropped: u64,
}
#[derive(Clone)]
pub struct Diagnostics(Arc<Mutex<Inner>>);
impl Diagnostics {
    fn prepare_report(&self, reviewed: &Value) -> Result<Value, String> {
        if reviewed.to_string().len() > 2 * 1024 * 1024 { return Err("report_too_large".into()); }
        let mut report = json!({"schemaVersion":1, "reportId": reviewed["reportId"].as_str().filter(|s| valid_id(s)).unwrap_or("00000000"),
            "version":env!("CARGO_PKG_VERSION"), "revision":option_env!("PROMPTLAB_REVISION").unwrap_or("unknown"), "surface":"desktop",
            "description":reviewed["description"].as_str().unwrap_or("").chars().take(4000).collect::<String>(),
            "warnings":[], "resourceCoverage":"Renderer JavaScript heap where available; CPU/RSS are not sampled automatically."});
        for (key, native) in [("events", false), ("native", true)] {
            let input = if native { &reviewed["native"]["events"] } else { &reviewed["events"] };
            let events = input.as_array().map(|events| events.iter().take(2000).filter_map(|event| {
                event["code"].as_str().filter(|c| FRONT_CODES.contains(c) || (native && NATIVE_CODES.contains(c))).map(|code| {
                    let session = event["nativeSessionId"].as_str().filter(|s| valid_id(s)).unwrap_or("00000000");
                    normalized(event, code, event["timestampMs"].as_u64().unwrap_or(0), session)
                })
            }).collect::<Vec<_>>()).unwrap_or_default();
            if native {
                report[key] = json!({"events":events,
                    "writeOrReadFailures":reviewed["native"]["writeOrReadFailures"].as_u64().unwrap_or(0),
                    "droppedEvents":reviewed["native"]["droppedEvents"].as_u64().unwrap_or(0),
                    "persistentLogAvailable":reviewed["native"]["persistentLogAvailable"].as_bool().unwrap_or(false)});
            } else { report[key] = json!(events); }
        }
        if reviewed["warnings"].as_array().is_some_and(|w| !w.is_empty()) {
            report["warnings"] = json!(["Some browser diagnostic evidence is unavailable; this report may be incomplete."]);
        }
        report["droppedEvents"] = json!(reviewed["droppedEvents"].as_u64().unwrap_or(0));
        Ok(report)
    }
    fn log(&self, code: &str, input: &Value) {
        if let Ok(mut inner) = self.0.lock() {
            let event = normalized(input, code, timestamp_ms(), &inner.session);
            if let Some(store) = &inner.store { if store.append(&event.to_string()).is_err() { inner.warnings += 1; } }
            inner.memory.push(event);
            if inner.memory.len() > 2000 { inner.memory.remove(0); }
        }
    }
    fn snapshot(&self) -> Result<Value, String> {
        let mut inner = self.0.lock().map_err(|_| "diagnostics_unavailable")?;
        let mut events = Vec::new();
        if let Some(store) = &inner.store {
            match store.read() {
                Ok(lines) => for line in lines {
                    if let Ok(value) = serde_json::from_str::<Value>(&line) {
                        if let Some(code) = value["code"].as_str().filter(|c| FRONT_CODES.contains(c) || NATIVE_CODES.contains(c)) {
                            let time = value["timestampMs"].as_u64().unwrap_or(0);
                            if timestamp_ms().saturating_sub(time) <= 7 * 86400_000 {
                                let session = value["nativeSessionId"].as_str().filter(|s| valid_id(s)).unwrap_or("previous");
                                events.push(normalized(&value, code, time, session));
                            }
                        }
                    }
                },
                Err(_) => inner.warnings += 1,
            }
        }
        if events.is_empty() { events = inner.memory.iter().filter(|e| timestamp_ms().saturating_sub(e["timestampMs"].as_u64().unwrap_or(0)) <= 7 * 86400_000).cloned().collect(); }
        Ok(json!({"schemaVersion":1, "events":events, "writeOrReadFailures":inner.warnings,
            "droppedEvents":inner.dropped, "persistentLogAvailable":inner.store.is_some(),
            "resourceCoverage":"Heartbeat carries renderer JavaScript heap if exposed by WebView; CPU/RSS unavailable."}))
    }
    pub fn export(&self) -> Result<String, String> { self.export_report(None) }
    pub fn export_report(&self, reviewed: Option<&Value>) -> Result<String, String> {
        if reviewed.is_some_and(|r| r.to_string().len() > 2 * 1024 * 1024) { return Err("report_too_large".into()); }
        let report = match reviewed {
            Some(value) => self.prepare_report(value)?,
            None => json!({"reportId":format!("native-{}",timestamp_ms()), "createdAtMs":timestamp_ms(), "native":self.snapshot()?}),
        };
        let inner = self.0.lock().map_err(|_| "diagnostics_unavailable")?;
        let store = inner.store.as_ref().ok_or("diagnostic_directory_unavailable")?;
        let destination = export_path(&store.directory, timestamp_ms());
        fs::write(&destination, serde_json::to_vec_pretty(&report).map_err(|_| "report_encoding_failed")?).map_err(|_| "report_write_failed")?;
        // Explicit exports have the same bounded count and age policy as log files.
        let mut reports = fs::read_dir(&store.directory).map_err(|_| "report_directory_unreadable")?.filter_map(Result::ok)
            .filter(|e| e.file_name().to_string_lossy().starts_with("promptlab-diagnostics-") && e.path().extension().and_then(|s| s.to_str()) == Some("json"))
            .collect::<Vec<_>>();
        reports.sort_by_key(|e| e.metadata().and_then(|m| m.modified()).unwrap_or(UNIX_EPOCH));
        let remove_count = reports.len().saturating_sub(5);
        for (index, report) in reports.into_iter().enumerate() {
            let old = report.metadata().and_then(|m| m.modified()).ok().and_then(|t| SystemTime::now().duration_since(t).ok()).is_some_and(|age| age > Duration::from_secs(7 * 86400));
            if index < remove_count || old { let _ = fs::remove_file(report.path()); }
        }
        Ok(destination.to_string_lossy().into_owned())
    }
    pub fn finish(&self) {
        self.log("native_exit", &json!({}));
        if let Ok(inner) = self.0.lock() { if let Some(store) = &inner.store { let _ = fs::remove_file(store.marker()); } }
    }
}

#[tauri::command]
pub fn diagnostics_record(state: tauri::State<'_, Diagnostics>, event: Value) -> Result<(), String> {
    if event.to_string().len() > 16_384 { return Err("event_too_large".into()); }
    let code = event["code"].as_str().filter(|s| FRONT_CODES.contains(s)).ok_or("unknown_event_code")?;
    {
        let mut inner = state.0.lock().map_err(|_| "diagnostics_unavailable")?;
        let second = timestamp_ms() / 1000;
        if inner.rate_second != second { inner.rate_second = second; inner.rate_count = 0; }
        if inner.rate_count >= 20 { inner.dropped += 1; return Ok(()); }
        inner.rate_count += 1;
    }
    state.log(code, &event); Ok(())
}
#[tauri::command]
pub fn diagnostics_heartbeat(state: tauri::State<'_, Diagnostics>, visible: bool, heap_bytes: Option<u64>) -> Result<(), String> {
    let recovered = {
        let mut inner = state.0.lock().map_err(|_| "diagnostics_unavailable")?;
        let elapsed = inner.started.elapsed().as_millis() as u64;
        inner.monitor.heartbeat(elapsed, visible)
    };
    if let Some(code) = recovered { state.log(code, &json!({"metadata":{"visible":visible,"heapBytes":heap_bytes}})); }
    // Persist a sparse resource sample; heartbeats themselves do not flood the log.
    let sample = { let inner = state.0.lock().map_err(|_| "diagnostics_unavailable")?; inner.started.elapsed().as_secs() % 30 < 2 };
    if sample { state.log("renderer_ready", &json!({"metadata":{"visible":visible,"heapBytes":heap_bytes}})); }
    Ok(())
}
#[tauri::command]
pub fn diagnostics_read(state: tauri::State<'_, Diagnostics>) -> Result<Value, String> { state.snapshot() }
#[tauri::command]
pub fn diagnostics_prepare(state: tauri::State<'_, Diagnostics>, report: Value) -> Result<Value, String> { state.prepare_report(&report) }
#[tauri::command]
pub fn diagnostics_export(state: tauri::State<'_, Diagnostics>, report: Option<Value>) -> Result<String, String> { state.export_report(report.as_ref()) }

pub fn initialize(app: &tauri::AppHandle) -> Diagnostics {
    let store = app.path().app_log_dir().ok().and_then(|dir| LogStore::new(dir).ok());
    let interrupted = store.as_ref().is_some_and(|s| s.marker().exists());
    let state = Diagnostics(Arc::new(Mutex::new(Inner { warnings: if store.is_some() { 0 } else { 1 }, store,
        session: format!("{:x}-{:x}", std::process::id(), timestamp_ms()), started:Instant::now(),
        memory:Vec::new(), monitor:Watchdog { seen:true, visible:true, ..Watchdog::default() }, rate_second:0, rate_count:0, dropped:0 })));
    state.log("native_start", &json!({}));
    if interrupted { state.log("interrupted_session", &json!({})); }
    if let Ok(inner) = state.0.lock() { if let Some(store) = &inner.store { let _ = fs::write(store.marker(), b"active"); } }
    let panic_state = state.clone();
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        // Do not serialize panic payloads or filesystem paths.
        panic_state.log("native_panic", &json!({})); previous(info);
    }));
    let watcher = state.clone(); let handle = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(2));
        // This thread is independent of the WebView JavaScript event loop.
        let visible = handle.get_webview_window("main").map(|w| w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(true)).unwrap_or(false);
        let transition = if let Ok(mut inner) = watcher.0.lock() {
            let elapsed = inner.started.elapsed().as_millis() as u64;
            let gap = elapsed.saturating_sub(inner.monitor.last_heartbeat_ms);
            inner.monitor.tick(elapsed, visible).map(|code| (code, gap))
        } else { None };
        if let Some((code, gap)) = transition {
            watcher.log(code, &json!({"metadata":{"gapMs":gap,"visible":visible}}));
            let _ = handle.emit("promptlab:diagnostic-event", code);
        }
    });
    state
}

pub fn reveal_report(path: &str) {
    let Some(directory) = std::path::Path::new(path).parent() else { return; };
    #[cfg(target_os = "windows")] { let _ = std::process::Command::new("explorer.exe").arg(directory).spawn(); }
    #[cfg(target_os = "macos")] { let _ = std::process::Command::new("open").arg(directory).spawn(); }
    #[cfg(target_os = "linux")] { let _ = std::process::Command::new("xdg-open").arg(directory).spawn(); }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn privacy_and_reviewed_export_are_idempotent() {
        let dir = std::env::temp_dir().join(format!("pl-report-{}-{}", std::process::id(), timestamp_ms()));
        let state = Diagnostics(Arc::new(Mutex::new(Inner {store:Some(LogStore::new(dir.clone()).unwrap()),memory:vec![],warnings:0,session:"12345678".into(),started:Instant::now(),monitor:Watchdog::default(),rate_second:0,rate_count:0,dropped:0})));
        let raw = json!({"reportId":"12345678-abcd", "description":"Explicit user text", "warnings":[], "events":[{"code":"uncaught_error","timestampMs":timestamp_ms(),"message":"PRIVATE_CANARY","metadata":{"prompt":"PRIVATE_CANARY","errorType":"TypeError"},"frames":["secret-customer.js:1:1","App.jsx:42:7"]}],"native":{"events":[]}});
        let preview = state.prepare_report(&raw).unwrap();
        assert!(!preview.to_string().contains("PRIVATE_CANARY"));
        assert!(!preview.to_string().contains("secret-customer"));
        assert_eq!(preview["events"][0]["frames"],json!(["App.jsx:42:7"]));
        assert_eq!(state.prepare_report(&preview).unwrap(),preview);
        let path = state.export_report(Some(&preview)).unwrap();
        assert_eq!(serde_json::from_str::<Value>(&fs::read_to_string(path).unwrap()).unwrap(),preview);
        fs::remove_dir_all(dir).unwrap();
    }
}
