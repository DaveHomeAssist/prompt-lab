// Desktop "highlight to enhance".
//
// The global shortcut copies the selection with a saved clipboard, the floating
// window enhances it with the same provider path as the app, and Accept pastes
// over the selection before the original clipboard value is restored.
//
// TODO(highlight-enhance): add a macOS Services menu entry ("Enhance with Prompt Lab")
// so the flow is available from an app's Services menu without the global shortcut.
// That needs an NSServices declaration and an app-delegate handler. Not in this change.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{fs, path::PathBuf, thread, time::Duration};
#[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
use std::process::Command;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

const WINDOW: &str = "highlight-accept";
const LIMIT: usize = 20_000;
pub const SECURE_FIELD_MESSAGE: &str = "Secure field, nothing sent.";

/// Password managers mark concealed or transient pasteboard items with these
/// types. The text itself can look ordinary, so the type is what we trust.
pub fn concealed_pasteboard_type(types: &[impl AsRef<str>]) -> bool {
    types.iter().any(|kind| {
        let name = kind.as_ref();
        name.eq_ignore_ascii_case("org.nspasteboard.ConcealedType")
            || name.eq_ignore_ascii_case("org.nspasteboard.TransientType")
    })
}

/// A true result from IsSecureEventInputEnabled means the copy must not run.
pub fn secure_input_block(enabled: bool) -> Option<&'static str> {
    if enabled { Some(SECURE_FIELD_MESSAGE) } else { None }
}

#[derive(Clone, Serialize, Deserialize)]
struct HighlightConfig {
    enabled: bool,
    accelerator: String,
}

pub struct HighlightState {
    config: std::sync::Mutex<HighlightConfig>,
    payload: std::sync::Mutex<Option<Value>>,
    busy: std::sync::Mutex<bool>,
}

impl HighlightState {
    pub fn new() -> Self {
        Self {
            config: std::sync::Mutex::new(HighlightConfig {
                enabled: true,
                accelerator: default_accelerator().to_string(),
            }),
            payload: std::sync::Mutex::new(None),
            busy: std::sync::Mutex::new(false),
        }
    }
}

fn default_accelerator() -> &'static str {
    if cfg!(target_os = "macos") { "alt+command+E" } else { "alt+control+E" }
}

pub fn permission_message() -> &'static str {
    "Prompt Lab needs Accessibility permission to read the selection and paste the enhanced text.\n\n1. Open System Settings.\n2. Go to Privacy & Security, then Accessibility.\n3. Turn Prompt Lab on.\n4. Press the shortcut again.\n\nThe clipboard was not changed."
}

