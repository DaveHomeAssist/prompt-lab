# Prompt Lab viewport shell overhaul — plan

## Status

- Status: `Phase A complete on hosted web — shell contained, every panel scrolls its own region, verified on production`
- Created: `2026-09-20`
- Updated: `2026-09-22`
- Operating guide: `docs/guardrails-guide.md`
- Baseline commit: `fffcbb3` (`origin/main`)
- Goal: remove whole-page vertical scrolling from the Prompt Lab app shell, then
  rebuild the navigation model on top of the stabilised shell
- Scope decision: phased (Phase A shell, Phase B interface), hosted web `/app/` first
- Governing rules: `WORKSPACE_OPERATING_RULES.md` WEB-1, WEB-2, WEB-3

## Why this plan is shaped the way it is

The prior PromptLab incident was a **functional regression while the site stayed
up**. The site returning HTTP 200 proved nothing, and nothing else was watching.
That is not a layout problem, so the layout work is deliberately sequenced
*behind* a monitoring fix. Phase 0 exists to make a silent regression
impossible; Phase A and Phase B only start once it is in place.

## Measured diagnosis

Two measurement passes were taken. The first, at 1440x768 against the desktop
code path with an empty library, established the shape. The second is the one
that matters and is now enforced in CI: the hosted web build, seeded with 24
library prompts and a scratch note, across the full route x viewport matrix.

Overflow past the viewport, in pixels, at baseline commit `fffcbb3`:

| Route | 400 | 768 | 1180 | 1440 | 3840 |
| --- | --- | --- | --- | --- | --- |
| Write | 0 | **265** | 0 | 0 | 0 |
| Library | 0 | **2169** | **2121** | **2121** | **1563** |
| Compose | 0 | **2228** | **2161** | **2161** | **1981** |
| Dual Pane | 0 | **1997** | **1917** | **1544** | **1364** |
| Evaluate | 0 | 0 | 0 | 0 | 0 |
| Compare | 0 | 0 | 0 | 0 | 0 |
| Scratch | 0 | **341** | **28** | **28** | **28** |

17 of 35 combinations fail. Two results decide the shape of Phase A:

- **Every mobile-400 combination already passes**, because
  `.pl-app-shell.is-compact` is the correct pattern. The fix is not novel work.
- **Evaluate and Compare pass at every width even when seeded with data**, so
  `RunTimelinePanel` is a working reference implementation of a contained
  panel, not merely an empty one. This resolves the open question left by the
  first pass.

### Root cause 1 — the shell has a height floor, not a height ceiling

`App.jsx:986`:

```jsx
className={`pl-app-shell ${compact ? 'is-compact' : ''} ${isExtension ? 'h-screen overflow-y-auto' : 'min-h-screen'} ...`}
```

On hosted web and desktop the shell is `min-h-screen` — a minimum, not a
maximum. Every descendant already carries `min-h-0` and `overflow-hidden`, but
those are inert, because a flex child cannot clamp against an unbounded parent.
The observed offender chain on Dual Pane is exactly this:

```text
.pl-app-shell (min-h-screen)      clientHeight 2209  ← unbounded, grows to content
  main.pl-tab-panel               clientHeight 2120  ← "overflow-hidden", ignored
    div.grid .min-h-0             clientHeight 2120  ← "min-h-0", ignored
      .pl-dual-workspace          clientHeight 2120
```

**The correct pattern is already in this codebase and already proven.**
`index.css:563`:

```css
.pl-app-shell.is-compact { height: 100dvh; min-height: 0; overflow: hidden; padding-bottom: 0; }
```

Mobile does it right. Desktop does not. This is not a rewrite; it is applying an
existing, shipped rule to a second breakpoint.

### Root cause 2 — `pageScroll` is an opt-out from containment

`App.jsx:133`:

```jsx
const pageScroll = isWeb || isExtension;
```

This boolean is threaded through 8 components across **55 references**
(`App.jsx` 11, `PadTab` 9, `ScratchWorkspace` 8, `ComposerTab` 5, `ABTestTab` 4,
`RunTimelinePanel` 3, `CreateEditorPane` 2, `MainWorkspace` 2). Each reference
is a fork between a document-flow layout and a contained layout, so every panel
carries two layout implementations and only one of them is ever exercised on a
given surface.

### Root cause 3 — hardcoded chrome-height guesses

Five `calc(100vh - Nrem)` constants encode assumptions about header height:

- `PadTab.jsx:254-256` — `9rem`/`7rem`, `13rem`/`11rem`, `16rem`/`14rem`
- `ScratchWorkspace.jsx:224-225` — `9rem`/`7rem`, `18rem`/`16rem`

