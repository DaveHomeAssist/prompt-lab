# Prompt Lab Ship-Readiness Audit

Date: 2026-04-27
Repository: `prompt-lab`

## Verdict

Prompt Lab is not ready for paying customers today.

The app can build locally and the unit suite passes, but there are release-blocking problems in security, billing authorization, telemetry consent, production persistence, and the automated browser smoke tests. The most important issue is not visual polish. It is trust: a paying product must not let paid access or billing portal access be controlled by an arbitrary email string, must not ship with critical dependency advisories, and must not rely on a failing/stale E2E gate.

This audit is evidence-based from the current local checkout. It is not a claim that every possible future defect has been discovered.

## Verified Commands

| Area | Command | Result |
| --- | --- | --- |
| Node/npm | `node --version`, `npm --version` | Node `v20.20.2`, npm `10.8.2` |
| Unit/integration tests | `npm test` from `prompt-lab-source` | Passed: 39 files, 182 tests. React `act(...)` warnings remain. |
| Extension build | `npm run build` from `prompt-lab-source` | Passed. Bundle warning: panel JS over 500 KB. |
| Web build | `npm run build` from `prompt-lab-source/prompt-lab-web` | Passed. Bundle warning: app JS over 500 KB. |
| Desktop build | `npm run build` from `prompt-lab-source/prompt-lab-desktop` | Passed after `npm ci`. Bundle warning: app JS over 500 KB. |
| Tauri Windows build | `npm run tauri:build` from desktop package | Passed locally after dependencies/toolchain available. |
| Quick preflight | `npm run preflight:quick` | Passed with warnings: dirty tree and extension bundle over budget. |
| Extension E2E | `npm run test:e2e` | Failed 4/4. Tests expect an `Enhance` button that the current UI no longer exposes. |
| Extension npm audit | `npm audit --audit-level=moderate` | Failed: high Vite/picomatch and moderate PostCSS advisories. |
| Web npm audit | `npm audit --audit-level=moderate` | Failed: critical Clerk advisory plus Vite/picomatch/PostCSS advisories. |
| Desktop npm audit | `npm audit --audit-level=moderate` | Failed: Vite/picomatch/PostCSS advisories. |

## P0 Release Blockers

### 1. Billing activation and portal access are email-based, not strongly authenticated

Evidence:

- `prompt-lab-source/prompt-lab-extension/src/hooks/useBillingState.js:149` posts `customerEmail` to `/billing/license`.
- `prompt-lab-source/api/billing/license.js:23` reads `customerEmail` and `customerId` from the request body.
- `prompt-lab-source/api/_lib/stripeBilling.js:209` can find a Stripe customer by email.
- `prompt-lab-source/api/_lib/stripeBilling.js:299` looks up billing by `customerId` or `email`.
- `prompt-lab-source/api/_lib/stripeBilling.js:312` creates a billing portal session from `customerId` or `email`.
- `useBillingState.js:79` can attach a Clerk token, but the backend path does not prove that the token is verified and bound to the requested Stripe customer.

Why this is unshippable:

A customer identity and a Stripe customer identity must be cryptographically bound. A paid product cannot allow an arbitrary email submitted by a client to unlock paid status or reach account-management flows.

Complete solution:

1. Require a verified identity for all hosted web billing operations.
2. Verify Clerk JWTs server-side using Clerk JWKS or the official backend SDK.
3. Bind the Clerk user ID and verified email to the Stripe customer via checkout metadata.
4. For extension and desktop, replace raw email activation with a signed device activation flow:
   - User signs in on web.
   - Web creates a short-lived activation code for the authenticated user.
   - Extension/desktop submits the code.
   - API returns a signed license token scoped to user, product, tier, device, issue time, and expiry.
5. Store only signed license state locally.
6. Add tests proving that one user's email cannot activate another user's subscription or portal session.

### 2. Critical and high dependency advisories are present

Evidence:

- Web package audit reports a critical Clerk advisory through `@clerk/shared`.
- Extension, web, and desktop audits report Vite/picomatch/PostCSS advisories, including high severity Vite development server arbitrary file read/path traversal advisories.

Why this is unshippable:

