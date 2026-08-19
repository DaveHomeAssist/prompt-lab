# Prompt Lab

> A multi-surface prompt engineering workbench spanning browser, web, desktop, and native iPhone/iPad experiences.

The extension, hosted `/app/` workbench, and Tauri desktop app reuse the same React frontend. A separate React mobile prototype is public at `/mobile/`, while the focused native SwiftUI app shares versioned JSON contracts rather than UI code. Provider and feature coverage varies by surface; the extension and desktop retain the full Anthropic, OpenAI, Gemini, OpenRouter, and Ollama workflow.

## Features

- Prompt enhancement via any supported LLM provider
- Prompt quality scoring (role, task, format, constraints, context)
- Rule-based prompt linting with quick-fix suggestions
- PII scanning and redaction before send
- Prompt library with tags, search, collections, and drag-and-drop reorder
- A/B prompt testing with side-by-side comparison
- Drag-and-drop prompt composer
- Experiment history with IndexedDB persistence
- Variable templates with fill-before-send
- Dark/light theme with system preference detection
- Command palette with keyboard shortcuts
- Share via URL and JSON export/import

## Quick Start

```bash
# Extension
cd prompt-lab-source/prompt-lab-extension
npm install && npm run dev

# Hosted web app and React mobile prototype
cd prompt-lab-source/prompt-lab-web
npm install && npm run dev

# Desktop
cd prompt-lab-source/prompt-lab-desktop
npm install && cargo tauri dev

# Native iPhone/iPad app (choose an installed simulator)
xcodebuild build \
  -project prompt-lab-ios/PromptLab.xcodeproj \
  -scheme PromptLab \
  -destination 'platform=iOS Simulator,name=iPhone 16'
```

## Structure

```text
prompt-lab-source/
  prompt-lab-extension/   # Shared frontend + Chrome extension build
    src/                  # React source (shared between extension and desktop/web)
    dist/                 # Built extension (loadable in Chrome)
    tests/                # Vitest + Playwright test suites
  prompt-lab-desktop/     # Tauri 2 desktop app
    src-tauri/            # Rust backend + config
    index.html            # Entry point (imports shared src/)
  prompt-lab-web/         # Hosted web app + landing authoring source
    mobile/               # Separate React mobile prototype at /mobile/
  api/                    # Vercel edge proxy for hosted web mode
  docs/                   # Internal technical docs, audits, and system notes
prompt-lab-ios/            # Native SwiftUI iPhone/iPad app (iOS 17+)
contracts/                 # Versioned cross-surface JSON contracts
docs/                     # Published public docs/static site copy
.github/workflows/        # CI: web, extension, desktop, native, docs, and API gates
```

## Deployment

| Surface | URL | Host |
|---------|-----|------|
| Public landing page | `https://promptlab.tools/` | Vercel production deployment |
| Hosted web app | `https://promptlab.tools/app/` | Vercel static app + Edge proxy |
| React mobile prototype | `https://promptlab.tools/mobile/` | Vercel static app + Edge proxy |
| Chrome / Vivaldi extension | MV3 side panel, local/unpacked build; store submission materials in draft | Local build / Chrome Web Store review prep |
| macOS desktop | Tauri 2 — `.app` / `.dmg` | Local build |
| Windows desktop | Tauri 2 — `.exe` / `.msi` | Local build |
| Linux desktop | Tauri 2 — `.deb` / `.AppImage` | Local build |
| Native iPhone/iPad | SwiftUI focused v1; distribution inputs are still blocked | Xcode / native CI (no TestFlight or App Store release yet) |

The GitHub Pages workflow still builds the generated `docs/` mirror, but production DNS for `promptlab.tools` resolves to Vercel.

## Tech

- React (frontend, shared across extension/desktop/web)
- Vite (dev server and bundler)
- Tauri 2 (desktop — Rust backend)
- Vitest + Playwright (testing)
- Vercel edge proxy (hosted web API)
- IndexedDB (persistence)
- SwiftUI + SwiftData + Keychain (native iPhone/iPad app)
- Versioned JSON contracts (React/native compatibility boundary)

## Documentation

- `prompt-lab-source/ARCHITECTURE.md` — canonical system architecture
- `prompt-lab-source/DOCS_INVENTORY.md` — documentation map and source-of-truth rules
- `prompt-lab-source/docs/docs-map.md` — task and audience routing guide
- `prompt-lab-source/docs/docs-style-guide.md` — authoring rules
- `prompt-lab-source/docs/glossary.md` — standard terminology
- `prompt-lab-ios/README.md` — native app scope and verification
- `prompt-lab-source/prompt-lab-extension/VERSION_REPORT.md` — package, tag, and release state

## Links

- Landing: <https://promptlab.tools/>
- Web app: <https://promptlab.tools/app/>
- Current shared package/source version: `1.7.1` (unreleased)
- Latest source tag: `v1.7.0`
- Latest GitHub Release: `v1.5.0-desktop-preview` (prerelease)

## Conventions

This project follows the shared naming conventions in `30-shared-resources/shared-standards/NAMING_CONVENTIONS.md`.

## License

All rights reserved. The repository is public so the code can be inspected
(source-available), but no license is granted to copy, modify, or
redistribute it. See `LICENSE`.
