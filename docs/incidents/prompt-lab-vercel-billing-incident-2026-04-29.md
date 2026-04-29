# Prompt Lab Vercel Billing Incident Report

Date: 2026 04 29

Project: Prompt Lab

Vercel project: `prompt-lab`

Project ID: `prj_kynCeAMcASaNBIBMRHVJb7sozDfN`

Team: `daves-projects-7059ba1c`

Support case: `#01138635`

## Executive Summary

Prompt Lab incurred unintended Vercel usage during April 2026 with approximately USD 92.3457 tagged to the project inside a USD 106 total team billing view. The largest cost came from Fluid Provisioned Memory and Fluid Active CPU on billing endpoints that reached the Vercel runtime timeout.

The primary technical root cause was a Vercel Node function contract mismatch. Billing handlers returned Web `Response` objects from Node runtime functions without writing those responses to Vercel's Node `ServerResponse`. A request could therefore keep running until the platform timeout instead of terminating.

Stripe webhook handling was not the spend root cause. The webhook shared the same broken response pattern, so it was a latent production defect, but the timeout evidence pointed to `/api/billing/license` and `/api/billing/checkout`.

The containment deployed in commit `93ea5cb70dc22231272f5b911d3f6c6451d70522` added a Node response adapter, disabled billing and hosted provider proxy paths by default, disabled telemetry persistence, capped functions at 10 seconds, pinned Node to 22.x, and verified live production behavior. Production deployment checked: `dpl_AJyJPKC5agM6N1CN2KtezPY9ypxR`.

## Customer Impact

1. Unexpected Vercel spend on a project with no meaningful user load and no revenue.
2. Loss of confidence in Vercel as a viable platform for low revenue or private tools.
3. Prompt Lab instability because safe recovery required pausing, disabling, and redeploying platform features.
4. Pro and billing features are now unavailable by design while cost safety remains prioritized.

## Billing Impact

Billing API window checked during containment: `2026-04-01T00:00:00.000Z` through `2026-04-30T00:00:00.000Z`.

Prompt Lab tagged total at latest check: USD 92.3457.

Service breakdown:

| Service | Amount |
|---|---:|
| Fluid Provisioned Memory | USD 71.1145 |
| Observability Events | USD 12.9385 |
| Fluid Active CPU | USD 7.4971 |
| Function Invocations | USD 0.5999 |
| Build Minutes | USD 0.0905 |
| Fast Origin Transfer | USD 0.0785 |
| Edge Requests additional CPU Duration | USD 0.0162 |
| Build CPU Minutes | USD 0.0105 |

Date breakdown:

| Date | Amount |
|---|---:|
| 2026 04 21 | USD 8.3653 |
| 2026 04 22 | USD 71.4008 |
| 2026 04 23 | USD 0.0001 |
| 2026 04 24 | USD 0.0912 |
| 2026 04 25 | USD 0.0020 |
| 2026 04 26 | USD 1.8241 |
| 2026 04 27 | USD 10.6620 |
| 2026 04 28 | USD 0 |

## Timeline

| Date | Event |
|---|---|
| 2026 04 21 | Prompt Lab began showing material tagged usage in Vercel billing. |
| 2026 04 22 | Largest charge day. Production logs showed 300 second timeout errors on `/api/billing/license` and `/api/billing/checkout`. |
| 2026 04 28 | Project was paused and Fluid Compute was disabled while support request material was prepared. |
| 2026 04 29 | Root cause was isolated to Node response handling. Safe deployment was built, verified, promoted, and unpaused. |

Runtime log evidence from the support request:

```text
2026-04-22T08:48:15.750Z /api/billing/license 504 Vercel Runtime Timeout Error: Task timed out after 300 seconds
2026-04-22T13:03:36.252Z /api/billing/checkout 504 Vercel Runtime Timeout Error: Task timed out after 300 seconds
```

## Root Cause

The API billing handlers were written as Web request handlers returning Web `Response` objects:

```js
return jsonResponse({ error: AUTH_REQUIRED_MESSAGE }, 401);
```

But the files were deployed as Vercel Node runtime API functions:

```js
export const config = { runtime: 'nodejs' };
```

For this project shape, Vercel invoked the default export with Node request and response objects. Returning a Web `Response` object did not necessarily close the Node `ServerResponse`. When a route reached that path in production, the platform could continue waiting until the runtime timeout.

