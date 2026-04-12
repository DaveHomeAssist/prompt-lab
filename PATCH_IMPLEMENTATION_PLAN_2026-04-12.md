# Prompt Lab Patch Implementation Plan

**Date:** 2026-04-12  
**Repo:** `/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab`  
**Baseline:** `main` at `fc012e7`  
**Goal:** land the useful patch work around Prompt Lab without destabilizing the currently shipping `main`.

---

## 1. Current Baseline

- `main` is clean and tracks `origin/main`.
- The live hosted app at `https://promptlab.tools/app/` matches a fresh local build of current `main`.
- Maintained extension test suite passes on a fresh clone: `37` test files, `166` tests.
- Open PRs:
  - `#4` `feat: Script Agent, bug reporter, editor UX, and build cleanup`
  - `#5` `Fix crash: move useNavigation hook before first reference`
- All three frontend packages currently report fixable high-severity audit issues tied to `vite` / `picomatch`:
  - `prompt-lab-source/prompt-lab-extension/`
  - `prompt-lab-source/prompt-lab-web/`
  - `prompt-lab-source/prompt-lab-desktop/`
- Runtime contract is still `Node 20.x`, but local work currently succeeds under newer Node with warnings rather than hard failure.

---

## 2. Patch Assessment

### PR #4

This PR should **not** be merged wholesale.

It contains three different categories of work:

1. **Potentially useful, low-to-medium risk**
   - bug-reporting backend route
   - bug-reporting client library
   - bug-report modal UI
   - `.vercelignore` / build artifact cleanup

2. **Already superseded or conflicting**
   - `api/proxy.js` patch is older than current `main`
   - current `main` already has:
     - Anthropic-only hosted-web rules
     - hosted shared-key logic
     - burst + demo limits
     - KV-backed rate-limit fallback
     - request sanitization
   - importing the PR version would be a regression

3. **Broad shared-frontend refactor / stale UI surgery**
   - `App.jsx` reorganization
   - `RunTimelinePanel.jsx` behavior reshaping
   - multiple extracted UI files
   - tracked `dist/` output
   - these are too invasive to cherry-pick blindly against current `main`

### PR #5

This PR should be treated as **validate-first**.

- Its stated crash fix is narrow.
- Current `main` already deploys successfully and matches production.
- The referenced crash must be reproduced on current `main` before any merge.
- If not reproducible, close PR `#5` as obsolete or replace it with a smaller regression test only.

---

## 3. Implementation Strategy

The work should be split into **five phases**, each with its own exit gate.

### Phase 0 — Triage and Branch Hygiene

**Objective:** convert the open patch pile into explicit merge decisions before touching code.

**Tasks**

1. Create a dedicated patch branch from current `main`.
2. Mark PR `#4` as a source of cherry-picks, not a merge candidate.
3. Reproduce or disprove PR `#5` on current `main`.
4. Identify which tracked `dist/` files from PR `#4` are obsolete and should stay excluded.

**Deliverables**

- one working branch for patch landing
- written decision on:
  - PR `#4` split plan
  - PR `#5` keep/close decision

**Verification**

```bash
git checkout -b patch/2026-04-stability-bugreport
git status --short --branch
```

**Exit criteria**

- patch branch exists
- PR `#4` is decomposed into subtracks
- PR `#5` has a reproduction verdict

---

### Phase 1 — Security / Tooling Patch

**Objective:** remove the repo-wide `vite` / `picomatch` audit exposure first.

**Scope**

- `prompt-lab-source/prompt-lab-extension/package.json`
- `prompt-lab-source/prompt-lab-web/package.json`
- `prompt-lab-source/prompt-lab-desktop/package.json`
- corresponding lockfiles

**Tasks**

1. Upgrade `vite` in all three packages to a non-vulnerable version line.
2. Regenerate lockfiles.
3. Re-run `npm audit --json` in all three packages.
4. Re-run extension tests and web build.
5. Re-run desktop build at least to dependency resolution / Vite build stage if full Tauri packaging is too heavy.

**Dependencies**