These are wrong whenever the header wraps, the telemetry banner shows, or
density changes. They must be replaced by flex `min-h-0` chains, not retuned.

### Root cause 4 (Phase B) — three vocabularies for the same concepts

`lib/navigationRegistry.js` is a translation layer between competing names for
identical things: `Write`/`Create`/`editor`, `Evaluate`/`runs`/`experiments`,
`Scratch`/`notebook`/`pad`. The nav is three levels deep — 3 primary views x 4
Create subviews + 2 layout toggles + 2 Evaluate subviews — and `Compose` and
`Dual Pane` are presented as destinations when they are actually layout states
of Write. This is the part that reads as "accumulated internal workbench".

## The guardrail gap (verified on `origin/main`)

```text
$ grep -rn "schedule:" .github/workflows/
NO scheduled workflows at all
```

`production-free-account-smoke.yml` is `on: workflow_dispatch` only. **Nothing
has ever run against production automatically.** Its assertions are also
billing-focused — it checks plan labels, dialog copy and disabled buttons. It
never writes a prompt, never saves one, never reloads to confirm persistence.

A functional regression in the core loop would therefore pass every gate in the
repository and stay invisible until a human happened to try it. That matches the
reported incident exactly.

## Phase 0 — guardrails first, zero UI change (merged)

Merged to `main` as `615ff2b` via PR #111, 14 of 14 checks green. Day-to-day
operation of these guards is documented in `docs/guardrails-guide.md`.

No UI file was touched. Every item below was run locally before commit.

| # | Change | File |
| --- | --- | --- |
| 0.1 | `schedule: '0 */6 * * *'` added alongside `workflow_dispatch`; workflow renamed to Production Smoke | `.github/workflows/production-free-account-smoke.yml` |
| 0.2 | New production **core loop** smoke: write → save → find in Library → reload → still there | `prompt-lab-extension/e2e/production-core-loop.spec.js` |
| 0.2b | PR-time twin of the core loop, run against the local build | `prompt-lab-web/tests/app/core-loop-persistence.spec.js` |
| 0.3 | **Layout invariant** spec over the route x viewport matrix | `prompt-lab-web/tests/app/layout-invariant.spec.js` |
| 0.4 | Per-surface shell height contract for extension, desktop and web | `prompt-lab-extension/src/tests/App.shellLayout.test.jsx` |
| 0.5 | Production config now matches both production specs | `prompt-lab-extension/playwright.production.config.js` |
| 0.6 | Landing CI path filter widened to the shared source tree | `.github/workflows/landing-ci.yml` |

0.2 performs no enhance, so it needs no provider call: it costs nothing per run
and cannot flake on model latency. Because the library is localStorage-backed,
each Playwright run gets a fresh context, so the QA account never accumulates
fixtures.

0.6 matters more than it looks. The layout invariant only guards Phase A if it
actually runs for Phase A's pull requests, and the filter previously named a
handful of individual `src/` files — a PR editing `LibraryWorkspace.jsx` would
not have triggered it. The filter now covers
`prompt-lab-extension/src/**`.

### Why the allowlist asserts failure rather than skipping

`KNOWN_PAGE_SCROLL` holds the 17 failing combinations. Entries in it assert the
route **still overflows**, so repairing a route fails the suite with an explicit
instruction to delete its entry. A skip-list would silently rot into a permanent
exemption; this one cannot. It must reach zero entries at the end of Phase A.

### Phase 0 verification

| Check | Result |
| --- | --- |
| `vitest run` (extension) | 96 files, 964 tests passed |
| `playwright --config=playwright.app.config.js` (web) | 24 passed, 1 skipped (pre-existing: needs `PROMPTLAB_SMOKE_EMAIL`) |
| Layout invariant against baseline | 5 passed — the recorded matrix is reproducible |
| Allowlist self-cleaning | Verified: with a candidate fix applied, the suite failed demanding removal of each repaired entry |
| Production specs | **Executed against live production** after merge — run 35698760219, 2 passed in 7.2s. The core loop completed write, save, Library, reload and persistence on `https://promptlab.tools/app/`, with no provider, billing or telemetry request needed. |
| Workflow YAML | Both files parse; triggers confirmed as `workflow_dispatch` + `schedule` |

### Phase A is smaller than it looked

While verifying the allowlist's self-cleaning behaviour, this candidate patch
was applied temporarily and then reverted:

```css
.pl-app-shell:not(.is-compact) { height: 100dvh; min-height: 0; overflow: hidden; }
.pl-app-shell:not(.is-compact) > main { min-height: 0; overflow-y: auto; }
```

Every one of the 17 failing combinations fitted the viewport. That confirms root
cause 1 and means Phase A's shell step is genuinely a two-line change.

