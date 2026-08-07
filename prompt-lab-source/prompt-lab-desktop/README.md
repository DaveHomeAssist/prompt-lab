# Prompt Lab Desktop

Prompt Lab Desktop is a Tauri 2 shell around the shared Prompt Lab React frontend. It reuses `../prompt-lab-extension/src/` so the desktop app stays aligned with:

- the hosted web app at `https://promptlab.tools/app/`
- the MV3 browser extension in `prompt-lab-extension/`

## Prerequisites

- Node.js 20.x (see `.nvmrc`)
- Rust toolchain with `cargo`
- Tauri platform dependencies for your OS
  - macOS: Xcode command line tools
  - Linux: WebKitGTK/AppIndicator/RSVG packages
  - Windows: WebView2 + MSVC build tools

## Development

```powershell
cd prompt-lab-source/prompt-lab-desktop
npm ci
npm run tauri:dev
```

## Verify and package

Run from `prompt-lab-source/`:

```powershell
npm ci
npm ci --prefix prompt-lab-extension
npm ci --prefix prompt-lab-desktop
npm run verify:desktop
npm run package:desktop
npm run test:ollama
```

`verify:desktop` runs the shared test suite, desktop adapter smoke tests, both
frontend builds, and Cargo checks. `package:desktop` repeats that gate before
creating native bundles.

`test:ollama` discovers locally installed models and runs the real Balanced
enhancement contract through the desktop provider adapter. Use
`OLLAMA_MODEL`, `OLLAMA_BASE_URL`, and `OLLAMA_CONTEXT_LENGTH` to override its
selection. Ollama settings also expose Context Length in the UI; reduce it
when a local model reports an out-of-memory error.

Windows bundles are written under:

- `src-tauri/target/release/bundle/msi/`
- `src-tauri/target/release/bundle/nsis/`

## Release smoke matrix

| Check | Required result |
|---|---|
| Development launch | Tauri window opens at the default size. |
| Minimum window | Controls remain reachable at `360x600`. |
| Provider settings | Selected provider and model rehydrate after restart. |
| Storage status | Settings reports writable or failed local storage. |
| Remote provider | Approved test key completes a connection check. |
| Ollama | `npm run test:ollama`, model refresh, and the settings connection check succeed. |
| Packaged launch | Release executable completes an enhancement and library save from isolated app data. |
| Restart persistence | Provider settings and the saved library record rehydrate after restart. |
| Installers | Expected platform bundles exist and install on a clean profile. |

## More Docs

- `../ARCHITECTURE.md` — shared platform and runtime layout
- `../ROADMAP.md` — current product and release priorities
- `../prompt-lab-web/README.md` — hosted web deployment notes