- decide whether to keep mixed Vite major versions or standardize them
- ensure plugin compatibility:
  - extension currently uses `@vitejs/plugin-react@^5.2.0`
  - web and desktop use `@vitejs/plugin-react@^6.0.1`

**Risks**

- lockfile churn across packages
- plugin version mismatch after Vite upgrade
- Node-version edge cases during CI/dev parity

**Verification**

```bash
cd prompt-lab-source/prompt-lab-extension && npm audit --json
cd prompt-lab-source/prompt-lab-web && npm audit --json
cd prompt-lab-source/prompt-lab-desktop && npm audit --json

cd prompt-lab-source/prompt-lab-extension && npm test
cd ../prompt-lab-web && npm run build
cd ../prompt-lab-desktop && npm run build
```

**Exit criteria**

- no remaining fixable high-severity `vite` / `picomatch` advisories
- extension tests still pass
- web build still matches expected output shape

**Rollback**

- revert only the package and lockfile changes if build/test parity breaks

---

### Phase 2 — Bug Reporting Patch (Selective PR #4 Salvage)

**Objective:** land bug reporting without importing the stale App / Evaluate refactor from PR `#4`.

**Adopt from PR #4**

- `prompt-lab-source/api/bug-report.js`
- `prompt-lab-source/prompt-lab-extension/src/lib/bugReporter.js`
- `prompt-lab-source/prompt-lab-extension/src/BugReportModal.jsx`

**Do not adopt as-is**

- PR `#4` `App.jsx` refactor
- PR `#4` `RunTimelinePanel.jsx` rewrite
- PR `#4` tracked build output

**Implementation approach**

1. Add the backend endpoint first.
2. Add the client library and unit tests for:
   - payload sanitization
   - endpoint resolution
   - error handling
3. Add the modal UI.
4. Integrate the modal into current `main` with the smallest possible hook-up:
   - one header/button entry point
   - one command-palette action if low cost
   - no broad navigation refactor
5. Gate submission through env presence:
   - `NOTION_TOKEN`
   - `NOTION_BUG_REPORT_PARENT_PAGE_ID`

**Open decisions**

1. Should bug reports always write to Notion directly through Vercel?
2. Should prompt context attachment remain opt-in?
3. Should extension and desktop submit to the hosted endpoint by default, or should bug reporting be web-only initially?

**Risks**

- Notion outage or credential misconfig causing noisy UX
- accidental prompt leakage if prompt-context defaults are wrong
- added modal complexity inside already-large `App.jsx`

**Verification**

```bash
cd prompt-lab-source/prompt-lab-extension && npm test
cd ../prompt-lab-web && npm run build
```

Manual:

1. Open app shell.
2. Open bug report modal.
3. Submit with required fields only.
4. Submit with prompt context enabled.
5. Verify failure UX when env vars are absent.

**Exit criteria**

- bug report can be submitted successfully
- env-missing path fails cleanly
- no regression in current app navigation

**Rollback**

- remove the bug-report route + modal entry point only
- keep unrelated dependency/security work intact

---

### Phase 3 — Docs / Drift Patch

**Objective:** clean the highest-value stale references so the repo stops contradicting shipped reality.

**Priority docs to fix**

- `CURRENT_PROJECT_REPORT.md`
- `SESSION_HANDOFF_PROMPT.md`
- `V1.6.0_NOTES.md`
- distribution drafts under `prompt-lab-source/distribution/`
- public template pages still linking old repo:
  - `docs/templates/index.html`
  - `prompt-lab-source/prompt-lab-web/public/templates/index.html`

**Rules**

- treat runtime migration constants as functional until proven otherwise
- do not remove legacy origins used by migration code/tests unless replacement behavior is verified
- fix public-facing and operator-facing drift first

**Drift categories**

1. old hosted app URL: `prompt-lab-tawny.vercel.app`
2. old repo URL: `prompt-lab-provider-options`
3. stale GitHub Pages framing in active docs
4. outdated issue state where `AGENTS.md` and handoff docs disagree

**Verification**

