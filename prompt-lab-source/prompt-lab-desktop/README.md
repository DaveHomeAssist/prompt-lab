# Prompt Lab Desktop

Prompt Lab Desktop is a Tauri 2 shell around the shared Prompt Lab React frontend. It reuses `../prompt-lab-extension/src/` so the extension and desktop app stay on one UI codebase.

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

## More Docs

See the [root README](../../README.md) for project structure, platform status, and shared development workflow.