A paid customer release should not ship while the package manager reports critical authentication middleware or dev server path traversal advisories, especially when the app is monetized through Clerk and Stripe.

Complete solution:

1. Upgrade `@clerk/clerk-react` and transitive Clerk packages to patched versions.
2. Upgrade Vite in extension, web, and desktop to patched releases.
3. Upgrade PostCSS to at least the patched version reported by audit.
4. Resolve `picomatch` through upstream upgrades or a package override.
5. Regenerate lockfiles.
6. Run:
   - `npm audit --audit-level=moderate` in all packages
   - root test suite
   - extension, web, and desktop builds
   - extension E2E suite
   - desktop Tauri build
7. Add audit gates to CI so these regressions cannot return unnoticed.

### 3. The browser E2E release gate fails and is stale against the current UI

Evidence:

- `prompt-lab-source/prompt-lab-extension/e2e/extension-smoke.spec.js:58` expects a button named `Enhance`.
- `prompt-lab-source/prompt-lab-extension/e2e/responsive-smoke.spec.js:76` clicks the same stale `Enhance` selector.
- The current UI exposes `Refine Prompt Ctrl+Enter` after entering text.
- `npm run test:e2e` fails 4/4 after Playwright Chromium is installed.

Why this is unshippable:

The automated browser suite is not currently proving the main customer flow. A product cannot be called ready if the smoke tests are failing and the failure is allowed to sit at the release boundary.

Complete solution:

1. Update E2E tests to current, stable semantics.
2. Prefer explicit accessible names or `data-testid` values for durable controls:
   - prompt input
   - refine action
   - output panel
   - save to library
   - library search
   - test case run action
   - Pro-gated action
   - billing modal
3. Add smoke coverage for:
   - entering a prompt
   - refining/generating output
   - saving to library
   - reloading and seeing persisted local library data
   - mobile viewport navigation
   - Pro gating behavior
   - billing modal open/close
4. Make E2E part of CI release gates.
5. Do not skip or weaken the tests to make the suite green.

### 4. Telemetry is enabled by default and can send before explicit consent

Evidence:

- `prompt-lab-source/prompt-lab-extension/src/lib/telemetry.js:8` initializes `telemetryEnabled: true`.
- `prompt-lab-source/prompt-lab-extension/src/lib/telemetry.js:22` treats anything other than explicit `false` as enabled.
- `prompt-lab-source/prompt-lab-extension/src/hooks/useTelemetryState.js:27` posts telemetry to `${apiBase}/telemetry`.
- `prompt-lab-source/prompt-lab-extension/src/App.jsx` records app, navigation, billing, editor, and library events.

Why this is unshippable:

For a paid product, analytics collection needs a clear privacy posture. Opt-out event collection before consent is a trust and compliance risk.

Complete solution:

1. Make telemetry opt-in by default.
2. Show a first-run consent surface before any telemetry is sent.
3. Do not queue or post identifiable events until consent exists.
4. Add a persistent "off" state that prevents future event collection.
5. Add a delete/export data path if telemetry is tied to accounts.
6. Update privacy docs to match actual behavior.
7. Add tests proving no telemetry request is made before consent.

### 5. Billing and telemetry persistence can degrade to console-only storage

Evidence:

- `prompt-lab-source/api/_lib/stripeBilling.js:61` enables `consoleFallback` by default.
- `prompt-lab-source/api/_lib/stripeBilling.js:433` can log webhook records to console when no durable store is configured.
- `prompt-lab-source/api/_lib/telemetryStore.js` supports Redis/KV, but also falls back when persistence is absent.

Why this is unshippable:

Billing webhook state must be durable and idempotent. Telemetry should either be durably stored according to policy or disabled. Console-only production behavior creates reconciliation, support, and audit failures.

Complete solution:

1. Require Redis/KV in production for billing webhook state.
2. Fail deployment or healthcheck if required persistence is missing.
3. Store Stripe webhook event IDs idempotently.
4. Add subscription reconciliation from Stripe as a scheduled/manual recovery job.
5. Disable telemetry in production if no durable telemetry store is configured.
6. Add alerting for failed webhook processing.

### 6. Production web auth can silently fall back to an unauthenticated app

Evidence:

- `prompt-lab-source/prompt-lab-web/app/main-web.jsx:9` reads the Clerk publishable key.
- `prompt-lab-source/prompt-lab-web/app/main-web.jsx:69` logs an error and renders `<App />` without Clerk when the key is missing.

Why this is unshippable:

That fallback is useful for local development, but a production paid web app must fail closed if auth configuration is missing.

Complete solution:

1. Allow unauthenticated fallback only in local development.
2. In production, render a hard configuration error page or fail build/deploy when the Clerk key is absent.
3. Add a CI check for required production environment variables.
4. Add a web smoke test that verifies auth is active in production mode.

### 7. Pricing and feature-gating contract is inconsistent

Evidence:

- `prompt-lab-source/prompt-lab-extension/src/lib/billing.js` defines gated features as `abTesting`, `diffView`, `batchRuns`, `collections`, and `export`.
- `prompt-lab-source/prompt-lab-web/index.html` markets Pro capabilities such as prompt composer templates, PII scanner, auto-redaction, and advanced linting rules.
- Some marketed Pro items do not appear to map cleanly to the billing feature gate list.

Why this is unshippable:

Customers need a precise promise about what they get for free and what they pay for. The product should not advertise paid features that are actually free, missing, or gated under a different name.

Complete solution:

1. Create a single source of truth for Free and Pro feature entitlements.
2. Generate or import pricing copy from that source in the web page and app UI.
3. Make every gated UI control reference the same entitlement key.
4. Add tests that verify the pricing page and app gates agree.
5. Remove, implement, or correctly gate every marketed Pro feature.

## P1 Ship-Quality Blockers

### 8. Billing CORS does not allow the Authorization header it tries to send

Evidence:

- `prompt-lab-source/prompt-lab-extension/src/hooks/useBillingState.js:82` sends `Authorization: Bearer ...` when a Clerk token is present.
- `prompt-lab-source/api/_lib/stripeBilling.js:26` allows only `Content-Type, Stripe-Signature` in CORS headers.

Complete solution:

1. Include `Authorization` in `Access-Control-Allow-Headers` for endpoints that require Clerk tokens.
2. Restrict `Access-Control-Allow-Origin` to known extension, desktop, and hosted web origins.
3. Add `Vary: Origin`.
4. Add integration tests for authenticated preflight requests.

### 9. Desktop package is not self-contained

Evidence:

- `prompt-lab-source/prompt-lab-desktop/package.json` does not declare all dependencies imported by shared extension source, including `react-router-dom` and `diff-match-patch`.
- The local desktop build passed because sibling package dependencies were already present in the working tree.

Complete solution:

1. Add every shared-source runtime import to the desktop package dependencies.
2. Alias those dependencies in desktop Vite config so they resolve from desktop `node_modules`.
3. Add a clean CI job that checks out the repo, installs only the desktop package, and builds desktop without relying on sibling `node_modules`.

### 10. Hosted provider proxy needs production controls

Evidence:

- `prompt-lab-source/api/proxy.js` exposes a shared proxy path with broad CORS behavior.
- Shared-key rate limiting can rely on memory fallback when KV is absent.
- The current proxy path appears Anthropic-specific while the product UI supports multiple provider concepts.

Complete solution:

1. Restrict allowed origins.
2. Require durable rate limiting in production.
3. Add request size limits and model allowlists.
4. Add per-user or per-license budgets for shared-key usage.
5. Either implement secure proxies for every advertised hosted provider or make the UI/docs explicit that only Anthropic proxying is hosted.

### 11. Bundle size budgets are already failing warnings

Evidence:

- Extension build reports a panel chunk over 500 KB.
- Web build reports an app chunk over 500 KB.
- Desktop build reports an app chunk over 500 KB.
- `preflight:quick` warns about extension JS over the 500 KB budget.

Complete solution:

1. Lazy-load major surfaces:
   - A/B testing
   - Composer
   - Library
   - Run timeline
   - Billing modal
   - Settings modal
2. Split heavy utilities such as diffing and provider adapters.
3. Make bundle budget enforcement consistent across CI and local preflight.
4. Add bundle analysis output to release checks.