/// What was on the clipboard before we borrowed it. Text is the common case.
/// Image, HTML, and file lists have no plain-text form; they are snapshotted
/// and put back so a picture or a copied file is not replaced by an empty string.
#[derive(Clone)]
pub(crate) enum ClipHold {
    Text(String),
    Html(String),
    Image(arboard::ImageData<'static>),
    Files(Vec<PathBuf>),
    Empty,
}

impl ClipHold {
    fn text_content(&self) -> Option<&str> {
        match self {
            ClipHold::Text(text) => Some(text),
            _ => None,
        }
    }
}

pub(crate) trait ClipboardPort {
    fn capture_hold(&mut self) -> Result<ClipHold, String>;
    fn apply_hold(&mut self, hold: &ClipHold) -> Result<(), String>;
    fn write_text(&mut self, text: &str) -> Result<(), String>;
    fn pasteboard_types(&mut self) -> Vec<String> { Vec::new() }
}

fn restore_hold<C: ClipboardPort>(clip: &mut C, hold: &ClipHold) -> Result<(), String> {
    clip.apply_hold(hold)?;
    // Text is compared exactly. An image the OS re-encodes can come back with
    // different bytes even though apply_hold succeeded, so a failed re-read
    // there is not treated as data loss.
    if let ClipHold::Text(text) = hold {
        let restored = clip.capture_hold()?;
        if restored.text_content() != Some(text.as_str()) {
            return Err("Couldn't restore the clipboard.".into());
        }
    }
    Ok(())
}

/// Same steps as src/lib/highlight/clipboardEnhance.js, plus a snapshot of a
/// clipboard that has no text (an image, HTML, or a file list).
pub fn capture_selection<C: ClipboardPort>(clip: &mut C, copy: impl FnOnce(&mut C) -> Result<(), String>, nonce: u64) -> Result<String, String> {
    let original = clip.capture_hold()?;
    let sentinel = format!("\u{0}promptlab-{nonce}");
    if let Err(error) = clip.write_text(&sentinel) {
        return Err(error);
    }
    if let Err(error) = copy(clip) {
        let _ = clip.apply_hold(&original);
        return Err(error);
    }
    let selected = clip.capture_hold().ok().and_then(|hold| hold.text_content().map(str::to_string)).unwrap_or_default();
    if concealed_pasteboard_type(&clip.pasteboard_types()) {
        let _ = clip.apply_hold(&original);
        return Err(SECURE_FIELD_MESSAGE.into());
    }
    restore_hold(clip, &original).map_err(|_| "Couldn't restore the clipboard after copying the selection.".to_string())?;
    if selected == sentinel {
        return Err("Couldn't copy the selection. On macOS, grant Accessibility permission and try again.".into());
    }
    if selected.trim().is_empty() {
        return Err("No text was selected.".into());
    }
    if selected.contains('\u{0}') {
        return Err("The selection looked like an internal clipboard marker, so nothing was sent.".into());
    }
    Ok(selected)
}

/// Writes the enhanced text, pastes, then puts back whatever the clipboard held.
pub fn paste_and_restore<C: ClipboardPort>(clip: &mut C, enhanced: &str, paste: impl FnOnce(&mut C) -> Result<(), String>) -> Result<(), String> {
    if enhanced.is_empty() {
        return Err("There is no enhanced text to paste.".into());
    }
    if enhanced.contains('\u{0}') || enhanced.chars().count() > LIMIT {
        return Err("Refusing to paste that text.".into());
    }
    let current = clip.capture_hold()?;
    let pasted = (|| {
        clip.write_text(enhanced)?;
        paste(clip)
    })();
    if let Err(error) = pasted {
        let _ = clip.apply_hold(&current);
        return Err(error);
    }
    restore_hold(clip, &current).map_err(|_| "The enhanced text was pasted, but the clipboard could not be restored.".to_string())
}

struct OsClipboard {
    inner: arboard::Clipboard,
}

impl OsClipboard {
    fn new() -> Result<Self, String> {
        arboard::Clipboard::new()
            .map(|inner| Self { inner })
            .map_err(|error| format!("Clipboard is unavailable: {error}"))
    }
}

impl OsClipboard {
    fn capture_non_text(&mut self) -> Result<ClipHold, String> {
        match self.inner.get_image() {
            Ok(image) => return Ok(ClipHold::Image(image)),
            Err(arboard::Error::ContentNotAvailable) => {}
            Err(error) => return Err(format!("The clipboard isn't plain text and couldn't be saved: {error}")),
        }
        match self.inner.get().file_list() {
            Ok(files) if !files.is_empty() => return Ok(ClipHold::Files(files)),
            Ok(_) => {}
            Err(arboard::Error::ContentNotAvailable) => {}
            Err(error) => return Err(format!("The clipboard isn't plain text and couldn't be saved: {error}")),
        }
        match self.inner.get().html() {
            Ok(html) if !html.is_empty() => return Ok(ClipHold::Html(html)),
            Ok(_) => {}
            Err(arboard::Error::ContentNotAvailable) => {}
            Err(error) => return Err(format!("The clipboard isn't plain text and couldn't be saved: {error}")),
        }
        Ok(ClipHold::Empty)
    }
}

impl ClipboardPort for OsClipboard {
    fn capture_hold(&mut self) -> Result<ClipHold, String> {
        match self.inner.get_text() {
            Ok(text) => Ok(ClipHold::Text(text)),
            Err(arboard::Error::ContentNotAvailable) => self.capture_non_text(),
            Err(error) => Err(format!("Couldn't read the clipboard: {error}")),
        }
    }
    fn apply_hold(&mut self, hold: &ClipHold) -> Result<(), String> {
        match hold {
            ClipHold::Text(text) => self.inner.set_text(text).map_err(|error| format!("Couldn't write the clipboard: {error}")),
            ClipHold::Html(html) => self.inner.set_html(html.as_str(), None::<&str>).map_err(|error| format!("Couldn't restore clipboard HTML: {error}")),
            ClipHold::Image(image) => self.inner.set_image(image.clone()).map_err(|error| format!("Couldn't restore the clipboard image: {error}")),
            ClipHold::Files(files) => self.inner.set().file_list(files).map_err(|error| format!("Couldn't restore the clipboard files: {error}")),
            ClipHold::Empty => self.inner.clear().map_err(|error| format!("Couldn't clear the clipboard: {error}")),
        }
    }
    fn write_text(&mut self, text: &str) -> Result<(), String> {
        self.inner.set_text(text).map_err(|error| format!("Couldn't write the clipboard: {error}"))
    }
    fn pasteboard_types(&mut self) -> Vec<String> {
        current_pasteboard_types()
    }
}

fn modifier(name: &str) -> Result<Modifiers, String> {
    match name.to_ascii_lowercase().as_str() {
        "alt" | "option" => Ok(Modifiers::ALT),
        "shift" => Ok(Modifiers::SHIFT),
        "ctrl" | "control" => Ok(Modifiers::CONTROL),
        "cmd" | "command" | "meta" | "super" => Ok(Modifiers::SUPER),
        "commandorcontrol" => Ok(if cfg!(target_os = "macos") { Modifiers::SUPER } else { Modifiers::CONTROL }),
        other => Err(format!("Unknown modifier \"{other}\".")),
    }
}

fn code_for(key: char) -> Result<Code, String> {
    Ok(match key.to_ascii_uppercase() {
        'A' => Code::KeyA, 'B' => Code::KeyB, 'C' => Code::KeyC, 'D' => Code::KeyD, 'E' => Code::KeyE,
        'F' => Code::KeyF, 'G' => Code::KeyG, 'H' => Code::KeyH, 'I' => Code::KeyI, 'J' => Code::KeyJ,
        'K' => Code::KeyK, 'L' => Code::KeyL, 'M' => Code::KeyM, 'N' => Code::KeyN, 'O' => Code::KeyO,
        'P' => Code::KeyP, 'Q' => Code::KeyQ, 'R' => Code::KeyR, 'S' => Code::KeyS, 'T' => Code::KeyT,
        'U' => Code::KeyU, 'V' => Code::KeyV, 'W' => Code::KeyW, 'X' => Code::KeyX, 'Y' => Code::KeyY,
        'Z' => Code::KeyZ,
        '0' => Code::Digit0, '1' => Code::Digit1, '2' => Code::Digit2, '3' => Code::Digit3, '4' => Code::Digit4,
        '5' => Code::Digit5, '6' => Code::Digit6, '7' => Code::Digit7, '8' => Code::Digit8, '9' => Code::Digit9,
        _ => return Err("The shortcut key must be a single letter or digit.".into()),
    })
}

pub fn parse_accelerator(input: &str) -> Result<Shortcut, String> {
    let parts: Vec<&str> = input.split('+').map(str::trim).filter(|part| !part.is_empty()).collect();
    if parts.len() < 2 {
        return Err("Use a modifier plus a key, such as Alt+Command+E.".into());
    }
    let key = parts[parts.len() - 1];
    let mut chars = key.chars();
    let ch = chars.next().ok_or_else(|| "The shortcut key must be a single letter or digit.".to_string())?;
    if chars.next().is_some() || !ch.is_ascii_alphanumeric() {
        return Err("The shortcut key must be a single letter or digit.".into());
    }
    let mut mods = Modifiers::empty();
    for part in &parts[..parts.len() - 1] {
        mods |= modifier(part)?;
    }
    if mods.is_empty() {
        return Err("Add at least one modifier.".into());
    }
    Ok(Shortcut::new(Some(mods), code_for(ch)?))
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir.join("highlight-enhance.json"))
}

