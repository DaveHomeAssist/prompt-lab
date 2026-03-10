# Prompt Lab — Browser Extension

AI prompt enhancer, library, and notepad. Vivaldi/Chrome extension (Manifest V3).

## Install

1. Go to `vivaldi://extensions` (or `chrome://extensions`)
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** → select this folder
4. Click the extension icon → **Options** → paste your Anthropic API key → Save

## Add as Vivaldi Web Panel

1. Copy your extension ID from the extensions page
2. Right-click the sidebar → **Add Web Panel**
3. Paste: `chrome-extension://<your-extension-id>/panel.html`

## What Changed from the Artifact Version

| Concern | Artifact (claude.ai) | Extension (this) |
|---|---|---|
| JSX compilation | Babel standalone (`unsafe-eval`) | Vite pre-compiled (CSP clean) |
| Storage | `window.storage` (sandbox API) | `localStorage` |
| API calls | Direct `fetch()` w/ injected key | `chrome.runtime.sendMessage` → `background.js` |
| Icons | `lucide-react` npm import | Inline SVG `Ic` component |
| CSP | Requires `unsafe-eval` | `script-src 'self'` only |

## Features

- **Editor** — write/paste prompts, enhance via 7 modes, inline diff, live quality score
- **Composer** — drag-and-drop library entries to build composite prompts
- **A/B Test** — side-by-side prompt comparison with winner tracking
- **Pad** — persistent freeform notepad with date stamps and auto-save
- Prompt library with folders, tags, version history, templates, search
- Shareable links (base64 URL params)
- Keyboard shortcuts (⌘↵ enhance, ⌘S save, ⌘K command palette)
- Dark/light mode toggle
- Import/export library as JSON

## Files

```
panel.html          ← Main app (load this as Web Panel)
assets/             ← Compiled JS + CSS (Vite output)
background.js       ← API key proxy (service worker)
options.html/.js    ← API key settings page
manifest.json       ← MV3 manifest (no unsafe-eval)
icons/              ← 16, 48, 128px PNGs
```

## Development

To modify and rebuild:

```bash
cd prompt-lab-extension
npm install
npm run build
# Copy dist/* into this folder, rename index.html → panel.html
```

## Model

Uses `claude-sonnet-4-20250514` via the Anthropic Messages API.
- Enhance: `max_tokens: 1500`
- A/B Test: `max_tokens: 800`
