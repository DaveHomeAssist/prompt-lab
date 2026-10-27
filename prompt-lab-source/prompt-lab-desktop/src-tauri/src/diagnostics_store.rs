use std::{fs::{self, OpenOptions}, io::{self, Write}, path::{Path, PathBuf}, time::{Duration, SystemTime}};

pub const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
pub const FILE_COUNT: usize = 5;
const RETENTION: Duration = Duration::from_secs(7 * 86400);

pub struct LogStore { pub directory: PathBuf, limit: u64 }
impl LogStore {
    pub fn new(directory: PathBuf) -> io::Result<Self> {
        fs::create_dir_all(&directory)?;
        let store = Self { directory, limit: MAX_FILE_BYTES };
        store.prune(SystemTime::now())?;
        Ok(store)
    }
    fn file(&self, index: usize) -> PathBuf { self.directory.join(format!("diagnostics-{index}.jsonl")) }
    pub fn prune(&self, now: SystemTime) -> io::Result<()> {
        for index in 0..FILE_COUNT {
            let path = self.file(index);
            if let Ok(modified) = fs::metadata(&path).and_then(|m| m.modified()) {
                if now.duration_since(modified).unwrap_or_default() > RETENTION { fs::remove_file(path)?; }
            }
        }
        Ok(())
    }
    pub fn append(&self, line: &str) -> io::Result<()> {
        if line.len() as u64 > self.limit / 2 { return Err(io::Error::new(io::ErrorKind::InvalidInput, "event_too_large")); }
        self.prune(SystemTime::now())?;
        let size = fs::metadata(self.file(0)).map(|m| m.len()).unwrap_or(0);
        if size + line.len() as u64 + 1 > self.limit {
            if self.file(FILE_COUNT - 1).exists() { fs::remove_file(self.file(FILE_COUNT - 1))?; }
            for index in (0..FILE_COUNT - 1).rev() {
                if self.file(index).exists() { fs::rename(self.file(index), self.file(index + 1))?; }
            }
        }
        let mut file = OpenOptions::new().create(true).append(true).open(self.file(0))?;
        writeln!(file, "{line}")?;
        file.flush()
    }
    pub fn read(&self) -> io::Result<Vec<String>> {
        let mut lines = Vec::new();
        // Fixed filenames only. User report data never chooses a read path.
        for index in (0..FILE_COUNT).rev() {
            let path = self.file(index);
            if !path.exists() { continue; }
            if fs::metadata(&path)?.len() > self.limit { return Err(io::Error::new(io::ErrorKind::InvalidData, "log_oversized")); }
            lines.extend(fs::read_to_string(path)?.lines().filter(|s| s.len() <= 16_384).map(str::to_owned));
        }
        // Export only the recent bounded window, including prior sessions.
        let mut count = 0;
        let mut result = Vec::new();
        for line in lines.into_iter().rev() {
            count += line.len();
            if count > 1024 * 1024 || result.len() >= 2000 { break; }
            result.push(line);
        }
        result.reverse();
        Ok(result)
    }
    pub fn marker(&self) -> PathBuf { self.directory.join("session-active") }
}

#[derive(Default)]
pub struct Watchdog { pub seen: bool, pub visible: bool, pub last_heartbeat_ms: u64, pub last_tick_ms: u64, pub hung: bool }
impl Watchdog {
    pub fn heartbeat(&mut self, now_ms: u64, visible: bool) -> Option<&'static str> {
        let recovered = self.hung;
        self.seen = true; self.visible = visible; self.last_heartbeat_ms = now_ms; self.hung = false;
        if recovered { Some("renderer_recovered") } else { None }
    }
    pub fn tick(&mut self, now_ms: u64, window_visible: bool) -> Option<&'static str> {
        let tick_gap = now_ms.saturating_sub(self.last_tick_ms);
        self.last_tick_ms = now_ms;
        if !window_visible { self.last_heartbeat_ms = now_ms; self.hung = false; return None; }
        // A paused monitor may mean sleep/suspend. Start a new observation window.
        if tick_gap > 10_000 { self.last_heartbeat_ms = now_ms; self.hung = false; return Some("monitor_gap"); }
        if self.seen && self.visible && window_visible && !self.hung && now_ms.saturating_sub(self.last_heartbeat_ms) >= 15_000 {
            self.hung = true; return Some("renderer_hang_suspected");
        }
        None
    }
}

pub fn export_path(directory: &Path, timestamp_ms: u64) -> PathBuf {
    directory.join(format!("promptlab-diagnostics-{timestamp_ms}.json"))
}

#[cfg(test)]
mod tests {
    use super::*;
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    fn temp() -> PathBuf { std::env::temp_dir().join(format!("pl-diag-{}-{}-{}", std::process::id(), SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap().as_nanos(), NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed))) }
    #[test] fn rotates_and_retains_only_fixed_files() {
        let dir = temp(); let mut store = LogStore::new(dir.clone()).unwrap(); store.limit = 40;
        for _ in 0..20 { store.append("123456789012345").unwrap(); }
        assert_eq!(fs::read_dir(&dir).unwrap().count(), FILE_COUNT);
        assert!(store.read().unwrap().len() <= 10);
        assert!(store.append(&"a".repeat(30)).is_err());
        store.prune(SystemTime::now() + RETENTION + Duration::from_secs(1)).unwrap();
        assert!(store.read().unwrap().is_empty());
        fs::remove_dir_all(dir).unwrap();
    }
    #[test] fn failed_directory_is_reported() {
        let path = temp(); fs::write(&path, "not a directory").unwrap();
        assert!(LogStore::new(path.clone()).is_err()); fs::remove_file(path).unwrap();
    }
    #[test] fn hang_is_once_per_episode_and_sleep_is_not_a_hang() {
        let mut monitor = Watchdog::default(); monitor.heartbeat(0, true);
        for t in (2000..15000).step_by(2000) { assert_eq!(monitor.tick(t, true), None); }
        assert_eq!(monitor.tick(16000, true), Some("renderer_hang_suspected"));
        assert_eq!(monitor.tick(18000, true), None);
        assert_eq!(monitor.heartbeat(19000, true), Some("renderer_recovered"));
        assert_eq!(monitor.tick(120000, true), Some("monitor_gap"));
        monitor.heartbeat(121000, false);
        assert_eq!(monitor.tick(123000, false), None);
    }
}