fn read_config(app: &AppHandle) -> HighlightConfig {
    let Ok(path) = config_path(app) else {
        return HighlightConfig { enabled: true, accelerator: default_accelerator().into() };
    };
    let Ok(text) = fs::read_to_string(path) else {
        return HighlightConfig { enabled: true, accelerator: default_accelerator().into() };
    };
    serde_json::from_str(&text).unwrap_or(HighlightConfig { enabled: true, accelerator: default_accelerator().into() })
}

fn write_config(app: &AppHandle, config: &HighlightConfig) -> Result<(), String> {
    let path = config_path(app)?;
    fs::write(path, serde_json::to_string(config).map_err(|error| error.to_string())?).map_err(|error| error.to_string())
}

fn bind(app: &AppHandle, config: &HighlightConfig) -> Result<(), String> {
    let shortcuts = app.global_shortcut();
    shortcuts.unregister_all().map_err(|error| error.to_string())?;
    if !config.enabled {
        return Ok(());
    }
    // Validate before registering so a bad accelerator never leaves the old one half-applied.
    let shortcut = parse_accelerator(&config.accelerator)?;
    shortcuts.on_shortcut(shortcut, |handle, _shortcut, event| {
        if event.state == ShortcutState::Pressed {
            on_shortcut(handle);
        }
    }).map_err(|error| error.to_string())
}

