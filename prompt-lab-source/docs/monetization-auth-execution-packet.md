# Prompt Lab Monetization and Auth Execution Packet

Status: Active
Owner: Prompt Lab
Purpose: collapse the imported Notion task set into one execution-ready sprint packet with current-state evidence and Claude-ready prompts.

## Scope

This packet covers:

- library recovery closeout
- auth decision
- auth implementation
- Stripe scaffold
- entitlements
- end-to-end verification
- environment hygiene

It is intentionally execution-oriented. It is not a product strategy memo.

## Current Repo Reality

### Already done

- Root and source runtime pins already exist in [/.nvmrc](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/.nvmrc) and [prompt-lab-source/.nvmrc](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/.nvmrc), both set to `22`.
- Legacy web-library bridge exists at [legacy-library-bridge.html](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-web/public/legacy-library-bridge.html).
- Recovery bootstrap exists in [app/index.html](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-web/app/index.html).
- Recovery UI and merge flow exist in [LibraryPanel.jsx](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/LibraryPanel.jsx), [usePromptLibrary.js](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/hooks/usePromptLibrary.js), and [legacyLibraryMigration.js](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/lib/legacyLibraryMigration.js).
- Recovery tests already exist in [legacyLibraryMigration.test.js](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/tests/legacyLibraryMigration.test.js).

### Not implemented yet

- No Clerk or Supabase auth wiring is present in the active source tree.
- No sign-in or sign-up pages are present for hosted auth.
- No `useCurrentUser` wrapper hook exists.
- No Stripe checkout, billing portal, or webhook endpoints exist under [api/](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/api).
- No entitlement server utility or client hook exists.
- No Stripe-related dependencies or config are present in [package.json](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/package.json).

### Existing related infrastructure

- Hosted web deploy config already exists in [vercel.json](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/vercel.json).
- Existing serverless functions live in [api/proxy.js](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/api/proxy.js) and [api/bug-report.js](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/api/bug-report.js).
- The shared frontend lives under [prompt-lab-extension/src](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src), so hosted auth and entitlements should be implemented with that shared-core model in mind.

## Notion Task Normalization

### Already satisfied or mostly satisfied

- `Ship Library Recovery`
- `Deploy legacy library recovery bridge to Vercel, validate in production`
- `Verify postMessage handshake against live tawny origin`
- `Confirm Recover button surfaces in Library panel on promptlab.tools`
- `Confirm silent auto-recovery fires on first load for seed-only libraries`
- `Pin Node version in .nvmrc, match Vercel project setting`

These should be treated as closeout and verification tasks, not fresh implementation work.

### Open workstreams

1. Auth decision
2. Auth implementation
3. Stripe scaffold
4. Entitlements
5. End-to-end test and release verification

### Duplicates or rollups

- `Auth decision: evaluate Clerk vs Supabase, commit to one`
- `Auth Decision: Clerk`

These collapse into one decision lane.

- `Stripe Scaffold API`
- `Build /api/create-checkout-session endpoint`
- `Build /api/create-portal-session endpoint`
- `Add minimal checkout success/cancel pages`
- `Store Stripe keys in Vercel environment variables`
- `Create Stripe Products and Prices in test mode`

These collapse into one Stripe scaffold lane.

- `Webhook Entitlement Store`
- `Build /api/webhook endpoint`
- `Build getEntitlements(userId) server utility`
- `Build useEntitlements client hook`

These collapse into one entitlements lane.

- `End-to-end test full subscribe/cancel loop in test mode`
- `End-to-End Test`

These collapse into one verification lane.

## Recommended Execution Order

1. Library recovery closeout and verification
2. Auth decision
3. Auth implementation
4. Stripe scaffold
5. Entitlements
6. End-to-end verification
7. Environment hygiene

## Acceptance Gates

### Library recovery closeout

- live hosted app can recover from the tawny-origin bridge
- Recover button appears when appropriate
- seed-only and empty-library cases do not get stuck in a false-complete state

### Auth

- one auth model is explicitly chosen and documented
- hosted web app supports sign-in and sign-up
- session state survives refresh and a second browser/device test

### Stripe scaffold

- checkout session endpoint exists
- billing portal endpoint exists
- success and cancel pages exist
- env var names are documented and wired

### Entitlements

- webhook endpoint exists
- durable entitlement lookup utility exists
- client hook exists
- feature gating fails safe when entitlement data is missing

### Verification

- subscribe, portal, and cancel flow work in test mode
- no library recovery regression
- web app still builds and deploys under Node 22

## Claude Master Prompt

