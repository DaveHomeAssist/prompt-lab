# Tokens and secrets — what to set, where, and what breaks without it

## Status

- Status: `active`
- Updated: `2026-09-22`
- Verified against: `main` `122f34a`, GitHub repo and environment secret listings, Vercel project `prj_kynCeAMcASaNBIBMRHVJb7sozDfN`
- Companion doc: `docs/guardrails-guide.md`

This file records secret **names and locations only**. No values appear here, and
none should ever be added. Vercel returns `sensitive` variables with an empty
value by design, so the audit below confirms each name is **present**, not what
it contains.

## Scope

Every token PromptLab reads at build time, at runtime, or in CI. Four places
hold them:

| Where | Holds | Who sets it |
| --- | --- | --- |
| GitHub Actions — repo secrets | CI jobs that reach Notion | You |
| GitHub Actions — environment `Production – prompt-lab` | The production smoke | You |
| Vercel project env | The hosted web app and its API routes | You |
| End-user device | Provider API keys for extension, desktop and iOS | Each user, never you |

## Nothing is currently missing

Everything that is switched on has its token set. The production smoke passes
(run 35698760219) and the hosted app builds and serves, which is the practical
proof.

Two are absent and only matter if you turn Stripe checkout on. See
**Gaps that only bite when billing is enabled**.

## GitHub Actions

### Repo-level secrets

| Name | Used by | Required? | Without it |
| --- | --- | --- | --- |
| `NOTION_TOKEN` | `notion-docs-agent.yml` | For that workflow | The docs agent cannot write to Notion |
| `NOTION_PARENT_PAGE_ID` | `notion-docs-agent.yml` | For that workflow | The workflow fails its own `test -n` precondition |
| `GITHUB_TOKEN` | all workflows | Automatic | Nothing — GitHub injects it; never create one |

Status: both Notion secrets are set.

### Environment `Production – prompt-lab`

| Name | Used by | Required? | Without it |
| --- | --- | --- | --- |
| `CLERK_SECRET_KEY` | `Production Smoke` | Yes | Both production specs throw at `readProductionFreeSmokeConfig()` before opening a browser |
| `PROMPTLAB_QA_FREE_USER_ID` | `Production Smoke` | Yes | Same. Must match `^user_[A-Za-z0-9]+$` — the Clerk user ID of the dedicated Free QA account, not an email |

Status: both are set. These are why the production smoke cannot run on a laptop.

```bash
gh secret list
gh api repos/DaveHomeAssist/prompt-lab/environments --jq '.environments[].name'
gh api "repos/DaveHomeAssist/prompt-lab/environments/Production%20%E2%80%93%20prompt-lab/secrets" --jq '.secrets[].name'
```

To set or rotate one:

```bash
gh secret set CLERK_SECRET_KEY --env "Production – prompt-lab"
gh secret set NOTION_TOKEN
```

The environment name contains an en dash (`–`), not a hyphen. Quote it, and
URL-encode it as `%E2%80%93` when calling the API directly.

## Vercel project env

### Required for the hosted app

| Name | Purpose | Without it |
| --- | --- | --- |
| `VITE_CLERK_PUBLISHABLE_KEY` | Clerk sign-in in the browser bundle | `scripts/check-production-env.mjs` fails the build outright for preview and production. In local dev only, its absence makes the app mount unauthenticated |
| `CLERK_SECRET_KEY` | Server-side Clerk verification in API routes | `assertProductionConfig({ clerk: true })` throws |
| `ANTHROPIC_API_KEY` | The shared hosted key injected by `api/proxy.js` | Hosted enhance fails for anyone not supplying their own key |
| `KV_REST_API_URL` + `KV_REST_API_TOKEN` | Durable store for rate limits and billing state | `assertProductionConfig({ durableStore: true })` throws: durable storage is mandatory in production |

`UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` are an accepted
alternative to the `KV_*` pair. Only one pair is needed; the `KV_*` pair is set,
provisioned by the Vercel storage integration alongside `KV_URL`, `REDIS_URL`
and `KV_REST_API_READ_ONLY_TOKEN`.

### Set, and behaving as configuration rather than credentials

`HOSTED_PROXY_ENABLED`, `HOSTED_SHARED_KEY_ENABLED`, `HOSTED_DEMO_DAILY_LIMIT`,
`HOSTED_GLOBAL_DAILY_LIMIT`, `HOSTED_BURST_LIMIT`, `HOSTED_MAX_TOKENS`,
`HOSTED_MAX_INPUT_CHARS`, `PROMPTLAB_ANTHROPIC_TIMEOUT_MS`, `BILLING_ENABLED`,
`PROMPTLAB_TELEMETRY_ENABLED`, `PROMPTLAB_TELEMETRY_CONSOLE_FALLBACK`,
`VITE_HOSTED_PROXY_ENABLED`, `VITE_HOSTED_SHARED_KEY_ENABLED`.

These are throttles and feature flags, not credentials, but they live in the
same place and changing them changes production behaviour.

### Owner access