It is **not** the finished job: it makes `main` the single scroll owner, whereas
WEB-2 wants the header pinned and each panel scrolling its own content region.
Phase A still needs per-panel scroll owners. But the risky part — whether the
containment model works at all — is now answered, and it does.

## Phase A — evict vertical scrolling (hosted web only)

### The web-first mechanism

Extension, desktop and hosted web share `src/App.jsx`, so a shell change hits
all three. Rather than fork the code, replace the `pageScroll` boolean with a
resolved-per-surface `layoutMode`:

```js
// 'contained' = viewport-locked shell, panel-local scrolling
// 'page'      = legacy document flow
const layoutMode = isWeb ? 'contained' : 'page';
```

Extension and desktop stay on `'page'` — byte-for-byte current behaviour —
until each is separately promoted after web is proven. **A web regression can
therefore never reach the Chrome Web Store**, which is the slowest surface to
roll back.

### Work order — worst overflow first, one panel per pull request

| PR | Change | Removes |
| --- | --- | --- |
| A1 | **Done.** Shell bound to `100dvh` via `.pl-shell-contained` when `layoutMode === 'contained'`, mirroring `.is-compact`; `ScratchWorkspace`'s `calc(100vh - Nrem)` guesses replaced with `min-h-0`. Released all 17 allowlist entries. | root unbounded height |
| A2 | `DualPaneWorkspace` — one `overflow-y: auto` on the prompt list and one on the preview | 1441px |
| A3 | **Done.** The Compose wrapper was a bare `pl-tab-panel` block, so `ComposerTab`'s `flex-1` had no bounded parent and `<main>` scrolled as one block. It now mirrors the Evaluate wrapper in contained mode; the library column, drop zone and preview each scroll on their own, with nothing clipped at 400, 768 or 1440. | 1113px |
| A4 | `LibraryWorkspace` / `LibraryPanel` — scroll the prompt list, pin the sidebar and toolbar | 1099px |
| A5 | `CreateEditorPane` — scroll the below-editor content region | 81px |
| A6 | `ScratchWorkspace` / `PadTab` — delete the five `calc(100vh - Nrem)` constants, replace with `min-h-0` flex chains | 60px |
| A7 | Delete the `pageScroll` prop and all 55 references once web has been green in production for one week | dual layout implementations |

**Invariant for every panel: exactly one `overflow-y: auto`, on the content
region, never on the shell.** More than one scroll owner per panel is the defect
being removed, not a style preference.

Each PR gets its own Vercel preview URL, shrinks the known-failure allowlist by
one entry, and is independently revertable. Never more than one panel in flight.

### The real risk in Phase A

The risk is **not** layout breakage — it is content that was previously
reachable by scrolling silently becoming unreachable. `CreateEditorPane` alone
has `WORKBENCH FLOW` and `ACTIVATION RUNWAY` blocks below the fold.

Mitigation, required before each panel PR: inventory everything currently below
the fold in that panel and record an explicit **keep / move / cut** decision per
block in this document. Nothing disappears by accident.

## Phase B — the interface overhaul

Starts only after Phase A has been green in production for one week.

- **B1 — collapse the nav to one level and one vocabulary.** Four destinations:
  `Write`, `Library`, `Evaluate`, `Scratch`. `Compose` and `Dual Pane` become
  pane-layout states of Write, not destinations, which removes the third nav
  level entirely. Left rail on desktop, bottom rail on mobile, per WEB-2.
  Shipped behind a flag with the current header retained until proven.
- **B2 — ultrawide (WEB-3).** Use reclaimed width for a persistent Library rail
  and inspector rather than stretching a centred column. Evaluated at 3840x1080.
- **B3 — visual pass** on the now-stable shell, reconciling with the landing
  page per `docs/uxui-bold-restructure-spec.md`.

B1 requires sign-off on the four-destination model before implementation.

## Rollback

| Surface | Rollback |
| --- | --- |
| Hosted web | Vercel instant rollback to the prior deployment |
| Extension | Unaffected during Phase A (`layoutMode: 'page'`) |
| Desktop | Unaffected during Phase A (`layoutMode: 'page'`) |
| Any single panel | `git revert` of that panel's PR; no other panel is touched |

## Local environment note

`prompt-lab-source/.nvmrc` pins Node 22 and `scripts/require-node.mjs` enforces
it. The workstation default is currently Node 25, so `npm run *` fails until the
shell is switched. Node 22 is available at `/opt/homebrew/opt/node@22/bin`.

## Open items

1. Sign-off on the Phase B four-destination navigation model.
2. Confirm who can promote and roll back Vercel production deployments.
3. ~~Re-measure Evaluate with seeded run history.~~ Done — Evaluate and Compare
   hold at every width with a seeded library, so they are the reference
   contained-layout implementation.