```text
You are working in /Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab.

First inspect the repo state, especially AGENTS.md, CLAUDE.md, CURRENT_PROJECT_REPORT.md, prompt-lab-source/DOCS_INVENTORY.md, prompt-lab-source/ARCHITECTURE.md, prompt-lab-source/package.json, prompt-lab-source/vercel.json, and any existing auth/Stripe/entitlements code paths.

Use this execution order:
1. library recovery closeout
2. auth decision
3. auth implementation
4. Stripe scaffold
5. entitlements
6. end-to-end verification
7. environment hygiene

Important current-state constraints:
- library recovery and the legacy bridge already exist; treat that lane as closeout and verification, not greenfield work
- .nvmrc already exists at repo root and prompt-lab-source and is pinned to Node 22
- auth, Stripe, and entitlements do not appear to be implemented yet
- keep the shared-core architecture intact across hosted web, extension, and desktop surfaces

Make direct code changes only where needed, keep scope tight, verify each phase with the smallest relevant tests or build runs you can execute, and report concisely with:
- what you changed
- what you verified
- remaining risks
- absolute file references for every modified file
```

## Claude Phase Prompts

### 1. Library recovery closeout

```text
Work in /Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab.

Inspect the existing library recovery flow first. Focus on:
- prompt-lab-source/prompt-lab-web/public/legacy-library-bridge.html
- prompt-lab-source/prompt-lab-web/app/index.html
- prompt-lab-source/prompt-lab-extension/src/LibraryPanel.jsx
- prompt-lab-source/prompt-lab-extension/src/hooks/usePromptLibrary.js
- prompt-lab-source/prompt-lab-extension/src/lib/legacyLibraryMigration.js
- prompt-lab-source/prompt-lab-extension/src/tests/legacyLibraryMigration.test.js

This lane is not greenfield. Verify what is already implemented, fix any remaining rough edges or regressions, and close out only the recovery-specific issues still present. Verify with the smallest relevant checks and report with absolute file references.
```

### 2. Auth decision

```text
Work in /Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab.

Inspect the current architecture and decide the least risky auth model for Prompt Lab's hosted web app. Compare Clerk vs Supabase only as far as needed to make a decision that fits the existing shared-core plus shell architecture. Document the decision in the repo with minimal edits. Do not implement billing yet. Verify whatever you change and report with absolute file references.
```

### 3. Auth implementation

```text
Work in /Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab.

Inspect the chosen auth path and implement hosted-web auth only. Add the minimal required pieces:
- provider wiring at the app root
- sign-in and sign-up pages using the chosen provider's prebuilt or low-customization components
- a current-user wrapper hook
- session persistence and safe signed-out handling

Do not extend auth into extension or desktop in this pass unless the repo already requires it. Add targeted tests or focused verification and report with absolute file references.
```

### 4. Stripe scaffold

```text
Work in /Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab.

Inspect the repo and add a minimal hosted-web Stripe scaffold:
- environment variable wiring
- create-checkout-session endpoint
- create-portal-session endpoint
- minimal success/cancel pages
- any small config changes needed for Vercel deployment

Do not overbuild the billing system. Keep it test-mode oriented and aligned with the current hosted-web shell. Verify the scaffold does not break existing web behavior and report with absolute file references.
```

### 5. Entitlements

```text
Work in /Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab.

Inspect current feature gating and persistence first, then implement the minimal entitlement layer for hosted web:
- webhook endpoint
- server utility to resolve entitlements for a user
- client hook to read entitlements
- safe fallback behavior when entitlement data is unavailable

Keep the implementation small, explicit, and test-mode friendly. Verify with the narrowest meaningful checks and report with absolute file references.
```

### 6. End-to-end verification

```text
Work in /Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab.

Inspect the full hosted-web monetization path and verify it end to end:
- library recovery still works
- auth works
- checkout session works in test mode
- billing portal works in test mode
- cancel flow updates entitlements correctly

Fix any breakage you find, run the narrowest meaningful verification sequence, and report the final state with absolute file references.
```

### 7. Environment hygiene

```text
Work in /Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab.

Inspect environment files, setup docs, package scripts, and Vercel config related to auth and billing. Clean up stale or confusing setup instructions, add missing env examples, and keep Node 22 assumptions aligned between docs and scripts. Verify the repo still builds or starts cleanly in the intended path and report with absolute file references.
```

## Minimal Human Read

If you only need the next move:

1. Verify library recovery is really closed.
2. Make the auth decision.
3. Implement hosted-web auth.
4. Add the smallest possible Stripe scaffold.
5. Add entitlement plumbing.
6. Run the full subscribe/cancel test loop.

