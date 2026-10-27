fn main() {
    let assets = std::fs::read_dir("../dist/assets").ok().into_iter().flatten().filter_map(Result::ok)
        .filter_map(|e| e.file_name().into_string().ok()).filter(|s| s.ends_with(".js")).collect::<Vec<_>>().join(",");
    println!("cargo:rustc-env=PROMPTLAB_DIAGNOSTIC_FILES={assets}");
    println!("cargo:rerun-if-changed=../dist/assets");
    let revision = std::process::Command::new("git").args(["rev-parse", "--short=7", "HEAD"])
        .output().ok().filter(|output| output.status.success())
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .map(|s| s.trim().to_owned()).filter(|s| s.len() >= 7 && s.len() <= 40 && s.bytes().all(|b| b.is_ascii_hexdigit()))
        .unwrap_or_else(|| "unknown".into());
    println!("cargo:rustc-env=PROMPTLAB_REVISION={revision}");
    // Track both symbolic HEAD and its target: commits normally change only the ref.
    for name in ["HEAD".to_owned(), std::process::Command::new("git").args(["symbolic-ref", "-q", "HEAD"])
        .output().ok().and_then(|o| String::from_utf8(o.stdout).ok()).unwrap_or_default().trim().to_owned()] {
        if name.is_empty() { continue; }
        if let Ok(output) = std::process::Command::new("git").args(["rev-parse", "--path-format=absolute", "--git-path", &name]).output() {
            if output.status.success() { println!("cargo:rerun-if-changed={}", String::from_utf8_lossy(&output.stdout).trim()); }
        }
    }
    tauri_build::build()
}
