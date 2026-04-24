# Prompt Lab

> A multi-surface prompt engineering workbench that runs as a Chrome extension, hosted web app, and standalone desktop app.

Write, enhance, lint, A/B test, and manage prompts across Anthropic, OpenAI, Google Gemini, OpenRouter, and Ollama. The hosted web app currently defaults to Anthropic, while the extension and desktop shells retain the full multi-provider workflow.

## Features

- Prompt enhancement via any supported LLM provider
- Local provider key storage on extension and desktop
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

Hosted web mode can add Clerk sign in and Clerk backed billing state when `VITE_CLERK_PUBLISHABLE_KEY` is configured. Payment processing still runs through Stripe underneath that hosted path.

## Quick Start

```bash
# Extension
cd prompt-lab-source/prompt-lab-extension
npm install && npm run dev

# Hosted web app
cd prompt-lab-source/prompt-lab-web
npm install && npm run dev

# Desktop
cd prompt-lab-source/prompt-lab-desktop
npm install && cargo tauri dev
```

## Structure

```
prompt-lab-source/
  prompt-lab-extension/   # Shared frontend + Chrome extension build
    src/                  # React source (shared between extension and desktop/web)
    dist/                 # Built extension (loadable in Chrome)
    tests/                # Vitest + Playwright test suites
  prompt-lab-desktop/     # Tauri 2 desktop app
    src-tauri/            # Rust backend + config
    index.html            # Entry point (imports shared src/)
  prompt-lab-web/         # Hosted web app + landing authoring source
  api/                    # Vercel edge proxy for hosted web mode
  docs/                   # Internal technical docs, audits, and system notes
docs/                     # Published public docs/static site copy
.github/workflows/        # CI: extension tests + cross-platform desktop builds
```

## Deployment

| Surface | URL | Host |
|---------|-----|------|
| Public landing page | `https://promptlab.tools/` | Vercel |
| Hosted web app | `https://promptlab.tools/app/` | Vercel |
| Chrome / Vivaldi extension | Production — MV3 side panel | Chrome Web Store |
| macOS desktop | Tauri 2 — `.app` / `.dmg` | Local build |
| Windows desktop | Tauri 2 — `.exe` / `.msi` | Local build |
| Linux desktop | Tauri 2 — `.deb` / `.AppImage` | Local build |

## Tech

- React (frontend, shared across extension/desktop/web)
- Vite (dev server and bundler)
- Tauri 2 (desktop — Rust backend)
- Vitest + Playwright (testing)
- Vercel edge proxy (hosted web API)
- IndexedDB (persistence)

## Documentation

- `prompt-lab-source/ARCHITECTURE.md` — canonical system architecture
- `prompt-lab-source/DOCS_INVENTORY.md` — documentation map and source-of-truth rules
- `prompt-lab-source/docs/docs-map.md` — task and audience routing guide
- `prompt-lab-source/docs/docs-style-guide.md` — authoring rules
- `prompt-lab-source/docs/glossary.md` — standard terminology

## Links

- Landing: https://promptlab.tools/
- Web app: https://promptlab.tools/app/

## Support Intake

Hosted bug reports submit to `/api/bug-report` when both `NOTION_TOKEN` and
`NOTION_BUG_REPORT_PARENT_PAGE_ID` are configured and the connected Notion
integration can access the parent page.

If the hosted bug report flow is unavailable, capture the report directly in
Notion at `https://www.notion.so/Prompt-Lab-Bug-Reports-Inbox-342255fc8f4481cba3cded3ee263e4a7` and include:

- title
- steps to reproduce
- expected result
- actual result
- page URL
- provider and surface
- contact details if follow up is needed

## Conventions

This project follows the shared naming conventions in `30-shared-resources/shared-standards/NAMING_CONVENTIONS.md`.

## License

All rights reserved.
