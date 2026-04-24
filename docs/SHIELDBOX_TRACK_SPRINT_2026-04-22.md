# ShieldBox Track Sprint - 2026-04-22

## System Overview
The current ShieldBox track is a static quote-to-brief operating model inside `shieldbox-security/quote.html` and `event-quote-request.html`, not a live staffing or dispatch backend. The track already has usable seams in the existing playbook config layer (`quote.html:708-781`), schedule-to-brief builder (`quote.html:1111-1274`), preview handoff flow (`quote.html:1276-1320`, `event-quote-request.html:3136-3287`), and local restore state (`quote.html:1700-1788`).

Track flow:

```text
[#11 One Click Event Playbooks]
  -> [#12 Coverage Timeline Builder]
  -> [#14 Saved Drafts + Requote + Share]

[#11 One Click Event Playbooks]
  -> [#13 Live Ops Brief Preview]
  -> [#14 Saved Drafts + Requote + Share]

[#11 + #12 + #13]
  -> [#15 Urgent Dispatch Mode]
```

## Component Table
| Feature | Responsibility | Inputs | Outputs | Direct deps | Owner |
| --- | --- | --- | --- | --- | --- |
| `#11 One Click Event Playbooks` | Turn existing preset logic into the visible quote-entry layer | `playbookConfigs`, schedule defaults, scope defaults, billing defaults | applied event presets, override state, normalized intake defaults | none | workbook + `quote.html` |
| `#12 Coverage Timeline Builder` | Expand schedule checkboxes into a richer multi-phase planner | selected playbook, checked schedule rows, event date/duration | timeline rows for quote desk and brief preview | `#11` | workbook + `quote.html` + `event-quote-request.html` |
| `#13 Live Ops Brief Preview` | Turn current preview into a trustworthy ops handoff surface | live `briefData`, reference id, current intake state | scanable ops brief, print/share-ready preview, fallback-safe preview open | `#11` | workbook + `quote.html` + `event-quote-request.html` |
| `#14 Saved Drafts + Requote + Share` | Add repeatable quote lifecycle over the current preview/intake system | local client state, reference handling, playbook/timeline/brief state | multi-draft store, requote clones, read-only brief shares | `#11`, `#12`, `#13` | workbook + `quote.html` + `event-quote-request.html` |
| `#15 Urgent Dispatch Mode` | Add a compressed short-notice lane on top of the same quote/brief system | playbook presets, timeline data, risk snapshot, preview state | urgent intake lane, blocker/status surface, dispatch-style brief | `#11`, `#12`, `#13` | workbook + static ShieldBox surface |

## Data Flow
```text
playbookConfigs + current quote intake
  -> #11 visible preset layer
  -> #12 richer timeline rows
  -> #13 ops brief preview
  -> #14 saved drafts / requote / read-only share

playbookConfigs + timeline + ops preview
  -> #15 urgent dispatch mode

All state remains browser-local and static-site compatible.
No step may imply confirmed staffing, live dispatch, or real crew availability.
```

## Interface Contracts
- Quote desk contract: `quote.html` remains the single source of truth for live intake state.
- Brief contract: `buildBriefData()` and `sessionStorage` stay the canonical bridge into `event-quote-request.html`.
- Persistence contract: local-first storage only; versioned migrations required when replacing the current single saved payload.
- Status contract: UI must distinguish `draft`, `submitted`, `shared`, `preview`, `urgent request received`, and `crew confirmed`.

## Failure Modes
- If a feature forks a second source of truth away from `briefData`, the quote desk and preview drift.
- If drafts replace the current restore path without migration, saved local user state is lost.
- If urgent mode suggests confirmed staffing in a static mockup, the product overclaims operations the repo does not implement.

## Operations
- Deploy target: static HTML surfaces in `shieldbox-security/quote.html` and `event-quote-request.html`.
- Verification target: repo seam scan plus XLSX XML readback.
- Update path: workbook track first, repo implementation prompts second.

## Sprint
Objective: finish the ShieldBox track as a coherent prompt sequence rather than five isolated rows.

Planned tasks:
- Normalize `#14 Saved Drafts + Requote + Share` to the standard prompt structure.
- Encode direct ShieldBox dependencies in `Depends On`.
- Rewrite ShieldBox `Notes` so each row states its role in the track.

Exit criteria:
- The ShieldBox rows read as one quote-to-brief system.
- Dependencies are explicit enough to execute the track in order.
- Every ShieldBox row uses current static-repo framing.

Execution status:
- `#14` prompt normalization: completed
- ShieldBox dependency pass: completed
- ShieldBox notes pass: completed

Executed workbook changes:
- Rewrote `#14 Saved Drafts + Requote + Share` to the standard `Current seams / Feature goals / Guardrails / Acceptance` structure.
- Added `#12 -> #11`, `#13 -> #11`, `#14 -> #11, #12, #13`, and `#15 -> #11, #12, #13` in `Depends On`.
- Replaced ShieldBox `Notes` cells with explicit track-role labels: foundation, schedule, handoff, retention, and urgent lane.

Verification:
- Re-read the XLSX XML after the edit and confirmed all five ShieldBox rows are structured and the dependency graph is encoded in-sheet.