pub fn install(app: &AppHandle) -> Result<(), String> {
    let config = read_config(app);
    if let Some(state) = app.try_state::<HighlightState>() {
        if let Ok(mut slot) = state.config.lock() { *slot = config.clone(); }
    }
    bind(app, &config)
}

fn cursor_position() -> (f64, f64) {
    platform_cursor().unwrap_or((120.0, 120.0))
}

fn place(app: &AppHandle, x: f64, y: f64) -> (f64, f64) {
    let width = 420.0;
    let height = 480.0;
    let mut left = x + 12.0;
    let mut top = y + 12.0;
    let Ok(monitors) = app.available_monitors() else { return (left, top); };
    if let Some(monitor) = monitors.iter().find(|monitor| {
        let origin = monitor.position();
        let size = monitor.size();
        x >= origin.x as f64 && y >= origin.y as f64
            && x < origin.x as f64 + size.width as f64
            && y < origin.y as f64 + size.height as f64
    }) {
        let origin = monitor.position();
        let size = monitor.size();
        let max_left = origin.x as f64 + size.width as f64 - width - 8.0;
        let max_top = origin.y as f64 + size.height as f64 - height - 8.0;
        left = left.min(max_left).max(origin.x as f64 + 8.0);
        top = top.min(max_top).max(origin.y as f64 + 8.0);
    }
    (left, top)
}

fn show_window(app: &AppHandle, payload: Value) -> Result<(), String> {
    if let Ok(mut slot) = app.state::<HighlightState>().payload.lock() {
        *slot = Some(payload);
    }
    let (x, y) = cursor_position();
    let (left, top) = place(app, x, y);
    if let Some(window) = app.get_webview_window(WINDOW) {
        let _ = window.set_position(tauri::Position::Physical(PhysicalPosition::new(left as i32, top as i32)));
        window.show().map_err(|error| error.to_string())?;
        let _ = window.set_focus();
        let _ = window.emit("highlight-enhance", ());
        return Ok(());
    }
    let window = WebviewWindowBuilder::new(app, WINDOW, WebviewUrl::App("highlight.html".into()))
        .title("Prompt Lab")
        .inner_size(420.0, 480.0)
        .position(left, top)
        .always_on_top(true)
        .decorations(false)
        .resizable(true)
        .skip_taskbar(true)
        .visible(true)
        .build()
        .map_err(|error| error.to_string())?;
    let handle = app.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::Destroyed = event {
            if let Some(state) = handle.try_state::<HighlightState>() {
                if let Ok(mut busy) = state.busy.lock() { *busy = false; }
            }
        }
    });
    Ok(())
}

fn notify_main(app: &AppHandle, message: &str) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("promptlab:highlight-notice", message);
    }
}

fn reveal(app: &AppHandle, payload: Value) {
    if let Err(error) = show_window(app, payload) {
        notify_main(app, &error);
        if let Ok(mut busy) = app.state::<HighlightState>().busy.lock() { *busy = false; }
    }
}

fn on_shortcut(app: &AppHandle) {
    let busy = app.state::<HighlightState>().busy.lock().map(|mut slot| {
        if *slot { true } else { *slot = true; false }
    }).unwrap_or(true);
    if busy { return; }
    if !accessibility_trusted(true) {
        reveal(app, json!({ "kind": "permission", "message": permission_message() }));
        return;
    }
    let point = cursor_position();
    let _ = point;
    match capture_os() {
        Ok(text) => reveal(app, json!({ "kind": "selection", "text": text })),
        Err(message) => reveal(app, json!({ "kind": "notice", "message": message })),
    }
}

