# Prompt Lab Patch Status And Next Actions

**Date:** 2026-04-12  
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
- preview deployment is ready at `https://prompt-f2med1hcd-daves-projects-7059ba1c.vercel.app`
- the preview is protected behind Vercel preview auth, so unauthenticated smoke checks only see the 401 wrapper

### 2. Bug-report flow still needs hosted/manual verification

The new bug-report endpoint and modal are implemented and unit-tested, but the full hosted path still needs a real environment check.

Open checks:
- `NOTION_TOKEN` is configured in Vercel
- `NOTION_BUG_REPORT_PARENT_PAGE_ID` is configured in Vercel
- hosted endpoint accepts a real submission
- failure UX is acceptable when env vars are missing or Notion rejects the write

Current blocker:
- `NOTION_TOKEN` is not present in the Vercel env list for `prompt-lab`
- `NOTION_BUG_REPORT_PARENT_PAGE_ID` is not present in the Vercel env list for `prompt-lab`

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
- commit and push the local patch branch cleanly

## Action Plan

### Immediate

1. Create a dedicated patch branch from the current local state.
2. Commit the security patch, bug-report feature, warning cleanup, and doc cleanup as one intentional patch set or as two small commits.
3. Preview deploy from the supported `Node 20.19+` environment.
4. Add `NOTION_TOKEN` and `NOTION_BUG_REPORT_PARENT_PAGE_ID` to the Vercel project environment.
5. Re-run preview verification after the bug-report envs are present.
6. Promote to production only after preview verification is complete.

### Before Calling The Patch Fully Shipped

1. Run a manual bug-report submission against the hosted environment.
2. Verify successful Notion write with minimal payload.
3. Verify failure UX with missing or invalid Notion configuration.
4. Smoke-test the extension settings entry point and command-palette entry point for bug reporting.

### Next Cleanup Pass

1. Triage bundle-size reduction opportunities in web, extension, and desktop builds.
2. Add a CI or local guard that makes unsupported Node installs harder to perform silently.
3. Close or replace stale PRs `#4` and `#5` with smaller, current follow-up work.

## Recommended Next Command Sequence

```bash
cd /Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab
git checkout -b patch/2026-04-stability-bugreport
git add .
git commit -m "Patch runtime, security, and bug reporting"
```

Then deploy from the same supported runtime used for local verification.