| Name | Purpose |
| --- | --- |
| `PROMPTLAB_PRO_OWNER_CLERK_USER_IDS` | Comma-separated Clerk user IDs granted Pro without Stripe |
| `PROMPTLAB_PRO_OWNER_EMAILS` | Same, by email |
| `PROMPTLAB_PRO_OWNER_USERNAMES` | Same, by username |
| `CLERK_AUTHORIZED_PARTIES` | Extra allowed `azp` claims beyond the two default origins |

`lookupOwnerEntitlement()` also accepts the aliases
`PROMPTLAB_OWNER_CLERK_USER_IDS`, `PROMPTLAB_PRO_OWNER_USER_IDS` and
`PROMPTLAB_OWNER_USER_IDS`. Only the Clerk **user ID** list is consulted for the
entitlement itself — the email and username lists do not by themselves grant it.

### Optional, with working defaults

| Name | Default if unset |
| --- | --- |
| `CLERK_JWT_ISSUER` | `https://clerk.promptlab.tools` |
| `CLERK_JWT_AUDIENCE` | No audience check |
| `PROMPTLAB_WEB_ORIGIN` / `VITE_PROMPTLAB_WEB_ORIGIN` | `https://promptlab.tools` |
| `STRIPE_CHECKOUT_SUCCESS_URL` | `https://promptlab.tools/app/?billing=success` |
| `STRIPE_CHECKOUT_CANCEL_URL` | `https://promptlab.tools/app/?billing=cancelled` |
| `STRIPE_PORTAL_RETURN_URL` | `https://promptlab.tools/app/` |

Leave these unset unless a domain changes.

Inspect what is currently set:

```bash
npx vercel env ls production
npx vercel env ls preview
```

## Gaps that only bite when billing is enabled

Billing is currently in prelaunch — the UI reads "All Features Open" and
purchases are disabled — so neither of these is live today. Both must be set
before Stripe checkout is switched on.

| Name | Status | Consequence when billing is enabled |
| --- | --- | --- |
| `STRIPE_WEBHOOK_SECRET` | **not set** | `assertProductionConfig({ webhook: true })` throws, so any route verifying Stripe webhooks refuses to start |
| Yearly price ID | **not set** | Annual checkout throws `No Stripe price is configured for "yearly"` |

The yearly gap is easy to miss. `api/_lib/stripeBilling.js` resolves the two
periods asymmetrically:

```js
monthlyPriceId: readStringEnv('STRIPE_MONTHLY_PRICE_ID', 'STRIPE_PRICE_ID_MONTHLY', 'STRIPE_PRICE_ID'),
yearlyPriceId:  readStringEnv('STRIPE_YEARLY_PRICE_ID',  'STRIPE_PRICE_ID_YEARLY',  'STRIPE_ANNUAL_PRICE_ID'),
```

Monthly falls back to `STRIPE_PRICE_ID`, which is set. Yearly has no such
fallback, and none of its three accepted names is set — so monthly checkout
would work and annual would fail. Set one of `STRIPE_YEARLY_PRICE_ID`,
`STRIPE_PRICE_ID_YEARLY` or `STRIPE_ANNUAL_PRICE_ID` before enabling purchases.

`STRIPE_SECRET_KEY` and `STRIPE_PRICE_ID` are already set.

## Optional tooling tokens

| Name | Needed when |
| --- | --- |
| `OPENAI_API_KEY` | Only if `DOCS_AGENT_PROVIDER=openai`. The Notion docs agent throws without it in that mode; the default provider does not need it |
| `DOCS_AGENT_MODEL`, `DOCS_AGENT_PROVIDER`, `DOCS_AGENT_MAX_DOCS`, `DOCS_AGENT_MAX_CHARS_PER_DOC` | Tuning the docs agent. `NOTION_DOCS_PAGE_TITLE` and the two limits are repo **variables**, not secrets |

## Tokens you never set

Provider API keys for the extension, desktop app and iOS app are supplied by
each user and never leave their device:

- extension — `chrome.storage.local`, entered on the options page
- desktop — `localStorage` under `pl2-provider-settings`
- iOS — Keychain

Do not add an Anthropic, OpenAI, Gemini, OpenRouter or Ollama key to CI or
Vercel for these surfaces. `ANTHROPIC_API_KEY` in Vercel exists solely for the
hosted proxy's shared-key path, which serves the hosted web app and the React
mobile prototype.

## Rotation

1. Rotate at the provider first (Clerk, Anthropic, Stripe, Notion).
2. Update Vercel, then redeploy — env changes do not apply to existing
   deployments.
3. Update the matching GitHub secret if the same credential is used in CI.
   `CLERK_SECRET_KEY` lives in **both** Vercel and the
   `Production – prompt-lab` environment; rotating one and not the other leaves
   the production smoke failing while the app itself is fine.
4. Confirm with a real run rather than assuming:

```bash
gh workflow run "Production Smoke" --ref main
```

## Verification

| Check | Result |
| --- | --- |
| GitHub repo secrets | `NOTION_TOKEN`, `NOTION_PARENT_PAGE_ID` present |
| GitHub environment `Production – prompt-lab` | `CLERK_SECRET_KEY`, `PROMPTLAB_QA_FREE_USER_ID` present |
| Vercel production env | All required names present; `STRIPE_WEBHOOK_SECRET` and every yearly-price name absent |
| Production smoke, run 35698760219 | 2 passed — proves the CI credentials resolve and work end to end |