fn capture_os() -> Result<String, String> {
    let mut clip = OsClipboard::new()?;
    let text = capture_selection(&mut clip, |_clip| {
        if let Some(message) = secure_input_block(secure_event_input_enabled()) {
            return Err(message.into());
        }
        press_copy()?;
        thread::sleep(Duration::from_millis(80));
        Ok(())
    }, std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(1))?;
    if text.chars().count() > LIMIT {
        return Err(format!("That selection is longer than {LIMIT} characters. Select a smaller piece and try again."));
    }
    Ok(text)
}

fn accept_os(text: &str) -> Result<(), String> {
    let mut clip = OsClipboard::new()?;
    paste_and_restore(&mut clip, text, |_clip| {
        thread::sleep(Duration::from_millis(80));
        press_paste()?;
        thread::sleep(Duration::from_millis(120));
        Ok(())
    })
}

fn hide_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(WINDOW) {
        let _ = window.hide();
    }
}

#[tauri::command]
pub fn highlight_configure(app: AppHandle, state: State<HighlightState>, enabled: bool, accelerator: String) -> Result<(), String> {
    let shortcut_text = if enabled {
        parse_accelerator(&accelerator).map(|_| accelerator.clone())?
    } else if accelerator.trim().is_empty() {
        default_accelerator().to_string()
    } else {
        parse_accelerator(&accelerator)?;
        accelerator.clone()
    };
    let config = HighlightConfig { enabled, accelerator: shortcut_text };
    bind(&app, &config)?;
    write_config(&app, &config)?;
    if let Ok(mut slot) = state.config.lock() { *slot = config; }
    Ok(())
}

#[tauri::command]
pub fn highlight_take_payload(state: State<HighlightState>) -> Option<Value> {
    state.payload.lock().ok().and_then(|mut slot| slot.take())
}

#[tauri::command]
pub fn highlight_cancel(app: AppHandle, state: State<HighlightState>) {
    hide_window(&app);
    if let Ok(mut busy) = state.busy.lock() { *busy = false; }
    if let Ok(mut slot) = state.payload.lock() { *slot = None; }
}

#[tauri::command]
pub fn highlight_accept(app: AppHandle, state: State<HighlightState>, text: String) -> Result<(), String> {
    hide_window(&app);
    // Give the previous app a moment to take focus before the paste.
    thread::sleep(Duration::from_millis(80));
    let result = accept_os(&text);
    if let Ok(mut busy) = state.busy.lock() { *busy = false; }
    if let Err(message) = &result {
        reveal(&app, json!({ "kind": "notice", "message": message }));
    }
    result
}

#[cfg(target_os = "macos")]
fn secure_event_input_enabled() -> bool {
    #[link(name = "Carbon", kind = "framework")]
    extern "C" {
        fn IsSecureEventInputEnabled() -> u8;
    }
    unsafe { IsSecureEventInputEnabled() != 0 }
}

#[cfg(not(target_os = "macos"))]
fn secure_event_input_enabled() -> bool { false }

#[cfg(target_os = "macos")]
fn current_pasteboard_types() -> Vec<String> {
    use objc::runtime::{Class, Object};
    unsafe {
        let Some(class) = Class::get("NSPasteboard") else { return Vec::new(); };
        let board: *mut Object = objc::msg_send![class, generalPasteboard];
        if board.is_null() { return Vec::new(); }
        let types: *mut Object = objc::msg_send![board, types];
        if types.is_null() { return Vec::new(); }
        let count: usize = objc::msg_send![types, count];
        let mut names = Vec::with_capacity(count);
        for index in 0..count {
            let item: *mut Object = objc::msg_send![types, objectAtIndex: index];
            if item.is_null() { continue; }
            let bytes: *const i8 = objc::msg_send![item, UTF8String];
            if bytes.is_null() { continue; }
            if let Ok(text) = std::ffi::CStr::from_ptr(bytes).to_str() {
                names.push(text.to_string());
            }
        }
        names
    }
}