```bash
rg -n "prompt-lab-tawny\\.vercel\\.app|prompt-lab-provider-options" .
npm run docs:check --prefix prompt-lab-source
```

**Exit criteria**

- operator docs reflect current deployment
- public docs stop pointing at stale repo/app URLs
- remaining legacy references are intentional and documented

---

### Phase 4 — Evaluate / Patch QA

**Objective:** close the remaining uncertainty around the Evaluate surface and PR `#5`.

**Tasks**

1. Reproduce the PR `#5` crash claim on current `main`.
2. If reproducible:
   - implement the minimal fix on top of current `main`
   - add regression coverage
3. If not reproducible:
   - close PR `#5`
   - record why it is obsolete
4. Run focused Evaluate QA on current implementation:
   - timeline filters persistence
   - compare-model toggle behavior
   - history/compare navigation state
   - error states
   - pagination / load more

**Verification**

```bash
cd prompt-lab-source/prompt-lab-extension && npm test
```

Manual:

1. Open `Runs`.
2. Switch between timeline / compare flows.
3. Persist filters.
4. Reload.
5. Confirm no stuck compare state.

**Exit criteria**

- PR `#5` is either merged as a verified fix or closed as obsolete
- Evaluate issue `003` can be moved to resolved or narrowed to a smaller follow-up

---

### Phase 5 — Release Gate and Deploy

**Objective:** ship the patch set in one controlled release rather than as partial drift.

**Tasks**

1. Run repo-level preflight.
2. Run extension tests.
3. Build web.
4. Build landing publish artifacts.
5. Deploy preview.
6. Smoke-test preview.
7. Deploy production only if preview passes.

**Verification commands**

```bash
cd prompt-lab-source && npm run preflight:quick
cd prompt-lab-extension && npm test
cd ../prompt-lab-web && npm run build
cd .. && npm run build:landing
cd .. && npm run deploy:preview
```

**Manual smoke checklist**

1. `promptlab.tools/` landing loads.
2. `/app/` loads and Clerk/auth behavior is unchanged.
3. Hosted Anthropic flow still works.
4. `/privacy`, `/setup`, `/guide`, `/tools`, `/templates` resolve correctly.
5. If bug reporting shipped, submit one real test report and confirm Notion write.

**Exit criteria**

- preview behaves correctly
- production deploy happens from the same tested commit
- PR / docs state updated after deploy

---

## 4. Recommended Merge Decisions

### Accept now

- dependency/security patch
- docs drift cleanup
- bug-reporting stack from PR `#4`, but only as a selective backport

### Accept only after rework

- any script-agent landing work from PR `#4`
- any Evaluate UX changes from PR `#4`

### Reject / do not port

- PR `#4` `api/proxy.js` as written
- PR `#4` tracked `dist/` artifacts
- PR `#4` broad `App.jsx` and `RunTimelinePanel.jsx` surgery without fresh diffing against current `main`

### Validate then close or merge

- PR `#5`

---

## 5. Most Dangerous Gaps if We Skip Planning

### Blocker

- Merging PR `#4` wholesale would likely regress the hosted proxy and destabilize current `main`.

### Significant

- Shipping without the Vite audit patch leaves avoidable security debt across all surfaces.
- Cleaning legacy URLs without distinguishing docs drift from migration code could break library migration paths.
- Landing bug reporting without env/Notion failure handling would create broken UI in production.

### Minor

- Leaving `act(...)` test warnings in place does not block shipping but increases noise and hides future regressions.

---

## 6. Recommended First Three Changes

1. Patch `vite` / `picomatch` across extension, web, and desktop.
2. Validate PR `#5` and close it if the bug is not reproducible on current `main`.
3. Backport bug-reporting as a standalone slice from PR `#4` without importing its broad frontend refactor.

---

## 7. Success Definition

This patch cycle is successful if all of the following are true:

- security audit findings are removed or reduced to accepted non-blocking items
- current production behavior remains stable
- open PRs are no longer ambiguous
- bug-reporting is either shipped cleanly or explicitly deferred
- repo/docs state matches real deployment state
- one preview deploy passes before production

