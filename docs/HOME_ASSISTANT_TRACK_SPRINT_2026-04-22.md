# Home Assistant Track Sprint - 2026-04-22

## System Overview
The current Home Assistant track is a static planning and control-surface track inside `DaveHomeAssist.github.io/homelab-os/index.html`, not a live Home Assistant runtime. The usable seams already exist in the tabbed dashboard shell (`index.html:380-384`), proposed device roles (`index.html:672-723`), HA roadmap phases (`index.html:770-803`), and the IP/Tailscale maps (`index.html:958-1247`).

Track flow:

```text
[Inventory + roadmap + IP map]
  -> [#1 Mode Aware Hero Automations]
  -> [#2 Why Notification Layer]
  -> [#3 Suggest Not Act System]
  -> [#5 Alexa Announce Orchestrator]
  -> [#4 Household Governance View]
```

## Component Table
| Feature | Responsibility | Inputs | Outputs | Direct deps | Owner |
| --- | --- | --- | --- | --- | --- |
| `#1 Mode Aware Hero Automations` | Define household mode recipes and dry-run automation bundles | roadmap phases, device roles, IP/device inventory | mode definitions, dry-run exports, local mode state | none | workbook + `homelab-os` |
| `#2 Why Notification Layer` | Explain why a planned or simulated action exists | mode definitions from `#1`, blocker/role context | explanation feed, trust history, uncertainty markers | `#1` | workbook + `homelab-os` |
| `#3 Suggest Not Act System` | Recommend manual next steps without executing anything | dashboard state, mode state, why history | explainable suggestion cards, copy-ready actions | `#1`, `#2` | workbook + `homelab-os` |
| `#5 Alexa Announce Orchestrator` | Plan household announcements and exports | mode context, why guardrails, device/group inventory | announcement templates, dispatch exports, local schedule state | `#1`, `#2` | workbook + `homelab-os` |
| `#4 Household Governance View` | Map people, devices, dashboards, and approval scopes | device roles, IP map, announcement groups, mode/governance status | permission map, owner gaps, onboarding/offboarding exports | `#1`, `#2`, `#5` | workbook + `homelab-os` |

## Data Flow
```text
homelab-os inventory/roadmap/ip map
  -> #1 mode planner
  -> #2 explanation feed
  -> #3 suggestion engine
  -> #5 announcement planner
  -> #4 governance map

Each layer reads static page state and local browser storage.
Each layer emits UI state plus copy/export artifacts.
No layer is allowed to claim or perform live HA/Alexa execution.
```

## Interface Contracts
- Workbook prompt -> Codex execution: plain-text prompt in `feature-matrix-v2.xlsx`, verified against current repo seams before implementation.
- UI state contract: browser-only HTML/CSS/JS inside `homelab-os/index.html`, with local persistence via `localStorage`.
- Output contract: copy/export artifacts only, such as YAML snippets, routine specs, checklists, and explanation logs.
- Error contract: when live integrations are absent, the UI must show `planned`, `suggested`, `simulated`, or `blocked`, never `sent` or `applied`.

## Failure Modes
- If prompts imply live HA execution, the track becomes misleading because the repo is static.
- If dependencies stay implicit, later prompt order drifts and the track stops reading like one system.
- If suggestion/explanation state is not local-first, the track breaks on GitHub Pages.

## Operations
- Deploy target: static GitHub Pages dashboard in `homelab-os/index.html`.
- Verification target: repo seam scan plus XLSX XML readback.
- Update path: workbook rows first, repo implementation prompts second.

## Sprint
Objective: make the current Home Assistant track explicit in the workbook and remove the last Home Assistant structural drift.

Planned tasks:
- Normalize `#3 Suggest Not Act System` to the same prompt structure as the other Home Assistant rows.
- Encode the direct Home Assistant dependency chain in `Depends On`.
- Tighten Home Assistant `Notes` so each row states its place in the track.

Exit criteria:
- The workbook shows a readable Home Assistant sequence instead of an implied one.
- All Home Assistant rows use current static-repo framing.
- The track can be executed top-down without guessing order.

Execution status:
- `#3` prompt normalization: completed
- Home Assistant dependency pass: completed
- Home Assistant notes pass: completed

Executed workbook changes:
- Rewrote `#3 Suggest Not Act System` to the standard `Current seams / Feature goals / Guardrails / Acceptance` structure used by the rest of the Home Assistant track.
- Kept `#2 -> #1` and added `#3 -> #1, #2`, `#5 -> #1, #2`, and `#4 -> #1, #2, #5` in `Depends On`.
- Replaced the Home Assistant `Notes` cells with explicit track-role labels: foundation, trust, advisory, dispatch, and governance.

Verification:
- Re-read the XLSX XML after the edit and confirmed the five Home Assistant rows reflect the intended track order and dependency chain.
