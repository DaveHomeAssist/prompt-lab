# Prompt Lab Patch Status And Next Actions

**Date:** 2026-04-14  
**Repo:** `/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab`

## Current Status

The defined patch phases are complete as far as local implementation and verification allow.

Completed in this pass:

- repo runtime contract tightened to `Node 20.19+` or `22.12+`
- `vite` / `picomatch` security patch landed across web, extension, and desktop
- selective bug-reporting backport landed for the extension and hosted API route
- high-value doc and link drift was cleaned up
- hosted web build now succeeds locally
- extension build now succeeds locally
- desktop build now succeeds locally
- extension automated test suite now passes locally: `38` files, `170` tests
- production Notion envs for bug reporting are configured in Vercel
- integration owned Notion inbox created for bug reporting: `Prompt Lab Bug Reports Inbox`
- fresh preview deployment is ready at `https://prompt-4krrbhvc9-daves-projects-7059ba1c.vercel.app`
- authenticated preview `/app/` shell was verified with `vercel curl`
- release branch commit pushed to GitHub: `e7efd86`

## Root Cause Of The Previous Blocker

The earlier “web build hang” and “Vitest hang” were not caused by the bug-report backport itself.

Observed root cause:

- package installs had been produced under unsupported `Node 25.8.1`
- that left the web and extension dependency trees in a bad runtime state
- symptoms included hanging module evaluation and stalled filesystem reads inside `fast-glob`, `tailwindcss`, `vite`, and `vitest`
- clean reinstalls under a supported runtime fixed the issue

Practical implication:

- local verification for this repo should be treated as unreliable unless it is run under `Node 20.19+` or `22.12+`

## Remaining Unresolved Issues And Risks

### 1. Production deployment has not happened yet

Local builds are green and a preview deployment now exists, but the live production app has not been updated with these patch changes.

Risk:
- production still reflects pre-patch behavior until a deployment is performed

Current state:
- `vercel link` has been restored in `prompt-lab-source/`
- preview deployment is ready at `https://prompt-4krrbhvc9-daves-projects-7059ba1c.vercel.app`
- the preview is protected behind Vercel preview auth, so unauthenticated smoke checks only see the 401 wrapper

### 2. Hosted bug-report flow still needs final hosted verification

The new bug-report endpoint and modal are implemented and unit-tested, and the hosted env values now point at a Notion page owned by the active integration.

Open checks:
- hosted endpoint accepts a real submission
- failure UX is acceptable when Notion rejects the write
- preview API route is verified through a real browser or non-hanging API client

Current state:
- `NOTION_TOKEN` belongs to the Notion integration `SAP Newsletter / Email List`
- that integration now owns page `342255fc-8f44-81cb-a3cd-ed3ee263e4a7`
- local execution of `api/bug-report.js` with the real env values now returns `200 ok`
- Notion contains the created smoke test page `[Low] Local smoke test bug report`
- preview `/api/bug-report` checks through `vercel curl` still hang before a useful response is returned

Practical implication:
- the Notion write path is now proven, but the hosted preview still needs one clean submission test from a browser or another stable client

### 3. Test warnings remain

The extension suite passes, but the following warnings still exist:

- React `act(...)` warnings in `src/tests/providerSettings.test.jsx`
- React `act(...)` warnings in `src/__tests__/useTestCases.test.jsx`

Risk:
- these are not current release blockers, but they weaken signal quality and can hide real async regressions later

### 4. Bundle-size warnings remain

Builds still warn about large chunks:

- web app JS bundle exceeds the default warning threshold
- extension panel JS bundle exceeds the default warning threshold
- desktop main JS bundle exceeds the default warning threshold

Risk:
- slower startup and reduced headroom for future features

### 5. PR and release hygiene is still unfinished

Open GitHub patch work was used as source material, but the repo workflow still needs cleanup.

Outstanding:

- resolve PR `#4` as superseded-by-cherry-picks or split follow-up work
- resolve PR `#5` as merged elsewhere, obsolete, or still needing a smaller regression-only fix
- decide whether to open a release PR from `patch/2026-04-stability-bugreport` or promote directly after hosted QA

## Action Plan

### Immediate

1. Keep using `patch/2026-04-stability-bugreport` as the active release branch until production is shipped.
2. Re-run preview verification against `https://prompt-4krrbhvc9-daves-projects-7059ba1c.vercel.app` and submit one real hosted bug report.
3. Confirm the hosted submission creates a child page under `Prompt Lab Bug Reports Inbox`.
4. Promote to production only after preview verification is complete.
5. Choose release PR or direct promotion based on how you want the ship record captured.

### Before Calling The Patch Fully Shipped

1. Run a manual bug-report submission against the hosted environment.
2. Verify successful Notion write with minimal payload.
3. Verify failure UX with invalid Notion configuration or access denial.
4. Smoke-test the extension settings entry point and command-palette entry point for bug reporting.

### Next Cleanup Pass

1. Triage bundle-size reduction opportunities in web, extension, and desktop builds.
2. Add a CI or local guard that makes unsupported Node installs harder to perform silently.
3. Close or replace stale PRs `#4` and `#5` with smaller, current follow-up work.

## Most Recent Evidence

- `PATH=/tmp/node-v20.19.0-darwin-arm64/bin:$PATH npm run preflight:quick` now passes with warnings only
- warning surface is limited to the intentional dirty working tree and extension bundle size
- local execution of `api/bug-report.js` now succeeds end to end against the integration owned inbox page
- Notion fallback intake is now documented in `README.md`
- branch `patch/2026-04-stability-bugreport` is committed and pushed to origin at `e7efd86`

## Recommended Next Command Sequence

```bash
cd /Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab
git checkout patch/2026-04-stability-bugreport
```

Then deploy or promote from the same supported runtime used for local verification.