#[cfg(not(target_os = "macos"))]
fn current_pasteboard_types() -> Vec<String> { Vec::new() }

#[cfg(target_os = "macos")]
fn accessibility_trusted(prompt: bool) -> bool {
    unsafe {
        if !prompt {
            return AXIsProcessTrusted();
        }
        use core_foundation::base::TCFType;
        use core_foundation::boolean::CFBoolean;
        use core_foundation::dictionary::CFDictionary;
        use core_foundation::string::CFString;
        let key = CFString::new("AXTrustedCheckOptionPrompt");
        let dict = CFDictionary::from_CFType_pairs(&[(key.as_CFType(), CFBoolean::true_value().as_CFType())]);
        AXIsProcessTrustedWithOptions(dict.as_concrete_TypeRef() as *const _)
    }
}

#[cfg(not(target_os = "macos"))]
fn accessibility_trusted(_prompt: bool) -> bool { true }

#[cfg(target_os = "macos")]
#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXIsProcessTrusted() -> bool;
    fn AXIsProcessTrustedWithOptions(options: *const std::ffi::c_void) -> bool;
}

#[cfg(target_os = "macos")]
fn platform_cursor() -> Option<(f64, f64)> {
    #[repr(C)]
    struct CGPoint { x: f64, y: f64 }
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventCreate(source: *mut std::ffi::c_void) -> *mut std::ffi::c_void;
        fn CGEventGetLocation(event: *mut std::ffi::c_void) -> CGPoint;
        fn CFRelease(value: *const std::ffi::c_void);
    }
    unsafe {
        let event = CGEventCreate(std::ptr::null_mut());
        if event.is_null() { return None; }
        let point = CGEventGetLocation(event);
        CFRelease(event);
        Some((point.x, point.y))
    }
}

#[cfg(target_os = "macos")]
fn press_chord(key: u16) -> Result<(), String> {
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventSourceCreate(state: u32) -> *mut std::ffi::c_void;
        fn CGEventCreateKeyboardEvent(source: *mut std::ffi::c_void, key: u16, down: bool) -> *mut std::ffi::c_void;
        fn CGEventSetFlags(event: *mut std::ffi::c_void, flags: u64);
        fn CGEventPost(tap: u32, event: *mut std::ffi::c_void);
        fn CFRelease(value: *const std::ffi::c_void);
    }
    const COMMAND: u16 = 0x37;
    const FLAG_COMMAND: u64 = 0x0010_0000;
    unsafe {
        let source = CGEventSourceCreate(1);
        let mut events = [
            CGEventCreateKeyboardEvent(source, COMMAND, true),
            CGEventCreateKeyboardEvent(source, key, true),
            CGEventCreateKeyboardEvent(source, key, false),
            CGEventCreateKeyboardEvent(source, COMMAND, false),
        ];
        if events.iter().any(|event| event.is_null()) {
            for event in events { if !event.is_null() { CFRelease(event); } }
            if !source.is_null() { CFRelease(source); }
            return Err("Couldn't send the keystroke. Grant Accessibility permission and try again.".into());
        }
        for event in &events { CGEventSetFlags(*event, FLAG_COMMAND); }
        for event in &events { CGEventPost(0, *event); }
        for event in &mut events { CFRelease(*event); }
        if !source.is_null() { CFRelease(source); }
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn press_copy() -> Result<(), String> { press_chord(0x08) }
#[cfg(target_os = "macos")]
fn press_paste() -> Result<(), String> { press_chord(0x09) }

#[cfg(target_os = "windows")]
fn platform_cursor() -> Option<(f64, f64)> {
    use windows_sys::Win32::Foundation::POINT;
    use windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos;
    let mut point = POINT { x: 0, y: 0 };
    if unsafe { GetCursorPos(&mut point) } == 0 { return None; }
    Some((point.x as f64, point.y as f64))
}

#[cfg(target_os = "windows")]
fn press_chord(vk: u16) -> Result<(), String> {
    use std::mem::size_of;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VK_CONTROL};
    fn key(vk: u16, flags: u32) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: vk, wScan: 0, dwFlags: flags, time: 0, dwExtraInfo: 0 } },
        }
    }
    let inputs = [
        key(VK_CONTROL, 0),
        key(vk, 0),
        key(vk, KEYEVENTF_KEYUP),
        key(VK_CONTROL, KEYEVENTF_KEYUP),
    ];
    let sent = unsafe { SendInput(inputs.len() as u32, inputs.as_ptr(), size_of::<INPUT>() as i32) };
    if sent == inputs.len() as u32 { Ok(()) } else { Err("Couldn't send the keystroke.".into()) }
}

