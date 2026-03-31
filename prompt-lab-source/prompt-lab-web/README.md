# Prompt Lab — Hosted Web

Prompt Lab's public web deployment lives at `https://promptlab.tools` and is built from `prompt-lab-web/`.

The public site has two routes:

- `/` — landing page and product marketing surface
- `https://promptlab.tools/app/` — current public hosted Prompt Lab application

The `/app/` shell reuses the same frontend source as the extension and desktop app.

## How it works

Provider API requests from the hosted app route through a Vercel Edge Function at `/api/proxy` to bypass CORS. The hosted surface currently supports Anthropic only: it can use the shared hosted key when configured, or a user-supplied Anthropic key. Extension and desktop remain the full multi-provider surfaces, including local Ollama access.

## Dev setup

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
vercel
```

Vercel builds `prompt-lab-web/`, serves `prompt-lab-web/dist`, and deploys the root edge function at `/api/proxy`.

## Key files

- `../api/proxy.js` — CORS proxy edge function
- `../vercel.json` — root Vercel build config and `/app` rewrites
- `index.html` — landing page entry served at `/`
- `app/index.html` — app entry served at `/app/`
- `public/` — static assets and auxiliary public docs published at the site root
- `vite.config.js` — sets `VITE_WEB_MODE=true` and builds both HTML entry points
