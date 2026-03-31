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

## More Docs

- `../ARCHITECTURE.md` — shared platform and runtime layout
- `../ROADMAP.md` — current product and release priorities
- `../prompt-lab-web/README.md` — hosted web deployment notes