That caused a billing endpoint with no real user value to consume paid runtime for up to 300 seconds per hit.

## Contributing Factors

1. The project allowed too broad a local Node range and the local machine was on Node 25.8.1. The intended runtime was not enforced strongly enough before production recovery work.
2. `vercel.json` did not cap API function duration tightly enough before containment. The platform default allowed 300 second runs.
3. Billing, provider proxy, telemetry, and webhook paths were public API routes without a single documented compute trigger map.
4. Disabled and error paths did not have runtime contract tests proving that Vercel Node functions actually terminate the response.
5. The first pass treated the issue as a billing endpoint or Stripe integration problem instead of immediately testing the platform response contract.
6. The previous deploy guidance did not require live route verification for Vercel production deploys.

## What Was Not The Root Cause

Stripe webhook handling was not the root cause of the charged timeout spike.

The webhook route had the same response contract flaw as checkout and license, so it was correctly patched. But the charged timeout evidence named `/api/billing/license` and `/api/billing/checkout`, not `/api/billing/webhook`.

Stripe itself was not proven to be slow or unavailable. The dangerous failure was that local code and Vercel runtime expectations did not match, so even fast error responses could fail to terminate correctly.

## Why The First Pass Missed It

The first pass did not start with the full platform contract. It focused on the apparent business domain: billing routes, Stripe, Clerk, and environment configuration. That was too narrow.

The missing check was simple and decisive: simulate Vercel's Node request and response objects locally and prove that the handler calls `response.end()` for every path.

The first pass also did not enforce a complete production claim standard. It needed to report local git state, deployed commit, live route behavior, Vercel config, live logs, billing window, and known gaps in one place before saying the issue was isolated.

## Fix Implemented

Commit: `93ea5cb70dc22231272f5b911d3f6c6451d70522`

Production deployment checked: `dpl_AJyJPKC5agM6N1CN2KtezPY9ypxR`

Key files:

| File | Purpose |
|---|---|
| `prompt-lab-source/api/_lib/nodeHandler.js` | Converts Vercel Node request and response objects into Web request handlers and writes Web responses back to Node `ServerResponse`. |
| `prompt-lab-source/api/billing/checkout.js` | Wrapped with the Node compatible handler and billing availability guard. |
| `prompt-lab-source/api/billing/license.js` | Wrapped with the Node compatible handler and billing availability guard. |
| `prompt-lab-source/api/billing/portal.js` | Wrapped with the Node compatible handler and billing availability guard. |
| `prompt-lab-source/api/billing/webhook.js` | Wrapped with the Node compatible handler. |
| `prompt-lab-source/api/proxy.js` | Hosted proxy and shared key paths now default closed. |
| `prompt-lab-source/api/_lib/billingControls.js` | Billing defaults to disabled and logs route, status, duration, timeout state, request id, and note. |
| `prompt-lab-source/vercel.json` | API functions capped at 10 seconds. |
| `prompt-lab-source/tests/nodeFunctionAdapter.test.mjs` | Regression tests prove Node response termination for billing and bug report paths. |

## Verification Completed

Local tests under Node 22:

```text
node --test tests/nodeFunctionAdapter.test.mjs tests/stripeBilling.test.mjs tests/proxy.test.mjs tests/clerkBillingAuth.test.mjs
```

Result: 25 tests passed.

Frontend targeted tests:

```text
npm --prefix prompt-lab-extension run test -- src/tests/providerSettings.test.jsx src/__tests__/useTelemetryState.test.jsx src/__tests__/useBillingState.test.jsx
```

Result: 15 tests passed.

Builds:

```text
npm run build --prefix prompt-lab-web
npm run build --prefix prompt-lab-extension
npm run build --prefix prompt-lab-desktop
```

Result: builds passed. Known warning: chunks larger than 500 kB.

Live checks after production promotion:

| Check | Result |
|---|---|
| `https://promptlab.tools/app/` | 200 |
| `/api/billing/checkout` | 503 JSON, hosted billing unavailable |
| `/api/billing/portal` | 503 JSON, hosted billing unavailable |
| `/api/proxy` | 503 JSON, hosted provider proxy disabled |
| `/api/telemetry` | 200 JSON, mode disabled |
| `/api/billing/webhook` | 503 JSON, webhook secret not configured |