#[cfg(target_os = "windows")]
fn press_copy() -> Result<(), String> { press_chord(0x43) }
#[cfg(target_os = "windows")]
fn press_paste() -> Result<(), String> { press_chord(0x56) }

#[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
fn platform_cursor() -> Option<(f64, f64)> {
    let output = Command::new("xdotool").args(["getmouselocation", "--shell"]).output().ok()?;
    if !output.status.success() { return None; }
    let text = String::from_utf8(output.stdout).ok()?;
    let mut x = None;
    let mut y = None;
    for line in text.lines() {
        if let Some(value) = line.strip_prefix("X=") { x = value.parse().ok(); }
        if let Some(value) = line.strip_prefix("Y=") { y = value.parse().ok(); }
    }
    Some((x?, y?))
}

#[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
fn press_keys(chord: &str) -> Result<(), String> {
    let status = Command::new("xdotool").args(["key", "--clearmodifiers", chord]).status()
        .map_err(|_| "Couldn't copy the selection. On Linux, install xdotool and try again.".to_string())?;
    if status.success() { Ok(()) } else { Err("Couldn't copy the selection. xdotool failed.".into()) }
}

#[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
fn press_copy() -> Result<(), String> { press_keys("ctrl+c") }
#[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
fn press_paste() -> Result<(), String> { press_keys("ctrl+v") }

#[cfg(test)]
mod tests {
    use super::*;

    struct MemoryClipboard { value: String }

    impl ClipboardPort for MemoryClipboard {
        fn capture_hold(&mut self) -> Result<ClipHold, String> { Ok(ClipHold::Text(self.value.clone())) }
        fn apply_hold(&mut self, hold: &ClipHold) -> Result<(), String> {
            self.value = hold.text_content().unwrap_or("").to_string();
            Ok(())
        }
        fn write_text(&mut self, text: &str) -> Result<(), String> { self.value = text.to_string(); Ok(()) }
    }

    struct HoldClipboard { hold: ClipHold }

    impl ClipboardPort for HoldClipboard {
        fn capture_hold(&mut self) -> Result<ClipHold, String> { Ok(self.hold.clone()) }
        fn apply_hold(&mut self, hold: &ClipHold) -> Result<(), String> { self.hold = hold.clone(); Ok(()) }
        fn write_text(&mut self, text: &str) -> Result<(), String> { self.hold = ClipHold::Text(text.to_string()); Ok(()) }
    }

    #[test]
    fn capture_restores_the_clipboard_when_copy_does_not_land() {
        let mut clip = MemoryClipboard { value: "keep me".into() };
        let error = capture_selection(&mut clip, |_clip| Ok(()), 7).unwrap_err();
        assert!(error.contains("Couldn't copy"));
        assert_eq!(clip.value, "keep me");
        assert!(!error.contains("promptlab-7"));
    }

    #[test]
    fn capture_returns_the_selection_and_restores_the_original() {
        let mut clip = MemoryClipboard { value: "original".into() };
        let selected = capture_selection(&mut clip, |clip| {
            clip.value = "selected text".into();
            Ok(())
        }, 1).unwrap();
        assert_eq!(selected, "selected text");
        assert_eq!(clip.value, "original");
    }

    #[test]
    fn capture_rejects_an_empty_selection_and_restores() {
        let mut clip = MemoryClipboard { value: "original".into() };
        let error = capture_selection(&mut clip, |clip| {
            clip.value.clear();
            Ok(())
        }, 2).unwrap_err();
        assert!(error.contains("No text"));
        assert_eq!(clip.value, "original");
    }

    #[test]
    fn capture_restores_when_the_copy_keystroke_fails() {
        let mut clip = MemoryClipboard { value: "original".into() };
        let error = capture_selection(&mut clip, |_clip| Err("no accessibility".into()), 3).unwrap_err();
        assert_eq!(error, "no accessibility");
        assert_eq!(clip.value, "original");
    }

