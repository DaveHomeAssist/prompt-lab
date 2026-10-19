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
| `PROMPTLAB_PRO_OWNER_EMAILS` | Legacy configuration; does not grant owner access |
| `PROMPTLAB_PRO_OWNER_USERNAMES` | Legacy configuration; does not grant owner access |
| `CLERK_AUTHORIZED_PARTIES` | Extra allowed `azp` claims beyond the two default origins |

`lookupOwnerEntitlement()` also accepts the aliases
`PROMPTLAB_OWNER_CLERK_USER_IDS`, `PROMPTLAB_PRO_OWNER_USER_IDS` and
`PROMPTLAB_OWNER_USER_IDS`. Only the Clerk **user ID** list is consulted for the
entitlement itself — the email and username lists do not by themselves grant it.

Use the manual Production Smoke `scope=owner` to verify the repository owner's
actual production entitlement and accessible feature controls. The check resolves
the public repository-owner email to one verified Clerk account, creates a
disposable session, and checks Owner Pro after reload. It preserves pre-existing
owner sessions and blocks purchases, providers and telemetry. Only synthetic
workspace data in the disposable browser profile is used. Owner access is never
part of the scheduled smoke.

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

## Billing restoration prerequisites

The October 12, 2026 restoration uses the existing Stripe product and active
USD prices: $9 monthly and $99 annually. This corrects the old $100 annual UI
copy without changing a Stripe price. The legacy `STRIPE_PRICE_ID` was invalid;
production now explicitly sets `STRIPE_MONTHLY_PRICE_ID` and
`STRIPE_YEARLY_PRICE_ID`.

Before enabling `BILLING_ENABLED`, production must have the Clerk and Stripe
keys, `STRIPE_WEBHOOK_SECRET`, and the REST storage URL/token pair. Checkout
fails closed when signing or durable storage configuration is missing: it
returns `checkoutDisabled`, not `billingDisabled`, so entitlement refresh and
purchase management stay available. Stripe customer creation sends an
`Idempotency-Key` per Clerk identity, so concurrent first requests that Stripe
Search has not caught up with share one customer. The customer portal supports invoices, payment-method updates and cancellation at
the end of the current paid period, with no proration or plan switching.

The production webhook subscribes to checkout completion and subscription
creation, updates and deletion. Replacement endpoint secrets go directly into
Vercel configuration, never into source, logs or test artifacts. Disable the
superseded endpoint after verifying the replacement.

Run Production Smoke with `scope=billing` only for a deliberate checkout check.
It creates monthly and annual unpaid QA sessions and a portal session through
real Clerk-authenticated API requests, then checks that reload still reports
Free and revokes the disposable login. It never submits payment. Immediately
expire the checkout sessions through Stripe and verify their unpaid status,
price, amount, return URLs and account binding. Scheduled smoke excludes this
checkout creation; its Free-account checks expect billing enabled. For a
billing-off rollback, run that spec with
`PROMPTLAB_EXPECT_BILLING_ENABLED=false` to retain the terminal disabled checks.

This restoration covers purchasing and account management. The existing
prelaunch feature-access policy remains separate; enabling billing does not
itself change `FEATURE_GATES_ENABLED`. Unpaid checkout proves neither paid
activation nor renewal, cancellation, refund or native distribution acceptance.
Keep those evidence gates separate from the completed Library acceptance.

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

## Verification — October 12, 2026

