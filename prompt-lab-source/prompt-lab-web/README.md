# Prompt Lab — Hosted Web

Prompt Lab's public web deployment lives at `https://promptlab.tools` and is built from `prompt-lab-web/`.

The public site has three primary routes:

- `/` — landing page and product marketing surface
- `/tools` — public tools hub linking the hosted app and auxiliary utilities
- `https://promptlab.tools/app/` — current public hosted Prompt Lab application

The `/app/` shell reuses the same frontend source as the extension and desktop app.

## How it works

Provider API requests from the hosted app route through a Vercel Edge Function at `/api/proxy` to bypass CORS. The hosted surface currently supports Anthropic only: it can use the shared hosted key when configured, or a user-supplied Anthropic key. Extension and desktop remain the full multi-provider surfaces, including local Ollama access.

The app can also submit structured bug reports through `/api/bug-report`. That route expects `NOTION_TOKEN` and `NOTION_BUG_REPORT_PARENT_PAGE_ID` in the Vercel project environment. `VITE_BUG_REPORT_ENDPOINT` is optional when you want the UI to post somewhere other than the default hosted endpoint during local development.

## Dev setup

Use Node `20.19.x` LTS or `22.12+` before running the hosted web build.

```bash
npm install
npm run dev
```

Local routes:

- `http://localhost:5174/` — landing page
- `http://localhost:5174/app/` — hosted app shell

For local proxy testing, install the Vercel CLI and use `vercel dev` instead of `npm run dev`.

## Build

```bash
npm run build
```

The Vite build is configured as a multi-page app:

- `dist/index.html` for the landing page
- `dist/app/index.html` for the shared app shell

## Deploy

```bash
cd ..
npm run deploy:preview
```

For production:

```bash
cd ..
npm run deploy:prod
```

The deploy helper temporarily mirrors the linked `.vercel/project.json` from `prompt-lab-source/` to the repo root so Vercel uses the existing `prompt-lab` project with the correct root directory.

## Key files

- `../api/proxy.js` — CORS proxy edge function
- `../vercel.json` — root Vercel build config and `/app` rewrites
- `index.html` — landing page entry served at `/`
- `app/index.html` — app entry served at `/app/`
- `public/` — static assets and auxiliary public docs published at the site root
- `../scripts/publish-landing.mjs` — syncs the canonical landing from `prompt-lab-web/` into `../docs/`
- `../scripts/vercel-deploy.mjs` — safe preview/production deploy wrapper for the linked Vercel project
- `vite.config.js` — sets `VITE_WEB_MODE=true` and builds both HTML entry points
