# Prompt Lab

A prompt engineering workbench that runs as a Chrome extension and a standalone desktop app.

Write, enhance, lint, A/B test, and manage prompts across 5 LLM providers: Anthropic, OpenAI, Google Gemini, OpenRouter, and Ollama (local).

## Platforms

| Platform | Status |
|----------|--------|
| Chrome / Vivaldi extension | Production — MV3 side panel |
| macOS desktop | Tauri 2 — `.app` / `.dmg` |
| Windows desktop | Tauri 2 — `.exe` / `.msi` |
| Linux desktop | Tauri 2 — `.deb` / `.AppImage` |

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

## Project structure

```
prompt-lab-source/
  prompt-lab-extension/   # Shared frontend + Chrome extension build
    src/                  # React source (shared between extension and desktop)
    dist/                 # Built extension (loadable in Chrome)
    tests/                # Vitest + Playwright test suites
  prompt-lab-desktop/     # Tauri 2 desktop app
    src-tauri/            # Rust backend + config
    index.html            # Entry point (imports shared src/)
docs/                     # GitHub Pages landing site
.github/workflows/        # CI: extension tests + cross-platform desktop builds
```

## Development

```bash
# Extension
cd prompt-lab-source/prompt-lab-extension
npm install
npm run dev       # Vite dev server
npm test          # 52 tests across 9 suites
npm run build     # Build to dist/

# Desktop
cd prompt-lab-source/prompt-lab-desktop
npm install
cargo tauri dev   # Launch desktop app in dev mode
cargo tauri build # Build .app/.dmg/.exe/.msi/.deb/.AppImage
```

## License

All rights reserved.