### 12. Test suite has unresolved React async warnings

Evidence:

- `npm test` passes but reports React `act(...)` warnings in settings and test-case flows.

Complete solution:

1. Wrap async state transitions in `act`, `waitFor`, or user-event await patterns.
2. Fail tests on unexpected console warnings.
3. Keep intentional warnings explicitly asserted.

## P2 Product-Completeness Work

### 13. Local-first persistence needs an explicit customer promise

Evidence:

- Prompt libraries, local billing cache, settings, and telemetry preferences are stored client-side.

Complete solution:

Pick one product posture and implement it fully:

1. Local-first paid tool:
   - Clear copy that data stays local.
   - Export/import and backup UX.
   - Device activation/license recovery flow.
2. Account-synced paid tool:
   - Authenticated cloud storage.
   - Sync conflict handling.
   - Account deletion/export.
   - Cross-device restore.

Do not leave customers guessing which model they bought.

### 14. Production readiness needs support and incident paths

Complete solution:

1. Add a health endpoint covering Stripe, Clerk, storage, and proxy dependencies.
2. Add structured server logs for billing and proxy failures.
3. Add customer-visible support contact and refund/cancellation path.
4. Document recovery steps for failed checkout, missing license, and webhook replay.
5. Add a release checklist that includes builds, audits, E2E, desktop install test, and billing sandbox test.

## Recursive Implementation Checklist

### Phase 1: Security and trust boundary

1. Upgrade Clerk, Vite, PostCSS, and affected transitive packages.
2. Add audit checks to CI for extension, web, and desktop.
3. Implement server-side Clerk token verification.
4. Bind Clerk users to Stripe customers through checkout metadata.
5. Replace email-based license activation with signed license/device activation.
6. Lock billing portal access to the authenticated Stripe customer.
7. Add negative tests for cross-account billing access.

### Phase 2: Billing durability

1. Make billing persistence mandatory in production.
2. Store webhook event IDs idempotently.
3. Add Stripe reconciliation.
4. Add billing healthcheck coverage.
5. Add webhook replay documentation and tests.
6. Remove console-only billing fallback from production.

### Phase 3: Consent and privacy

1. Change telemetry default to off.
2. Add first-run consent.
3. Block all telemetry before consent.
4. Add settings to disable telemetry.
5. Add data retention and deletion behavior.
6. Update privacy-facing documentation.

### Phase 4: Release gates

1. Repair extension E2E selectors and assertions.
2. Add web smoke tests for auth, landing, and billing entry points.
3. Add desktop clean install/build CI.
4. Add desktop installer smoke test.
5. Fail CI on E2E failure, audit failure, build failure, and unexpected console warnings.
6. Keep unit tests green without React async warnings.

### Phase 5: Product contract

1. Define the exact Free and Pro entitlement list.
2. Make pricing copy and in-app gating use the same source of truth.
3. Remove or implement every advertised Pro feature.
4. Add tests for gated features.
5. Verify upgrade, downgrade, cancellation, and expired-license states.

### Phase 6: Performance and packaging

1. Split large UI surfaces with dynamic imports.
2. Isolate heavy libraries into lazy chunks.
3. Enforce realistic bundle budgets.
4. Declare all desktop runtime dependencies directly in the desktop package.
5. Verify clean Windows desktop build from a fresh checkout.
6. Verify installer launch, uninstall, and upgrade behavior.

### Phase 7: Customer readiness

1. Add support contact and billing help path.
2. Add license recovery flow.
3. Add export/import or cloud sync, depending on the chosen product posture.
4. Add production monitoring and alerts.
5. Run a full sandbox purchase flow.
6. Run a release candidate through clean browser profiles, clean Windows install, and mobile viewport smoke tests.

## Minimum Definition Of Done For A Paid Launch

Prompt Lab should not be sold until all P0 items are complete and verified. A credible first paid launch requires:

1. No critical/high audit findings in production packages.
2. Passing unit, build, E2E, and desktop installer gates.
3. Authenticated billing tied to a real user identity.
4. Durable production billing/webhook persistence.
5. Explicit telemetry consent.
6. Accurate pricing and feature-gating copy.
7. A tested support/recovery path for payment and license problems.
