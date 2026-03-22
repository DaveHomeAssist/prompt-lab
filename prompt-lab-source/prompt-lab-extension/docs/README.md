# Prompt Lab Extension Docs

This package keeps active code in `src/` and extension packaging assets in `public/`.

## Docs Layout

- `audits/` — focused audits and postmortems
- `inventory/` — package maps and ownership notes
- `ops/` — build, cleanup, and operating plans
- `releases/` — release notes and patch reports
- `store/` — Chrome Web Store submission material

## Current Build Layout

- `public/` is the source of truth for `manifest.json`, `background.js`, `options.html`, `options.js`, icons, and fonts.
- `src/lib/` is the source of truth for shared runtime modules used by the extension worker and options page.
- `scripts/assemble.js` copies the required runtime modules into `dist/lib/` after `vite build`.

Historical docs may still mention the removed `extension/` directory when they describe older release work.