PRs [143](https://github.com/DaveHomeAssist/prompt-lab/pull/143) and
[144](https://github.com/DaveHomeAssist/prompt-lab/pull/144) merged through
`a2b7e368d744d5d228d2171e171c5625cccffb0a`. Vercel production
`dpl_4wTh4QYPsg7wRP76QBPxnnEdqjRf` is READY on that source.

| Check | Result |
| --- | --- |
| Production configuration | Billing enabled; monthly/yearly prices, webhook secret, durable store and portal present |
| [Billing smoke 38296634420](https://github.com/DaveHomeAssist/prompt-lab/actions/runs/38296634420) | Authenticated monthly/annual checkout, portal, Free after reload and disposable-session cleanup passed |
| Stripe API cleanup | Four QA sessions across both attempts expired unpaid; no subscriptions or payment intents |
| Replacement webhook | Four genuine expiration events persisted; temporary expiration subscription removed, normal four lifecycle events retained, old endpoint disabled |
| [Owner smoke 38296805582](https://github.com/DaveHomeAssist/prompt-lab/actions/runs/38296805582) | Test head `9229c2d` verified real Owner Pro entitlement, reload, collection input, export, batch access, Diff and Model Arena against unchanged runtime `a2b7e36`; disposable login revoked, prior logins preserved |
| [Full production smoke 38296850377](https://github.com/DaveHomeAssist/prompt-lab/actions/runs/38296850377) | Nine cases passed on exact main `a2b7e36`; the two explicit manual scopes ran separately above |
| PR144 final-head CI | API Safety 38296445392 (82 tests), Extension 38296445413 and Landing 38296445470 passed |
| Deployment logs through 19:22 UTC | 40 responses: 35 license, two checkout, one portal and two webhook; all 200, zero 5xx; duration unavailable in retrieved fields |

The first checkout attempt reached portal 400 because Stripe Search had not yet
indexed its customer. PR144 fixes that path without adopting a customer bound to
another Clerk account. The initial owner probe returned Free; its exactly matched,
verified Clerk ID was added through the supported production owner-ID alias,
preserving the existing sensitive list. A later owner test selector incorrectly
expected the Free Upgrade button; the final test asserts the Owner Pro badge and
absence of Upgrade, preserving the feature assertions. Failed runs remain in CI.

No payment or paid provider request was submitted. Existing hosted proxy/shared
key flags remain enabled, telemetry persistence remains disabled, and billing
routes retain their 10-second limit. Hosted proxy retains its existing 60-second
limit and shared service budget. Paid lifecycle, hosted generation after exhausted
quota, any other intended owner accounts, feature-access policy, native distribution
and human acceptance remain separate gates.

### Stripe test lifecycle verification

`scripts/stripe-test-lifecycle.mjs` exercises actual Stripe test subscriptions
through the production `lookupBilling()` helper. It requires Node 22 and these
environment variables supplied through a secret manager or process environment:

- `PROMPTLAB_STRIPE_TEST_RUN=true`: explicit opt-in to create disposable test data.
- `STRIPE_TEST_SECRET_KEY`: only an `sk_test_` or `rk_test_` key is accepted.
- `STRIPE_TEST_ACCOUNT_ID`: the expected account, verified before mutations.
- `STRIPE_TEST_REPORT_PATH`: optional path for the sanitized JSON receipt.

Run `node scripts/stripe-test-lifecycle.mjs` from `prompt-lab-source`.
Never replace production `STRIPE_SECRET_KEY` with a test key. The harness refuses
enabled webhook destinations so simulation events cannot reach production
storage. Use a dedicated test environment when that preflight fails; do not
disable another integration's endpoints to make the check pass.

The test creates its own USD 9 monthly and USD 99 annual prices, customers with
no email addresses, test Visa payment methods, subscriptions and test clocks.
For each period it verifies Free before purchase, a paid activation invoice and
Pro access, a distinct paid renewal invoice and extended period, partial and
full refunds, Pro until scheduled cancellation takes effect, then Free with no
extra charge. Refund alone retains active access: the lookup reads
subscription status only. The draft [billing policy](billing-policy.md) pairs a
full refund with immediate cancellation in the Stripe Dashboard. Assertions are exact, including
the existing `annual` entitlement value.

Cleanup deletes only the clocks created in that run (and their test customers
and subscriptions), verifies customer deletion, and archives only its own
tagged prices/product. Any failed assertion or cleanup makes the run fail.
Receipts contain object IDs and outcomes, never payment URLs, card details,
customer email, credentials or full provider payloads. API Safety runs the
offline guard tests only; it cannot create Stripe objects.

This proves Stripe test API and billing lookup integration. Authenticated paid
browser behavior, signed webhook delivery/replay/order handling, production
refund policy, hosted generation, and native/human acceptance remain distinct.
Stripe's [test clock API](https://docs.stripe.com/api/test_clocks/advance) and
[refund API](https://docs.stripe.com/api/refunds/create) define the simulation
and refund operations used here.

On 2026-10-12, Walter (Windows 11, Node 22.22.1) passed all 13 checks against
the unchanged billing helper at `f0d42b0`. The [sanitized receipt](evidence/stripe-lifecycle-2026-10-12.json)
records the exact source hashes, Stripe test IDs and cleanup. Both periods
completed activation, renewal, partial/full refund and end-of-period cancellation.
The first attempt is retained: its annual expectation incorrectly said `yearly`;
the corrected harness asserts the helper's existing `annual` contract. Both
attempts' customers were verified deleted and their catalog objects archived.
No application behavior or billing policy changed.

Fresh [owner smoke 38298989981](https://github.com/DaveHomeAssist/prompt-lab/actions/runs/38298989981)
passed on `f0d42b0`: Owner Pro after reload, collection editor, export, batch
controls, Diff and Model Arena. Its disposable session was revoked and prior
owner sessions preserved. This does not close hosted-generation quota acceptance.

The manual `Production Smoke` scope `billing-lifecycle` extends this with a real
Clerk QA session and the production UI. It requires the test-only
`STRIPE_TEST_SECRET_KEY` in the existing GitHub production test environment.
Scheduled and `all` runs do not select it. The actual license handler runs inside
the isolated runner process; browser billing traffic is intercepted before it
can reach production. The process uses only a validated test key, disposable
catalog/customer objects, and an ephemeral Redis container. Production secrets
and deployment configuration are not replaced.

Stripe CLI forwards genuine signed test subscription, invoice and refund events
to the loopback handler. The fixture drops events for unrelated customers,
checks durable storage and rejects an invalid signature. It then replays an old
activation event twice after cancellation and checks that the license remains
Free. This tests entitlement safety; the current webhook arrival log does not
provide deduplication or ordered snapshots. The browser slice covers monthly
access and reloads; annual lifecycle remains API coverage. No refund/access
policy decision or broader production readiness is implied. Sessions, CLI
listener, test objects and ephemeral store are cleaned up at the end.

The UI caches a recently validated Pro entitlement for six hours, re-checks
open tabs on that schedule, and limits cached Pro to seven days without a
successful check ([billing policy](billing-policy.md)). Cancellation browser
acceptance uses Settings → Manage Billing → Refresh Status, then reloads and
asserts Free. Reload alone is not immediate revocation proof.

On 2026-10-14, [run 38623592581](https://github.com/DaveHomeAssist/prompt-lab/actions/runs/38623592581)
passed the isolated integration at `9fd4a1d`: all 13 API lifecycle checks, monthly
paid UI transitions, explicit cancellation refresh/reload, genuine signed
webhook persistence, invalid signature rejection and stale/duplicate replay
entitlement safety. The [sanitized receipt](evidence/stripe-lifecycle-2026-10-14.json)
retains source hashes, cleanup and earlier fixture failures. The disposable QA
session, listener and Redis store were cleaned up. No real charges occurred.
