# Prompt Lab Desktop

Prompt Lab Desktop is a Tauri 2 shell around the shared Prompt Lab React frontend. It reuses `../prompt-lab-extension/src/` so the desktop app stays aligned with:

- the hosted web app at `https://promptlab.tools/app/`
- the MV3 browser extension in `prompt-lab-extension/`

## Prerequisites

- Node.js 22+
- Rust toolchain with `cargo`
- Tauri platform dependencies for your OS
  - macOS: Xcode command line tools
  - Linux: WebKitGTK/AppIndicator/RSVG packages
  - Windows: WebView2 + MSVC build tools

## Development

```bash
cd prompt-lab-source/prompt-lab-desktop
npm install
cargo tauri dev
```

## Build

```bash
cd prompt-lab-source/prompt-lab-desktop
npm install
cargo tauri build
```

## Desktop Controls

- Zoom with `Command +` / `Command -` on macOS or `Ctrl +` / `Ctrl -` on Windows and Linux. Reset with `Command 0` or `Ctrl 0`.
- Provider Settings can target Ollama on This Mac, Duncan, Walter, or a custom URL. Selecting a known server refreshes its installed model list.
- Packaged network access is allowlisted to the known Ollama hosts. A custom server must also be added to the desktop content security policy before it can be used in a packaged build.

## More Docs

- `../ARCHITECTURE.md` — shared platform and runtime layout
- `../ROADMAP.md` — current product and release priorities
- `../prompt-lab-web/README.md` — hosted web deployment notes
