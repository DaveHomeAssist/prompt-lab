# Enhance workspace redesign — brief

## Status

- Status: `Slice 1 merged behind a flag on hosted web (PR #153); DEC-01 decided 2026-10-17 — the refinement workspace mockup is the slice 2 reference; Create annotations C1 to C7 and M1 planned 2026-10-17; D-ENH-5 to D-ENH-8 decided 2026-10-18 (B, A, A, B); slice 2A merged and verified on hosted web (PR #164; see Slice 2A delivery)`
- Created: `2026-10-15`
- Source revision checked: `8eceda5` (`origin/main`) for the original findings;
  `6942b8e` (`origin/main`, 2026-10-17) for the DEC-01 mockup comparison;
  `e0b4a3b` (`origin/main`, 2026-10-17) for the Create annotations
- Inputs: the Enhance UI review of 2026-10-15 and its desktop mockup
  ([`evidence/enhance-workspace-mockup-2026-10-15.webp`](evidence/enhance-workspace-mockup-2026-10-15.webp));
  the refinement workspace mockup of 2026-10-17
  ([`evidence/refinement-workspace-mockup-2026-10-17.webp`](evidence/refinement-workspace-mockup-2026-10-17.webp))
- Related: [PR #138](https://github.com/DaveHomeAssist/prompt-lab/pull/138)
  (Expanded defaults, merged 2026-10-17 as `4b3616f`), [`VIEWPORT_SHELL_OVERHAUL_PLAN.md`](VIEWPORT_SHELL_OVERHAUL_PLAN.md)
  (Phase B navigation), [`uxui-bold-restructure-spec.md`](uxui-bold-restructure-spec.md)
  (visual direction), [`LIBRARY_COMPATIBILITY_CONTRACT.md`](LIBRARY_COMPATIBILITY_CONTRACT.md)
- Governing rules: workspace WEB-1 (light and dark), WEB-2 (no page scroll), WEB-3 (ultrawide)

Dave accepted all four recommended answers on 2026-10-15, which authorises slice 1. Later slices and any release beyond the flag still need their own approval. On 2026-10-17 Dave chose DEC-01 A (D-013): the refinement workspace mockup becomes part of Create, as the reference for slice 2, not a separate workspace.

## Problem

Create already covers the whole refinement lifecycle — draft, refine, review,
edit, copy, save — with candidates, change views, assumptions, reversible
edits, streaming, cancel and acknowledged saving. The capability is sound; the
hierarchy is not. The user has to hunt across stacked regions and duplicate
controls to answer three questions: *what changed, what did the model assume,
and what will Save keep?*

Each finding below was checked against `8eceda5`.

| # | Finding | Evidence | State |
| --- | --- | --- | --- |
| P1-a | Source and result are stacked in one column, so reviewing output and revising the source means scrolling between regions | `CreateEditorPane.jsx:510` mounts the result region below the editor; `PostEnhanceResults` mounts at `:660` | Confirmed |
| P1-b | One wrapping row holds the mode select, Refine, Cancel, Run Cases, Save, New prompt, Capture and Reset Draft | `EditorActions.jsx:34-131` (`flex-wrap`) | Confirmed |
| P1-c | Save appears in three places: the editor row, the candidate toolbar, and the commit bar (plus Save as new and Pin golden) | `EditorActions.jsx:94`, `PostEnhanceResults.jsx:231`, `:400-402` | Confirmed |
| P1-d | One "mode" list mixes rewrite strategy (Balanced, Concise, Detailed), destination (Claude, ChatGPT) and task type (Image, Code) | `constants.js:44-80` | Confirmed |
| P2-a | Selecting a candidate changes what Save keeps, but nothing says so at the point of selection | `PostEnhanceResults.jsx:98-106`, `:200-222` | Confirmed |
| P2-b | Four overlapping ways to ask "what changed": the Changes / Improved / Side by side tabs, a Preview toggle, and the candidate toolbar's Preview and Diff | `PostEnhanceResults.jsx:228-229`, `:243-272` | Confirmed |
| P2-c | "Quality n/5" reads as a validated score but is a structural heuristic | `PostEnhanceResults.jsx:178` | Confirmed (PR #138 relabels it) |
| P2-d | Assumptions and reversible edits sit below the output and are easy to miss | `PostEnhanceResults.jsx:326-372` | Confirmed |
| P2-e | Streaming, error, save and run state appear in different places depending on state | `CreateEditorPane.jsx:448-500`, `:513-560`, `:634-660` | Likely — needs a browser pass to rank severity |

## Expected outcome

One obvious path: **Write → Refine → Review → Save**. At desktop widths the
source and the selected result are both visible and both editable, every
control has one home, and the Save button says exactly what it will save.

## Target flow

1. **Write.** The source pane holds the draft, word count and a one-line
   structure strip (Role, Task, Format, Constraints, Context) with lint
   suggestions behind a link.
2. **Refine.** A single control row above both panes: Strategy, Task,
   Destination, Provider, then the primary Refine button. While a request runs
   the button becomes a Streaming state with Cancel beside it. Once a result
   exists the button reads **Refine again**.
3. **Review.** The result pane header shows the candidate tabs (only the
   candidates that were generated), an Output / Changes switch, and an
   assumptions count. The count opens the assumptions and reversible edits in
   place. A full side-by-side comparison stays available from Changes.
4. **Save.** A footer bar holds the unsaved-edits state, Copy, and one primary
   button that reads **Save as new prompt** or **Save new version** and names
   the selected candidate. Save confirms with a receipt naming the version.

Below about 1100px the panes become a Source / Result switch (bottom rail on
mobile, per WEB-2). Switching never discards the draft or candidate edits.

## Smallest useful slice

### Slice 1 — layout and actions, no generation changes

- Two-pane Create layout at 1100px and above; Source / Result switch below it.
- Move secondary actions (Run Cases, New prompt, Capture, Reset Draft) into an
  overflow menu in the source pane header; keep shortcuts.
- One primary Save in the footer bar; remove the editor-row and candidate-toolbar
  Save buttons. Copy moves to the footer.
- Assumptions count in the result header, opening the existing assumptions and
  reversible-edits sections.
- Keep the current `MODES` list unchanged until the generation-option split
  lands (see D-ENH-1).
- Hosted web `/app/` first, behind a flag, current layout retained until
  accepted (see D-ENH-3).

### Later slices

- Slice 2 — Strategy / Task / Destination controls on top of PR #138's model, plus
  changed-condition markers and a candidate receipt from the refinement workspace
  mockup (DEC-01; see below). The Create annotations add C2: group them as
  **Refinement settings** with plain descriptions and a collapsed summary.
- Slice 2A — Prompt shortcuts and editing context (C6, C7). Independent of
  D-ENH-5 and D-ENH-6; see the Create annotations below.
- Slice 3 — compact candidate tabs replace the candidate rail; merge Preview
  and Diff into Output / Changes. The Create annotations extend it into a
  bounded output workspace with Result, Follow-ups and History tabs (C1, C3,
  C4) and a single-candidate mode with no selector (C5).
- Slice 4 — roll out to the extension side panel and desktop shells.

## Exclusions

- No navigation change. The mockup's Write / Library / Evaluate / Scratch rail is
  Phase B1 of the viewport plan, which still awaits sign-off (D-ENH-2).
- No change to prompt generation, provider calls, budgets or quotas.
- No storage schema change. Library records, version identities, candidate
  identities, Golden Responses and run history stay as they are.
- No new visual language in slices 1, 3 and 4. The Nocturne palette, ember
  accent and warm type carry over; the uxui-bold-restructure spec still governs
  the visual pass. D-ENH-5 B restyles the Create view in graphite; on
  2026-10-18 Dave held that restyle until the Library palette work (L4) lands,
  so it builds on those palette tokens rather than around them.
- No native iOS change.

## Rule, data, save and API effects

| Area | Effect |
| --- | --- |
| Storage and Library | None. Save paths reuse `quickSave` / `quickSaveAsNew`; the acknowledged-write behaviour from issue 016 is unchanged |
| Candidate identity | None. Selection keeps using `selectedCandidateId` |
| Run history | None |
| Provider and proxy APIs | None |
| Settings | One local flag for the new layout during rollout |
| Themes | Both light and dark must ship (WEB-1). The mockup only shows dark |

## Dependencies

- PR #138 merged on 2026-10-17 as `4b3616f`; its Task type and Intended
  destination controls (`GenerationControls.jsx`) are on `main`, so slice 2 is
  unblocked. Slice 1 never depended on it.
- Phase B1 navigation sign-off, only if the rail is brought into scope.
- The viewport guardrails from Phase 0 (`e2e/responsive-smoke.spec.js`) must
  stay green; the new layout is a contained two-pane variant, not an opt-out.

## Risks

- **Width pressure.** Two panes plus a sidebar at 1100–1280px leave about 420px
  per pane. The breakpoint may need to sit higher; measure before fixing it.
- **Extension side panel.** It is narrow by default and will use the switch
  layout almost always; the switch must be good, not a fallback.
- **Losing edits on candidate switch.** Candidate edits are already persisted per
  candidate; the new tabs must keep that and say so.
- **Duplicate controls creeping back.** The mockup itself repeats the provider
  picker, the unsaved indicator and the assumptions entry (see below).

## Mockup notes

The mockup is the visual reference for slice 1, with these corrections:

1. Provider appears twice (header and control row). Keep it in the control row only.
2. "Unsaved changes" (header) and "Unsaved edits" (footer) duplicate each other.
   Keep the footer state only.
3. Assumptions appear as a header link and a bottom bar. Keep the header count;
   the bar becomes its expanded state.
4. With a result present, the primary control should read **Refine again**.
5. It shows dark mode only and no theme toggle. A light equivalent is required.
6. The Write / Library / Evaluate / Scratch rail is out of scope for slice 1.

## Refinement workspace mockup (DEC-01)

A second, standalone mockup was reviewed on 2026-10-16 and restyled on
2026-10-17 (compared against `main` at `6942b8e`): a Draft / Refine / Review workspace running a local simulation only
([`evidence/refinement-workspace-mockup-2026-10-17.webp`](evidence/refinement-workspace-mockup-2026-10-17.webp)).
Dave chose DEC-01 **A** on 2026-10-17 (recorded as D-013 in
[`DECISIONS.md`](DECISIONS.md)): integrate it as a focused Create view, not a
separate workspace. It feeds the slices above instead of adding a navigation
destination.

| Mockup element | Create on `main` today | Where it lands |
| --- | --- | --- |
| Three columns: Draft, Refine conditions, Review | Two panes with a control row (slice 1, behind the flag) | Two panes stay; the conditions go in the control row (D-ENH-6 A) |
| Changed-condition markers: a Δ on edited source sections and on changed strategy, task, destination or guardrails, with a "Δ n changed" readout | None. A candidate gives no sign that the draft or options moved after it was generated | Slice 2 |
| Stale-candidate notice: "Draft or settings changed. Refine again before applying this snapshot." | None | Slice 2 |
| Candidate receipt: input revision, method, additions kept, model output untested | Result header shows the candidate and the assumptions count | Slice 2, as one line in the result header |
| Per-addition Keep switches | Assumptions and reversible edits already revert individual changes | No new mechanism; slice 3 may borrow the "+" addition styling |
| Pin baseline and compare | Pin golden response | No change; the golden response stays the comparison anchor |
| Run log with observations | Evaluate run history | Out of scope: DEC-01 covers Create only |
| Evaluate comparison bench with per-difference evidence; Scratch capture channels | Not present | Out of scope; each needs its own brief and decision |
| Graphite, smoked glass and electric cyan; squared panels; large run ID | Nocturne palette and ember accent | Adopted for the Create view (D-ENH-5 B), held until the Library palette work (L4) lands |

### Slice 2 acceptance (draft)

These criteria cover behaviour. Layout follows D-ENH-6 A (two panes with the
conditions in the control row); visual criteria come with the graphite restyle
(D-ENH-5 B) when it is scheduled.

Slice 2 is accepted when all of these hold on hosted web with the flag on:

1. After a candidate exists, changing the source text, strategy, task,
   destination or provider marks each changed control and section with a text
   label, not colour alone, and shows a stale notice on the result.
2. Reverting a change clears its mark; Refine again clears every mark and the
   notice.
3. The result header shows a one-line receipt naming the source revision and the
   generation options the selected candidate came from.
4. Marks and the notice are announced through the existing status region.
5. Save, Copy, candidate identities and Library records behave as on `main`;
   a stale candidate can still be saved, and the notice says it came from an
   earlier draft.
6. Slice 1 acceptance items 1, 2 and 8 still hold.

## Create annotations (2026-10-17)

Dave annotated the hosted Create screen and one mobile screenshot on
2026-10-17. The implementation details and acceptance checks that accompany
the annotations are Codex proposals based on them, not approved requirements.
Both, including the Library items owned by a separate draft, are in
[`evidence/workspace-annotations-2026-10-17.md`](evidence/workspace-annotations-2026-10-17.md).
The proposals inform each slice's acceptance once that slice is approved. Each
finding was checked against `e0b4a3b`.

| ID | Annotation | Evidence on `e0b4a3b` | State | Slice |
| --- | --- | --- | --- | --- |
| C1 | Unnecessary result scrolling and nested scroll regions | The results region is its own scroller (`CreateEditorPane.jsx:172-174`, `overflow-y-auto`) and stacks the result (`:672`), follow-ups (`:701`) and run history (`:772`), and the history list scrolls again inside it (`:780`, `max-h-56 overflow-y-auto`) | Confirmed | 3 |
| C2 | Generation controls hard to read; purpose unclear | `GenerationControls.jsx:13-39` shows Task type and Intended destination selects, with strategy, primary candidate and budget under a "Generation options" summary; one explanatory paragraph covers destination only (`:47`) | Confirmed | 2 |
| C3 | Follow-ups hard to discover | Follow-up suggestions render only below the result once a result exists and nothing is loading (`CreateEditorPane.jsx:701-713`) | Confirmed | 3 |
| C4 | Run history hard to discover | A collapsed "Run History" or "Recent Runs" panel sits at the bottom of the results stack (`CreateEditorPane.jsx:772-780`), and the result header has a second "Prompt history" list of the latest five (`PostEnhanceResults.jsx:226-227`) | Confirmed; two entry points | 3 |
| C5 | Candidate sidebar confusing with one candidate | The candidate rail renders whenever results exist, including a single candidate (`PostEnhanceResults.jsx:152-160`) | Confirmed | 3 |
| C6 | Quick prompts dominate mobile space | A Recent strip and a Quick strip render as wrapping chip rows above the editor whenever they have entries, with no collapse (`CreateEditorPane.jsx:288-338`) | Confirmed | 2A |
| C7 | Editing a saved prompt and creating a new one look alike | Save buttons already name their target in both layouts: "Save new version" or "Save as new prompt" before a result (`lib/promptLifecycle.js:7-9`, `EditorActions.jsx:77`) and in the result commit bar (`PostEnhanceResults.jsx:240-241`), apart from a bare Save in the stacked candidate toolbar (`:171`). What is missing is a persistent statement of what is being edited: the context row shows only a small "Editing" or "Draft" badge and a title (`CreateEditorPane.jsx:255-263`), with no unsaved-change state, and "New prompt" is one action among several (`EditorActions.jsx:87`) | Confirmed, narrowed: context and start-new, not Save labels | 2A |
| M1 | Mobile layout pushes the editor and results down | Supporting evidence for C1, C2 and C6 rather than a separate change | Evidence only | All |

Notes for implementers:

- **C1 and C4.** The History tab replaces both history entry points; keep a
  route to Evaluate for the full timeline.
- **C3.** Follow-ups already carry provenance (`FollowUpOrigin.jsx`,
  `lib/followUpProvenance.js`) and use, chain and save handlers. The tab moves
  them; it does not change their data.
- **C6 and C7.** These are layout and labelling changes. Loading a shortcut must
  keep using the existing draft-preservation path, and Save semantics must
  match storage: keep the labels from `getPrimarySaveLabel` (a saved prompt
  saves a new version, a new draft saves a new prompt) and give the stacked
  candidate toolbar's bare Save the same label.
- **M1.** Each slice's acceptance includes the M1 checks: 375×812, the
  screenshot's proportions and short landscape, with the on-screen keyboard
  tested separately.
- **Shared header.** Compact branding and account controls on mobile depend on
  the unified navigation in the Library draft (L3) and are not planned here.

## Acceptance

Slice 1 is accepted when all of these hold on hosted web with the flag on:

1. At 1440×900 the source and result panes are both usable without page scroll,
   and `scrollHeight <= clientHeight` holds for the document in both axes.
2. At 375×812, 400×800 and 768×1024 the Source / Result switch is shown, primary
   actions are reachable and no panels overlap; the same scroll check holds.
3. Exactly one primary Save control is visible, and its label names the target
   (new prompt or new version) and the selected candidate.
4. Source text and candidate edits survive switching panes, switching candidates
   and toggling Output / Changes.
5. The assumptions count is visible in the result header whenever assumptions
   exist, and each assumption can be reverted without leaving the result.
6. Streaming, Cancel, failure recovery with partial output, and acknowledged
   saving behave as they do on `main` (existing tests stay green).
7. Existing Library records, candidate identities and run history load unchanged.
8. Both themes pass, keyboard focus is visible, tabs are keyboard-operable,
   status changes are announced, and touch targets are at least 44px.

## Slice 1 delivery

### Create graphite visual increment — scoped 2026-10-18

D-014's Create-only graphite choice and the later hold until L4 were checked
against the original human messages. The dependency is delivered in PR170/171,
with final records at `93bd3b0`. The Library owner finished its turn, released
its checkout claim and retained no pending edits. Existing Create ownership
continues in the delivery chat; shared theme and Library files remain excluded.

This increment changes only the flagged hosted two-pane Create presentation:
neutral graphite working surfaces, squared panels, fine dividing lines,
monospace section labels and clear focus/selection states. Light mode uses cool
light surfaces. Action, selection and focus accents consume L4's existing palette
tokens: Ember, Ocean, Forest and Plum remain user choices, with Ocean supplying
the mockup's cyan. It does not select a palette or change persistence/defaults.

Owned implementation: `CreateEditorPane.jsx` and a dedicated
`CreateGraphite.css`, plus focused visual tests and these existing records.
No shared `index.css`, theme provider, navigation, Library, storage, generation,
native-package or billing changes. The existing flag stays off by default;
stacked/extension/desktop presentation and all Slice 2/3 behavior are unchanged.

Acceptance delta: inspect all eight palette/mode combinations on desktop and
mobile, plus tablet, short landscape and ultrawide layouts; confirm no document
overflow, preserved 44px targets, legible controls and visible keyboard focus.
Check empty/source/result/error surfaces, contrast, selected-palette reload and
flag-off styling isolation. Reuse completed editing/save/recovery/native proof;
new live verification covers only this visual change. Physical-device and human
acceptance remain separate.

Focused verification (Dominic, Node 22): both Chromium scenarios passed in
1.4 minutes. The matrix covers all four palettes in both modes at 1440×900 and
375×812, plus 768×1024, 812×375 and 3200×900. Source/result/empty/error contrast,
44px targets, keyboard focus, reload and flag-off isolation passed; desktop and
phone screenshots were inspected. All 13 existing Create component tests and
the extension build passed. The first matrix failed on muted-label contrast
and mobile overflow from an absolutely positioned hidden title label. Scoped
muted text and a positioned Create root fixed those findings; the failed log is
retained. Existing production editing/save/recovery and native proof is reused.

[PR176](https://github.com/DaveHomeAssist/prompt-lab/pull/176) merged as
`dd190d957fe782a6e3f85f04b36868beb65daaa5` from `2bd5d0b` after all 16 checks
passed. Candidate and merge trees match. The normal CI passed 1195 shared tests,
223 legacy tests, 13 evaluator tests, 25 landing browser checks and 31 hosted
browser checks (one existing skip), including the graphite matrix. Automatic
MSI, NSIS, DEB and AppImage acceptance and macOS universal packaging passed.

Production deployment `dpl_JB7hwmP1k7CeGNu3uc2LJPNMwsRv` is READY on that
exact merge with `promptlab.tools` assigned. A bounded signed-in visual check at
1280×720 confirmed the `dd190d9` source label and the graphite split presentation
in both modes with Ember selected. All 15 personal prompts remained present and
the current saved draft stayed clean. The existing preview flag and light mode
were restored to their original values; no prompt, generation or save action
was performed. The temporary browser tab and initial Dominic container were
closed; the later diagnostic allocation is tracked separately below.

[Post-merge Landing39187555977](https://github.com/DaveHomeAssist/prompt-lab/actions/runs/39187555977)
exposed a timing error in the new visual test: the Retry button's text switched
to dark-mode ink while its existing 180ms background transition was still
running. The failed background `#c75531` was reproduced exactly in the transition
frames; settled `#fb7a55` passes. The test now awaits finite Create animations and
the requested theme before measuring, retaining the contrast assertion and all
other checks. No production styles or shared theme behavior changed for this
test correction. The original failed run is retained.

The exact-main Desktop39187555972 failed separately in NSIS acceptance:
the harness centered Clear all at (432,386), underneath the sticky Library
toolbar. The retained screenshot and driver error show the interception;
save, restart, follow-up persistence, cancellation and provider-error checks
had already passed. NSIS artifact SHA256
`F4C320B19FDD9420650119950E4E7AA7F7F9922515B87A52D47B9945448C7F65`
is unsigned, as recorded by the workflow; this was not an installation failure.
Current-main Desktop39194245537 repeats the same toolbar interception on MSI,
this time while clicking Starter Libraries at (237,386).

The 2026-10-19 continuation reconciled current main `dbf8d90`, preserving the
other owners' PR177/178 releases. The native harness now reveals the nearest
missing portion and requires a stable, unobscured target before its real
WebDriver click. Native options retain their driver-owned popup handling.
No retention assertion or product source changed.

[PR180](https://github.com/DaveHomeAssist/prompt-lab/pull/180) merged normally as
`df5da95fa2523e552f3cb00843f0bc898a6cbca5` from `b14015b` after all 15 returned
checks passed. Candidate, tested PR merge `87a6f40`, and delivered main share
source tree `eec9239f17dfbaf65e2d9cccc66dd14b496f0f56`.
[Landing39202363590](https://github.com/DaveHomeAssist/prompt-lab/actions/runs/39202363590)
passed 1222 tests, 25 landing browser checks and 31 hosted checks with one
existing skip. [Desktop39202363597](https://github.com/DaveHomeAssist/prompt-lab/actions/runs/39202363597)
passed all six jobs, including actual MSI, NSIS, DEB and AppImage exercise and
retention plus macOS universal packaging. Both previously failing Windows
paths pass; the exact package hashes and exercise/retention artifacts were
inspected and the failed receipts remain retained.

Production `dpl_H6pRUouN4TagVbE4qTiReegVkThR` is READY on exact `df5da95`
with `promptlab.tools` assigned; its homepage returned HTTP 200. Automatic
exact-main workflows all passed, including Landing39203966650 and all six jobs
of Desktop39203966636.
The prior signed-in visual proof applies to unchanged application source;
no extra paid-provider or personal-data exercise was performed.

Dominic remains unreachable through both documented routes; the interrupted
prior-run result and old diagnostic container/claim cleanup remain unverified.
No duplicate allocation, service change or heavy local fallback was started.
The existing Notion UX/RUN/Hub records retain the full parent acceptance gaps;
all 46 backlog rows and 14 approved plan IDs are preserved.

Full parent UX,
human/physical-device/macOS interaction and future tagged-release acceptance
remain separate; the private Next Steps Board has no PromptLab registry mapping.

### Hosted acceptance evidence — 2026-10-18

The eight hosted criteria above have passing automated evidence on production
`1f60dcc` with the split flag enabled. [PR #169](https://github.com/DaveHomeAssist/prompt-lab/pull/169)
merged as `081b9b5`; [PR #172](https://github.com/DaveHomeAssist/prompt-lab/pull/172)
merged as `1f60dcc`. They establish a 44px minimum for Create buttons, fields,
disclosures and choice labels. Production deployment
`dpl_xBKECQ9ULXrGQszmeqPNqbWMEDo8` is READY at that revision.

[Production acceptance 39179972239](https://github.com/DaveHomeAssist/prompt-lab/actions/runs/39179972239)
passed both scenarios in 12 seconds at test revision `9d5509f`.
It uses synthetic candidates and intercepted provider responses; actual UI
editing, persistence, AbortSignal cancellation and Save acknowledgements are
exercised. Both disposable sign-in sessions were revoked and read back.

| Criterion | Passing evidence |
| --- | --- |
| 1. Desktop layout | 1440×900, both panes usable, no overlap or document overflow in either theme. |
| 2. Narrow layouts | 375×812, 400×800 and 768×1024, Source/Result switching, reachable Save/Refine and no document overflow. |
| 3. Save target | Exactly one primary Save; new prompt/version and candidate labels; stable prompt ID and version increment after acknowledgement. |
| 4. Edit retention | Source and both candidate edits survive pane/candidate/tab changes and reload; persisted content and candidate IDs match. |
| 5. Assumptions | Count, keyboard focus into review, individual reversal and retained source verified. |
| 6. Recovery | Visible streaming chunk, real Cancel abort, preserved source, partial failure, synthetic successful retry and Save pass. Broader CI recovery remains with the Library owner. |
| 7. Existing records | Prompt and candidate identity/version checks pass. Scheduled run39178875628's passing 375/1440 activation scenarios supply current Library history/comparison/reload/reuse evidence; its separate Library restart failure is retained below. |
| 8. Accessibility | Both themes, visible keyboard focus, candidate/tab keyboard interaction, live status semantics and all 16 expanded-control target scans pass at a 44px minimum. |

Dominic's local browser matrix also passed both scenarios, including all four
sizes and both themes. Phone and desktop screenshots were inspected. No paid
provider calls, billing changes, new workflow or new schedule were introduced.
The existing production workflow has an explicit `create-workspace` scope.

Failed attempts remain part of the evidence: run39178130735 exposed the small
targets and test selector issues. Run39179095194 attempt1 stopped before Create
at the active-session guard after scheduled run39178875628's Library restart
timeout. A single retry after the previous session's expiry passed recovery and
the layout/edit checks but timed out selecting a candidate after reload.
[PR #173](https://github.com/DaveHomeAssist/prompt-lab/pull/173) waits for the
signed-in workspace and visible result before selecting the candidate. The
passing run logged zero mounted workspaces before that readiness wait,
confirming the remount race without weakening the persistence assertions.

This closes the bounded hosted checklist, not the full Enhance parent issue.
At this snapshot, main1f60dcc's Desktop39178986364 and Landing39178986318 are
failed; [Library PR #171](https://github.com/DaveHomeAssist/prompt-lab/pull/171)
owns their fixture/version corrections and remaining native packaging checks.
Physical touch, screen-reader listening, macOS interaction and full parent UX
acceptance remain separate. L4's palette implementation is merged, but this
acceptance closeout does not start graphite or later feature slices.

Built in [PR #153](https://github.com/DaveHomeAssist/prompt-lab/pull/153), off by default.

- **Turning it on:** Settings → "Two-pane Create workspace" on hosted web. The choice is stored locally as `pl2-create-layout` (`stacked` or `split`). Extension and desktop do not offer it.
- **Breakpoint:** a container query on the Create pane at 60rem (960px), not a viewport media query, so the layout responds to the space Create actually has. At a 1100px viewport each pane is about 526px; at 1440px about 696px.
- **Narrow widths:** the Source / Result switch shows below the breakpoint. A refine run moves it to Result. Both panes stay mounted.
- **Actions:** Run Cases, New prompt, Capture Page and Reset Draft sit under More, which opens upward because the action row is at the foot of the source pane. The editor-row Save shows only until a result exists; after that the commit bar holds the single primary Save (for example "Save as new prompt · Tighter") and Copy.

Browser checks on 2026-10-15 used a local hosted-web dev server with the deterministic provider fixture, so a real Refine ran with no network or quota:

| Viewport | Layout | Page scroll | Notes |
| --- | --- | --- | --- |
| 1440×900 | Two panes | None | One visible Save; label follows the selected candidate; assumptions button moves focus to the assumptions heading |
| 1100×800 | Two panes | None | Result pane is tight with the candidate rail; slice 3's compact tabs will help |
| 768×1024 | Switch | None | Switch buttons are 44px; Save reachable on Result |
| 400×800 | Switch | None | Main region scrolls inside the shell; only the candidate rail scrolls sideways, as before |
| 375×812 | Switch | None | — |

Light and dark themes both checked at 1440×900. Turning the flag off restores the stacked layout unchanged.

## Slice 2A delivery

Release review scope (2026-10-18): preserve the approved C6/C7 implementation and Library ownership. Correct the context bar false-clean state after an alternate candidate is edited and the unchanged primary is reselected. Compare the complete persisted prompt snapshot, including result metadata, variants and notes; verify the state is dirty before Save and clean after the same content is saved. Resolve only the naming-history merge conflict while preserving the shared naming rules. The existing signed-in activation check now covers saved/unsaved context, remembered shortcut expansion and both hosted layouts at 375×812 and 1440×900. Dominic Node 22.23.3 passed 36 focused tests (20 slice 2A and 16 persistence) and the extension build/assembly. The first scratch run lacked the sibling docs/schema and shared module files; these transfer omissions were corrected before the passing checks. Production verification passed after the test-only session-save timing correction described below.

Built for hosted web in both layouts, as D-ENH-8 B set. Extension and desktop
keep the previous context row and chip strips.

- **Prompt shortcuts (C6).** `PromptShortcuts.jsx` folds the Recent and Quick
  rows into one "Prompt shortcuts (n)" section; the count is unique prompts.
  Phones and windows up to 800px tall (767px wide or 800px tall and smaller)
  start closed and larger screens open; a toggle is remembered as
  `pl2-prompt-shortcuts`, kept in its own module
  (`lib/promptShortcutsPreference.js`) rather than `useUiState`. When open, a
  bounded set of chips gives each prompt a readable title and labelled Load
  and, for Quick prompts, Copy actions, with 44px targets on touch screens.
  On windows up to 800px tall the open shortcuts sit in one horizontally
  scrolling row beside the toggle, so opening them never makes the page scroll.
  Load goes through the existing `loadEntry` path, so draft preservation is
  unchanged.
- **Editing context bar (C7).** `CreateContextBar.jsx` is always shown in
  Create and reads "New unsaved prompt" or "Editing saved prompt:" with the
  title, folder, save state (Empty draft, Not saved yet, No unsaved changes or
  Unsaved changes, announced politely) and what Save does. Title, folder and
  tags edited in Library details count as unsaved and show their pending values,
  because Save writes them even after the panel closes. Start new prompt
  uses the existing draft reset, which moves current work to session recovery.
  On phones the save-behaviour text and the Library links are hidden so the bar
  stays two short rows; the Save buttons still name their target.
- **Save label.** In the stacked layout the candidate toolbar's bare Save now
  reads "Save new version" or "Save as new prompt", matching the commit bar.

Verification on 2026-10-18 on Dominic (Node 22 container): the full extension
suite passes (1186 Vitest and 223 legacy tests), including 17 new tests in
`src/tests/CreateSlice2A.test.jsx`. A hosted-web browser pass (local Vite dev
server, seeded Library, Playwright Chromium) covered 1440×900, 1280×720,
375×812 and 812×375 in both layouts:

- No page overflow in any case, including after loading a prompt and with
  shortcuts opened on a phone or a 1280×720 laptop.
- Shortcuts start open on desktop and closed on phones, laptops up to 800px
  tall and short landscape; the choice survives a reload.
- Loading a prompt switches the bar to "Editing saved prompt" with its folder;
  an edit shows Unsaved changes; Start new prompt opens the existing recovery
  dialog.
- axe finds no WCAG A or AA violations in the new regions.

Against `main`, the editor sits 159px higher on a 375×812 phone, 35px higher in
812×375 landscape and 22px higher on a 1280×720 laptop with a prompt loaded. On
a 1440×900 desktop it sits 60px lower with shortcuts open and 22px higher with
them closed. This local browser pass did not cover the signed-in production app or real touch devices; the later production evidence below supersedes only the signed-in gap.

### Release verification — 2026-10-18

[PR #164](https://github.com/DaveHomeAssist/prompt-lab/pull/164) merged as `15a421b`.
All 15 checks passed at integration `5810fa5`; the required base update changed
only naming instructions. All seven automatic workflows on `15a421b` passed,
including [Desktop 39175748450](https://github.com/DaveHomeAssist/prompt-lab/actions/runs/39175748450)
with MSI, NSIS, DEB and AppImage acceptance and macOS universal packaging.
Shared verification passed 1189 Vitest, 223 legacy and 13 evaluator tests.

The first [production check](https://github.com/DaveHomeAssist/prompt-lab/actions/runs/39175809303)
passed Library Save, context, refinement and history, then reloaded before the
existing 500 ms editor-session write. [PR #167](https://github.com/DaveHomeAssist/prompt-lab/pull/167),
merged as `a39faad`, waits for the persisted editor content and prompt ID.
The [corrected production check](https://github.com/DaveHomeAssist/prompt-lab/actions/runs/39176037165)
passed at 375×812 and 1440×900 in both hosted layouts: saved/unsaved context,
remembered shortcut expansion, synthetic refinement, save, history, reload and
reuse. Both disposable sessions were revoked; no real model calls were made.
Its test commit `2c15e82` and merge `a39faad` have the same source tree.
Production deployment `dpl_47d2AUH46HjnVVJMDXrogs8cX4SN` is READY at `a39faad`;
application source matches the tested `15a421b` deployment.

Physical touch, macOS interaction and full parent UX acceptance remain open.
Next accepted verification is the remaining hosted Slice 1 Acceptance checklist
under D-012. Library L1–L8 stays with its owner; graphite remains held until L4.
Later slice proposals are not additional implementation approval.

## Decisions

D-ENH-1 to D-ENH-4 were resolved on 2026-10-15: Dave chose the recommended option for each. They are also recorded as D-012 in [`DECISIONS.md`](DECISIONS.md). DEC-01 (D-013) was resolved on 2026-10-17. D-ENH-5 to D-ENH-8 were resolved on 2026-10-18 (D-014, D-015): Dave chose B, A, A and B, and held the graphite restyle until the Library palette work (L4) lands.

| ID | Question | Options | Decided | Unlocks |
| --- | --- | --- | --- | --- |
| D-ENH-1 | How does this relate to PR #138? | A. Rebase and land #138 first, then build slice 2 on it · B. Build slice 1 now on current `MODES`, slice 2 after #138 · C. Fold #138 into this redesign branch | **B** — slice 1 needs nothing from #138, and keeping them apart keeps both reviewable | Starting slice 1 |
| D-ENH-2 | Does the redesign include the left navigation rail? | A. No; Create only, nav stays for Phase B1 · B. Approve the B1 four-destination rail now and include it · C. Rename Create to Write only | **A** — B1 has its own sign-off and rollback; bundling it doubles the blast radius | Slice 1 scope |
| D-ENH-3 | How does it roll out? | A. Hosted web behind a flag, then extension and desktop · B. Replace the layout everywhere at once | **A** — matches the Phase A pattern and keeps Vercel instant rollback | Slice 1 delivery plan |
| D-ENH-4 | What happens to the 0–5 quality number? | A. Keep it, labelled "Structure checks · heuristic" · B. Drop the number and show only the five checks | **A** — honest label, keeps the at-a-glance signal; PR #138 already moves this way | Slice 3 copy |
| D-ENH-5 | What visual identity does slice 2 use? | A. Keep the current palette; take structure and behaviour from the mockup, and route the graphite direction to the uxui-bold-restructure visual pass as a proposal · B. Restyle the Create view alone in graphite now · C. Open an app-wide graphite visual pass before slice 2 | **B** (Dave, 2026-10-18). Recommended was A because B leaves Create visually unlike Library, Evaluate and Scratch. The restyle is held until the Library palette work (L4) lands | Slice 2 visual spec |
| D-ENH-6 | Does slice 2 keep two panes? | A. Yes; the conditions live in the control row above both panes · B. Add a third conditions column at 1440px and up | **A** (Dave, 2026-10-18): matches slice 1 as shipped and avoids the width pressure noted under Risks | Slice 2 layout |
| D-ENH-7 | Which Create annotation slice comes first? | A. Slice 2A (prompt shortcuts and editing context, C6 and C7) · B. Slice 3 (output tabs and single-candidate mode, C1 and C3 to C5) · C. Slice 2 (refinement settings, C2), after D-ENH-5 and D-ENH-6 | **A** (Dave, 2026-10-18): smallest, independent of the visual and layout choices, and the largest mobile gain in M1 | Start of Create annotation work |
| D-ENH-8 | Where do C6 and C7 ship? | A. Only inside the two-pane flag · B. Hosted web in both the stacked and two-pane layouts · C. Every shell at once | **B** (Dave, 2026-10-18): the two-pane flag is off by default and works at every width (narrow screens get its Source / Result switch), so A reaches only users who turn the flag on, while B also reaches the default stacked layout; C skips the flagged hosted-web stage that D-ENH-3 set | Slice 2A rollout |
