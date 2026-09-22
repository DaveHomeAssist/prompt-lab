# Guardrails guide — production monitoring and the layout invariant

## Status

- Status: `active`
- Updated: `2026-09-22`
- Landed in: PR #111, `main` at `615ff2b`
- Companion doc: `docs/VIEWPORT_SHELL_OVERHAUL_PLAN.md` (why these exist, and the Phase A work they guard)

## Scope

Three automated guards were added in Phase 0 of the viewport shell overhaul.
This guide explains what each one catches, what it cannot catch, how to run it,
and exactly what to do when it fails.

Read this before starting Phase A, and before changing anything under
`prompt-lab-extension/src/`.

## Source of truth

| Question | Answer lives in |
| --- | --- |
| Does production still work? | `Production Smoke` workflow runs |
| Does the app shell scroll? | `prompt-lab-web/tests/app/layout-invariant.spec.js` |
| Which routes still overflow? | The `KNOWN_PAGE_SCROLL` set in that spec |
| Did the extension or desktop shell move? | `prompt-lab-extension/src/tests/App.shellLayout.test.jsx` |

## Why these exist

The previous PromptLab incident was a functional regression while the site
stayed up. Nothing detected it, for two specific reasons:

- no workflow in `.github/workflows/` had a `schedule:` trigger, so nothing ever
  ran against production unless a human clicked Run workflow
- the one production smoke that existed asserted billing copy — it never wrote,
  saved or reloaded a prompt

An HTTP 200 proved the site was up and nothing proved it worked.

## Current behavior

### 1. Production smoke — is production actually working?

- Workflow: `.github/workflows/production-free-account-smoke.yml` (named
  `Production Smoke`)
- Runs: every 6 hours (`cron: '0 */6 * * *'`) and on demand
- Config: `prompt-lab-extension/playwright.production.config.js`
- Specs: `e2e/production-core-loop.spec.js` and `e2e/production-free-account.spec.js`

The core loop signs in as the dedicated QA account through a Clerk Agent Task,
then writes a prompt, saves it, finds it in Library, reloads, and requires it to
still be there. It performs no enhance, so it needs no provider call: it costs
nothing per run and cannot flake on model latency. It also asserts that no
provider, billing, Stripe or telemetry request was needed, which proves the
write/save path is genuinely local-first.

Scheduled runs execute on the default branch, so they always exercise what
production is built from.

**Needs secrets.** `CLERK_SECRET_KEY` and `PROMPTLAB_QA_FREE_USER_ID` live in
the `Production – prompt-lab` environment. These specs cannot run on a laptop.

Trigger one manually:

```bash
gh workflow run "Production Smoke" --ref main
```

Watch it and read the result:

```bash
gh run list --workflow="Production Smoke" --limit 1
gh run watch <run-id> --exit-status
gh run view <run-id> --log | grep production-core-loop
```

The core loop prints a phase line at each step (`writing a prompt`, `saving the
prompt`, `reloading and re-checking persistence`), so a failure names the stage
that broke rather than only the assertion.

### 2. Layout invariant — does the shell scroll?

- Spec: `prompt-lab-web/tests/app/layout-invariant.spec.js`
- Runs: every pull request, via `landing-gates` in `.github/workflows/landing-ci.yml`
- Matrix: 7 routes x 5 viewports, including 3840x1080 for WEB-3

The invariant is that the document itself never scrolls. Any scrolling belongs
to a panel-local region, never to `documentElement`. It is measured as
`documentElement.scrollHeight - window.innerHeight <= 1`; the one-pixel
tolerance absorbs Chromium's sub-pixel rounding.

The spec seeds 24 library prompts and a scratch note first. Without content the
panels do not overflow and the spec would pass for the wrong reason.

```bash
cd prompt-lab-source/prompt-lab-web
npx playwright test --config=playwright.app.config.js layout-invariant
```

### 3. Shell height contract — did the blast radius escape?

- Test: `prompt-lab-extension/src/tests/App.shellLayout.test.jsx`
- Runs: every pull request, in the extension vitest suite

Extension, desktop and hosted web all render the same `src/App.jsx`. Phase A
changes the hosted web shell only. This test pins all three surfaces so an
accidental change to the extension or desktop shell fails immediately — a bad
extension build waits on a Chrome Web Store re-review to undo, which is the
slowest thing in the project to reverse.

jsdom cannot lay anything out, so this test only string-matches shell classes.
It is a deliberate change detector, not a layout check. The layout check is the
browser spec above.

```bash
cd prompt-lab-source/prompt-lab-extension
npx vitest run src/tests/App.shellLayout.test.jsx
```