Live log proof included checkout returning status 503 with `timeout=false`, `note=guard-blocked`, and a short duration.

Live Vercel config checked:

| Setting | Value |
|---|---|
| Project paused | false |
| Node version | 22.x |
| Fluid Compute | false |
| Elastic concurrency | false |
| Function default timeout | 10 seconds |

## Current Site State

Available:

1. Static pages and app shell.
2. Main Prompt Lab hosted app.
3. Prompt editing, scoring, library save and load, composer, settings, shortcuts, command palette, local browser storage.
4. Direct Anthropic model calls from the browser with the user's personal key.
5. Bug report submission, which calls Vercel and writes to Notion.

Unavailable by design:

1. Hosted shared Anthropic key.
2. Hosted provider proxy.
3. Stripe checkout.
4. Stripe portal.
5. License validation and Pro unlock path.
6. Telemetry persistence.
7. Stripe webhook processing because the webhook secret is not configured.

## Remaining Cost Surfaces

1. Static page views still create Vercel edge requests and bandwidth.
2. Public API route hits still create Vercel function invocations and observability logs, even when routes return fast 503 responses.
3. Bug report submissions still run a Node function and write to Notion.
4. Telemetry calls still hit an Edge function, even though storage is disabled.
5. Git pushes can trigger Vercel preview builds and build minute charges.
6. Manual verification calls and log checks can create small observability and invocation activity.

## Prevention Controls

These controls are now required for Vercel projects in this workspace:

1. Public compute trigger map before deploy.
2. Paid service and third party write map before deploy.
3. Runtime response contract tests for every API route.
4. Disabled, missing env, unauthenticated, and upstream timeout path tests.
5. Default 10 second API max duration for small products.
6. Disabled by default kill switches for billing, hosted provider proxies, telemetry persistence, webhooks, background jobs, and third party writes.
7. Live Vercel config check before unpausing or promoting production.
8. Live route logs after deploy, including status, duration, timeout state, route, and deployment id.
9. Billing usage window check for cost incidents, with dates and charged line items.
10. Final report that states what still spends money.

## Concrete Confidence Standard For Using Vercel Again

Vercel is acceptable for this workspace only when a project can meet this bar:

1. Static first. Use Vercel mainly for static delivery unless there is a clear product reason for compute.
2. Compute explicit. Every API route is named and classified before deploy.
3. Compute capped. Short `maxDuration` is configured before production.
4. Compute closed. Costly features default to disabled until intentionally enabled.
5. Compute tested. API routes are tested against the actual runtime contract, not only direct function calls.
6. Compute observed. Live logs prove changed routes return quickly.
7. Compute accounted. Billing or usage is checked after containment or deploy work when cost risk exists.

If a project cannot meet that bar, it should stay static, stay local, or move to a platform with simpler cost boundaries for that use case.

## Open Gaps

1. Public bug reports remain enabled and can trigger a Vercel Node function plus Notion writes.
2. Disabled API routes can still create function invocation and observability costs if bots hit them.
3. Git linked preview builds can still create build minute charges.
4. Npm audit findings remain unresolved in Prompt Lab.
5. Privacy copy may still mention a hosted provider proxy even though that proxy is disabled.
6. Production env still contains unused provider and Stripe secrets. Code guards prevent use, but removing unused secrets would reduce blast radius.

## Follow Up Actions

| Priority | Action | Validation |
|---|---|---|
| P1 | Decide whether Prompt Lab should be static only on Vercel. | `/api/*` routes blocked or documented as accepted cost surfaces. |
| P1 | Disable or gate public bug report submissions. | Bot or unauthenticated POST cannot write to Notion. |
| P1 | Disable Git preview deploys or add ignored build rules for non release branches. | Test push does not start a Vercel build unless intended. |
| P2 | Update privacy and setup docs to reflect direct browser Anthropic calls. | Public docs no longer claim hosted proxy behavior. |
| P2 | Remove unused Vercel production secrets for disabled features. | Vercel env list contains only active production needs. |
| P2 | Resolve npm audit findings. | `npm audit` has no critical or high findings, or accepted exceptions are documented. |

## Incident Classification

Severity: P1

Status: contained

Root cause confidence: certain

Recurrence risk after current controls: low for the same response contract bug, medium for cost surprises while public API routes and preview builds remain enabled.
