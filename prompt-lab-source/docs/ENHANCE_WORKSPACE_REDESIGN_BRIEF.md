# Enhance workspace redesign — brief

## Status

- Status: `Proposed — brief only, not approved for implementation`
- Created: `2026-10-15`
- Source revision checked: `8eceda5` (`origin/main`)
- Inputs: the Enhance UI review of 2026-10-15 and its desktop mockup
  ([`evidence/enhance-workspace-mockup-2026-10-15.webp`](evidence/enhance-workspace-mockup-2026-10-15.webp))
- Related: [PR #138](https://github.com/DaveHomeAssist/prompt-lab/pull/138)
  (Expanded defaults, draft), [`VIEWPORT_SHELL_OVERHAUL_PLAN.md`](VIEWPORT_SHELL_OVERHAUL_PLAN.md)
  (Phase B navigation), [`uxui-bold-restructure-spec.md`](uxui-bold-restructure-spec.md)
  (visual direction), [`LIBRARY_COMPATIBILITY_CONTRACT.md`](LIBRARY_COMPATIBILITY_CONTRACT.md)
- Governing rules: workspace WEB-1 (light and dark), WEB-2 (no page scroll), WEB-3 (ultrawide)

Approving this brief approves the plan, not an implementation or a release.

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

- Slice 2 — Strategy / Task / Destination controls on top of PR #138's model.
- Slice 3 — compact candidate tabs replace the candidate rail; merge Preview
  and Diff into Output / Changes.
- Slice 4 — roll out to the extension side panel and desktop shells.

## Exclusions

- No navigation change. The mockup's Write / Library / Evaluate / Scratch rail is
  Phase B1 of the viewport plan, which still awaits sign-off (D-ENH-2).
- No change to prompt generation, provider calls, budgets or quotas.
- No storage schema change. Library records, version identities, candidate
  identities, Golden Responses and run history stay as they are.
- No new visual language. The Nocturne palette, ember accent and warm type
  carry over; the uxui-bold-restructure spec still governs the visual pass.
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

- PR #138 is a draft with merge conflicts against `main` and was last updated on
  2026-10-09. Slice 2 depends on it; slice 1 does not.
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

## Open decisions

| ID | Question | Options | Recommended | Unlocks |
| --- | --- | --- | --- | --- |
| D-ENH-1 | How does this relate to PR #138? | A. Rebase and land #138 first, then build slice 2 on it · B. Build slice 1 now on current `MODES`, slice 2 after #138 · C. Fold #138 into this redesign branch | **B** — slice 1 needs nothing from #138, and keeping them apart keeps both reviewable | Starting slice 1 |
| D-ENH-2 | Does the redesign include the left navigation rail? | A. No; Create only, nav stays for Phase B1 · B. Approve the B1 four-destination rail now and include it · C. Rename Create to Write only | **A** — B1 has its own sign-off and rollback; bundling it doubles the blast radius | Slice 1 scope |
| D-ENH-3 | How does it roll out? | A. Hosted web behind a flag, then extension and desktop · B. Replace the layout everywhere at once | **A** — matches the Phase A pattern and keeps Vercel instant rollback | Slice 1 delivery plan |
| D-ENH-4 | What happens to the 0–5 quality number? | A. Keep it, labelled "Structure checks · heuristic" · B. Drop the number and show only the five checks | **A** — honest label, keeps the at-a-glance signal; PR #138 already moves this way | Slice 3 copy |