    #[test]
    fn accept_pastes_then_restores_the_clipboard() {
        let mut clip = MemoryClipboard { value: "original".into() };
        let mut pasted = String::new();
        paste_and_restore(&mut clip, "enhanced", |clip| {
            pasted = clip.value.clone();
            Ok(())
        }).unwrap();
        assert_eq!(pasted, "enhanced");
        assert_eq!(clip.value, "original");
    }

    #[test]
    fn accept_restores_the_clipboard_when_paste_fails() {
        let mut clip = MemoryClipboard { value: "original".into() };
        let error = paste_and_restore(&mut clip, "enhanced", |_clip| Err("paste failed".into())).unwrap_err();
        assert_eq!(error, "paste failed");
        assert_eq!(clip.value, "original");
    }

    #[test]
    fn capture_restores_html_when_the_clipboard_has_no_plain_text() {
        let mut clip = HoldClipboard { hold: ClipHold::Html("<b>picture</b>".into()) };
        let selected = capture_selection(&mut clip, |clip| {
            clip.write_text("selected text")?;
            Ok(())
        }, 9).unwrap();
        assert_eq!(selected, "selected text");
        assert!(matches!(clip.hold, ClipHold::Html(html) if html == "<b>picture</b>"));
    }

    #[test]
    fn accept_restores_a_file_list_after_the_paste() {
        let mut clip = HoldClipboard { hold: ClipHold::Files(vec![PathBuf::from("/tmp/notes.txt")]) };
        paste_and_restore(&mut clip, "enhanced", |clip| {
            assert!(matches!(&clip.hold, ClipHold::Text(text) if text == "enhanced"));
            Ok(())
        }).unwrap();
        assert!(matches!(clip.hold, ClipHold::Files(files) if files == vec![PathBuf::from("/tmp/notes.txt")]));
    }

    struct MarkedClipboard { hold: ClipHold, types: Vec<String> }

    impl ClipboardPort for MarkedClipboard {
        fn capture_hold(&mut self) -> Result<ClipHold, String> { Ok(self.hold.clone()) }
        fn apply_hold(&mut self, hold: &ClipHold) -> Result<(), String> { self.hold = hold.clone(); Ok(()) }
        fn write_text(&mut self, text: &str) -> Result<(), String> { self.hold = ClipHold::Text(text.to_string()); Ok(()) }
        fn pasteboard_types(&mut self) -> Vec<String> { self.types.clone() }
    }

    #[test]
    fn concealed_and_transient_pasteboard_types_are_rejected() {
        assert!(concealed_pasteboard_type(&["org.nspasteboard.ConcealedType"]));
        assert!(concealed_pasteboard_type(&["public.utf8-plain-text", "org.nspasteboard.TransientType"]));
        assert!(concealed_pasteboard_type(&["ORG.NSPASTEBOARD.CONCEALEDTYPE"]));
        assert!(!concealed_pasteboard_type(&["public.utf8-plain-text", "public.utf8-plain-text"]));
        assert_eq!(secure_input_block(true), Some(SECURE_FIELD_MESSAGE));
        assert_eq!(secure_input_block(false), None);
    }

    #[test]
    fn capture_rejects_a_concealed_pasteboard_and_restores_the_clipboard() {
        let mut clip = MarkedClipboard {
            hold: ClipHold::Text("keep me".into()),
            types: vec!["org.nspasteboard.ConcealedType".into()],
        };
        let error = capture_selection(&mut clip, |clip| {
            clip.write_text("looks ordinary")?;
            Ok(())
        }, 11).unwrap_err();
        assert_eq!(error, SECURE_FIELD_MESSAGE);
        assert!(matches!(clip.hold, ClipHold::Text(text) if text == "keep me"));
    }

    #[test]
    fn parser_accepts_the_platform_defaults() {
        parse_accelerator("alt+command+E").unwrap();
        parse_accelerator("Alt+Command+E").unwrap();
        parse_accelerator("ctrl+alt+E").unwrap();
        parse_accelerator("CommandOrControl+Alt+E").unwrap();
        assert!(parse_accelerator("E").is_err());
        assert!(parse_accelerator("alt+").is_err());
        assert!(parse_accelerator("logo+E").is_err());
    }
}
