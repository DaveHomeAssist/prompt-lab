# Prompt Lab — Hosted Web

Prompt Lab's public web deployment lives at `https://promptlab.tools` and is built from `prompt-lab-web/`.

The public site has three primary routes:

- `/` — landing page and product marketing surface
- `/tools` — public tools hub linking the hosted app and auxiliary utilities
- `https://promptlab.tools/app/` — current public hosted Prompt Lab application

The `/app/` shell reuses the same frontend source as the extension and desktop app.

## How it works

Provider API requests from the hosted app route through a Vercel Edge Function at `/api/proxy` to bypass CORS. The hosted surface currently supports Anthropic only: it can use the shared hosted key when configured, or a user-supplied Anthropic key. Extension and desktop remain the full multi-provider surfaces, including local Ollama access.

When `VITE_CLERK_PUBLISHABLE_KEY` is present, the hosted app wraps the shared frontend in Clerk authentication. The shared billing flow then attaches Clerk identity to checkout, portal, and license validation requests, and the hosted billing routes verify the Clerk bearer token server side before trusting account-bound billing actions. Stripe continues to handle payment processing underneath.

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

Hosted auth and billing related envs:

- `VITE_CLERK_PUBLISHABLE_KEY` enables Clerk sign in on the hosted web shell. Use the production instance `pk_live_...` key in Vercel production.
- `CLERK_SECRET_KEY` enables server side Clerk token verification for hosted billing routes. Use the matching production `sk_live_...` key in Vercel production.
- `CLERK_JWT_KEY` is optional when you want networkless Clerk token verification
- `CLERK_AUTHORIZED_PARTIES` is an explicit comma separated origin allowlist for hosted billing bearer tokens. In production set this to `https://promptlab.tools`. Add localhost origins explicitly for local `vercel dev` if needed.
- `STRIPE_SECRET_KEY` enables Stripe checkout, portal, and subscription lookup
- `STRIPE_MONTHLY_PRICE_ID` or `STRIPE_PRICE_ID` sets the monthly Prompt Lab Pro Stripe price
- `STRIPE_YEARLY_PRICE_ID` sets the annual Prompt Lab Pro Stripe price
- `STRIPE_WEBHOOK_SECRET` validates the Stripe webhook endpoint at `/api/billing/webhook`
- `NOTION_TOKEN` enables the hosted bug report endpoint
- `NOTION_BUG_REPORT_PARENT_PAGE_ID` sets the Notion destination for hosted bug reports

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

For Clerk production cutover, also enable Clerk's Allowed Subdomains setting for `promptlab.tools` unless you intentionally need wildcard subdomain auth, then deploy certificates after DNS is green.

## Key files

- `../api/proxy.js` — CORS proxy edge function
- `../vercel.json` — root Vercel build config and `/app` rewrites
- `index.html` — landing page entry served at `/`
- `app/index.html` — app entry served at `/app/`
- `public/` — static assets and auxiliary public docs published at the site root
- `../scripts/publish-landing.mjs` — syncs the canonical landing from `prompt-lab-web/` into `../docs/`
- `../scripts/vercel-deploy.mjs` — safe preview/production deploy wrapper for the linked Vercel project
- `vite.config.js` — sets `VITE_WEB_MODE=true` and builds both HTML entry points
