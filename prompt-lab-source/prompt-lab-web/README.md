# Prompt Lab - Hosted Web

Prompt Lab's public web deployment lives at `https://promptlab.tools` and is built from `prompt-lab-web/`.

The public site has four primary routes:

- `/` - landing page and product marketing surface
- `/tools` - public tools hub linking the hosted app and auxiliary utilities
- `https://promptlab.tools/app/` - current public hosted Prompt Lab application
- `/mobile/` - React PromptLab Mobile shell
- `/mobile/canvas.html` - original design handoff canvas
- `/mobile/prototype.html` - static functional prototype backup

The `/app/` shell reuses the same frontend source as the extension and desktop app.

## How it works

Provider API requests from the hosted app route through a Vercel Edge Function at `/api/proxy` to bypass CORS. The hosted surface currently supports Anthropic only: it can use the shared hosted key when configured, or a user-supplied Anthropic key. Extension and desktop remain the full multi-provider surfaces, including local Ollama access.

## Dev setup

```bash
npm install
npm run dev
```

Local routes:

- `http://localhost:5174/` - landing page
- `http://localhost:5174/app/` - hosted app shell
- `http://localhost:5174/mobile/` - React mobile shell
- `http://localhost:5174/mobile/canvas.html` - original mobile design canvas
- `http://localhost:5174/mobile/prototype.html` - static functional prototype backup

For local proxy testing, install the Vercel CLI and use `vercel dev` instead of `npm run dev`.

## Build

```bash
npm run build
```

The Vite build is configured as a multi-page app:

- `dist/index.html` for the landing page
- `dist/app/index.html` for the shared app shell
- `dist/mobile/index.html` built from `mobile/index.html` for the React mobile shell
- `dist/mobile/canvas.html` copied from `public/mobile/` for the original design canvas

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

- `../api/proxy.js` - CORS proxy edge function
- `../vercel.json` - root Vercel build config and `/app` rewrites
- `index.html` - landing page entry served at `/`
- `app/index.html` - app entry served at `/app/`
- `mobile/index.html` - mobile React entry served at `/mobile/`
- `public/` - static assets and auxiliary public docs published at the site root
- `public/mobile/` - PromptLab Mobile static backup and design handoff files
- `../scripts/publish-landing.mjs` - syncs the canonical landing from `prompt-lab-web/` into `../docs/`
- `../scripts/vercel-deploy.mjs` - safe preview/production deploy wrapper for the linked Vercel project
- `vite.config.js` - sets `VITE_WEB_MODE=true` and builds both HTML entry points
