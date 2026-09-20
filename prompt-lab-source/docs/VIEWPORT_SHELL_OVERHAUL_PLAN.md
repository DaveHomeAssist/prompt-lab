# Prompt Lab viewport shell overhaul — plan

## Status

- Status: `proposed`
- Created: `2026-09-20`
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

All measurements taken at 1440x768 against the shared React workbench, in the
**contained** (non-`pageScroll`) code path — that is, the better of the two
existing layouts.

| View | Document height | Viewport | Overflow |
| --- | --- | --- | --- |
| Dual Pane | 2209px | 768px | **1441px** |
| Compose | 1881px | 768px | **1113px** |
| Library | 1867px | 768px | **1099px** |
| Write | 849px | 768px | 81px |
| Scratch | 828px | 768px | 60px |
| Evaluate | 768px | 768px | 0px |

Evaluate measured clean, but with an **empty run history**. Re-measure it with
seeded runs before treating it as a correct reference implementation.

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

## Phase 0 — guardrails first, zero UI change

No UI file is touched in this phase.

| # | Change | File |
| --- | --- | --- |
| 0.1 | Add `schedule:` (every 6h) alongside `workflow_dispatch`; keep the existing concurrency group | `.github/workflows/production-free-account-smoke.yml` |
| 0.2 | Extend the production smoke to the **core loop**: load `/app/`, type a prompt, save it, assert it appears in Library, reload, assert it persisted | `prompt-lab-extension/e2e/production-free-account.spec.js` |
| 0.3 | New **layout invariant** spec: for every route x viewport, assert `documentElement.scrollHeight <= innerHeight + 1` | new `prompt-lab-extension/e2e/layout-invariant.spec.js` |
| 0.4 | Unit test asserting the web shell renders a bounded-height class | `prompt-lab-extension/src/tests/App.webShell.test.jsx` |

0.2 needs no provider calls — save and library are local-first — so it costs
nothing per run and cannot flake on model latency.

0.3 runs on every PR over the matrix `400 / 768 / 1180 / 1440 / 3840x1080`
(the last satisfies WEB-3's 32:9 requirement) across
`/ /library /composer /split /evaluate /compare /scratch`.

### Phase 0 exit criteria

The layout invariant spec must be **committed in a failing state**, with a
known-failure allowlist naming exactly the routes in the measured table above.
A test that passes before the bug is fixed proves nothing. The allowlist
shrinks by one route per Phase A pull request and must reach zero entries at
the end of Phase A.

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
| A1 | Shell: `height: 100dvh; overflow: hidden` when `layoutMode === 'contained'`, mirroring the proven `.is-compact` rule. Make `main` the single scroll owner as a fallback. | root unbounded height |
| A2 | `DualPaneWorkspace` — one `overflow-y: auto` on the prompt list and one on the preview | 1441px |
| A3 | `ComposerTab` — one scroll region on the block list | 1113px |
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
3. Re-measure Evaluate with seeded run history before using it as the reference
   contained-layout implementation.