## How the allowlist works

`KNOWN_PAGE_SCROLL` holds the route/viewport combinations that overflow today,
as `<routeId>@<viewportId>`. At `fffcbb3` that was 17 of 35.

Entries in the set assert that the route **still overflows**. They do not skip.
This matters: a skip-list silently rots into a permanent exemption, whereas this
set forces its own deletion as soon as a route is repaired. It must reach zero
entries at the end of Phase A.

That produces exactly two failure modes.

### Failure mode A — a route regressed

```text
library@desktop-1440 scrolls the document: 3021px of content in a 900px viewport
(2121px over). Scrolling belongs to a panel-local region, not to documentElement.
Tallest elements:
  div.pl-app-shell  min-h-screen … → 3021px
  main.pl-tab-panel … → 2932px
```

Something you changed made the document scroll. The message lists the tallest
elements, so fix the panel it names. Do not add the key to `KNOWN_PAGE_SCROLL`
to make this pass — that set is for the recorded Phase 0 baseline only, and
adding to it is how the guard dies.

### Failure mode B — you fixed a route

```text
library@desktop-1440 is listed in KNOWN_PAGE_SCROLL but the document now fits
(900px in 900px). Delete "library@desktop-1440" from that set — the invariant
is now real for this route and must stay enforced.
```

This is success. Delete the named key. Commit that deletion with the fix.

## Working through Phase A against these guards

The plan's work order is one panel per pull request, worst overflow first. For
each one:

1. Fix the panel so it owns its own scroll region — exactly one
   `overflow-y: auto`, on the content region, never on the shell.
2. Run the layout invariant. It fails with mode B, naming every key that now
   fits.
3. Delete exactly those keys from `KNOWN_PAGE_SCROLL`.
4. Re-run. The suite is green, and those combinations are now permanently
   enforced.
5. Confirm `App.shellLayout.test.jsx` still passes for extension and desktop.
   If it does not, the change reached a surface it should not have.

Never more than one panel in flight, so a revert is always a single panel.

## Local setup

Everything here needs Node 22. `prompt-lab-source/.nvmrc` pins it and
`scripts/require-node.mjs` enforces it, so `npm run *` fails on any other major.

```bash
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
```

`prompt-lab-web` may not have dependencies installed; `npm ci` in that directory
takes a few minutes the first time. The browser specs start their own Vite dev
server on port 4175, so no server needs to be running first. In dev, with no
`VITE_CLERK_PUBLISHABLE_KEY`, the app mounts unauthenticated, which is why these
specs need no sign-in.

Full local sweep:

```bash
cd prompt-lab-source/prompt-lab-extension && npx vitest run
cd ../prompt-lab-web && npx playwright test --config=playwright.app.config.js
```

## Extending the guards

- **New route**: add it to `ROUTES` in the layout invariant. Routes use
  `HashRouter`, so the URL form is `/app/#/library`.
- **New viewport**: add it to `VIEWPORTS`. Keep 3840x1080 — WEB-3 requires an
  ultrawide evaluation.
- **New panel with its own scrolling region**: nothing to register. The
  invariant measures the document, so any panel that scrolls the page is caught
  automatically.

## Known gaps

- The layout invariant measures the hosted web app only. Extension and desktop
  keep the legacy page-scroll layout through Phase A by design, so there is
  nothing to assert for them yet. When a surface is promoted, extend the spec.
- The invariant proves the document does not scroll. It does not prove the
  result is *good* — that the header is pinned, that the right region scrolls,
  or that nothing below the fold became unreachable. The plan's keep/move/cut
  inventory per panel covers that, and it is a human judgement.
- `tests/app/clerk-sign-in.spec.js` skips without `PROMPTLAB_SMOKE_EMAIL`. That
  skip predates this work.
- The production specs cannot be run locally. A change to them is only proven by
  a real run — trigger one with `gh workflow run` rather than waiting for the
  schedule.

## Verification

Recorded at `main` `615ff2b`, 2026-09-22.

| Check | Result |
| --- | --- |
| Extension vitest | 96 files, 964 tests passed |
| Hosted web browser gates | 25 passed, 1 skipped (pre-existing) |
| Layout invariant vs baseline | 5 passed; matrix reproduced on Linux CI and macOS |
| Allowlist self-cleaning | Verified — a candidate fix made the suite fail demanding removal of each repaired entry |
| PR #111 checks | 14 of 14 green, including desktop builds on three operating systems |
| Production smoke, run 35698760219 | 2 passed in 7.2s against `https://promptlab.tools/app/` — the core loop completed write, save, Library, reload and persistence checks on live production |
