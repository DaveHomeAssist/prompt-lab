# Workspace annotations — 2026-10-17

Source: Dave's annotations of the hosted Library and Create screens and one
mobile screenshot on 2026-10-17 (the first table). The implementation details
and acceptance checks in the second table are **Codex proposals based on Dave's
annotations**, which Dave relayed as proposals. They are recommendations, not
approved requirements, and none of it was verified when recorded.

Ownership on 2026-10-17:

- **L1 to L8 (Library and shared header):** being built in the uncommitted
  `codex/library-workspace-controls` draft, whose own brief is not yet on `main`.
  That draft stores collection artwork as a local UI preference and represents
  folders as `/` separated paths. The L5 and L6 proposals below recommend
  exported collection artwork and stable folder IDs with parent references instead;
  reconcile before that draft merges.
- **C1 to C7 and M1 (Create):** planned in
  [`../ENHANCE_WORKSPACE_REDESIGN_BRIEF.md`](../ENHANCE_WORKSPACE_REDESIGN_BRIEF.md#create-annotations-2026-10-17).

## Annotations

| ID | Screen | Element | Annotation / requested change |
|---|---|---|---|
| L1 | Library | Left sidebar | Make it a collapsible drawer. |
| L2 | Library | Prompt inspector | Make the inspector resizable. |
| L3 | Shared header | Navigation | Unify workspace navigation. |
| L4 | Shared header | Theme control | Add themes with more diverse palettes. |
| L5 | Library | Prompts and collections | Allow an assigned icon or image. |
| L6 | Library | Collections | Provide a more structured folder system. |
| L7 | Library | Display controls | Add more view options. |
| L8 | Shared header | Version label | Investigate why the displayed version remains stuck. |
| C1 | Create | Results area | Remove unnecessary scrolling and nested scroll regions. |
| C2 | Create | Generation controls | Improve readability and explain what the controls do. |
| C3 | Create | Follow-up prompts | Make them easier to discover and reach. |
| C4 | Create | Run history | Make it easier to discover and reach. |
| C5 | Create | Candidate sidebar | Simplify the presentation, especially with only one candidate. |
| C6 | Create | Quick prompts | Make the section hideable; it dominates mobile space. |
| C7 | Create | Editing context | Clearly distinguish editing a saved prompt from creating a new one. |
| M1 | Mobile screenshot | Overall Create layout | Supporting evidence: Quick prompts, wrapped header, and action rows push the editor and results down. |

## Codex proposals based on Dave's annotations

Recommendations only. Each item still needs the decisions and approval named in
its owning brief before it becomes a requirement.

| ID | Item | Implementation details | Acceptance |
|---|---|---|---|
| **L1** | **Collapsible Library drawer** | Add a **Views & folders** toggle beside search. Desktop collapses the sidebar completely and gives the space to results. Mobile opens it over the workspace with a backdrop, Close button, Escape handling, and focus restoration. Remember the desktop preference; default closed on mobile. Closing it preserves the current filters. | Open, close, navigate, and reload without losing filters or making collections unreachable. |
| **L2** | **Resizable inspector** | Add a visible drag handle between results and inspector. Support pointer, touch, and keyboard adjustment; provide a reset-width action. Save the preferred width and clamp it against available space so results remain usable. At narrow widths, use a detail drawer instead of squeezing both panels. | Resize with mouse and keyboard, reload, and shrink the viewport. No clipped controls, overlapping cards, or horizontal page scroll. |
| **L3** | **Unified navigation** | Replace the separated Create/Scratch/Evaluate and Write/Library/Compose controls with one destination row: **Write, Library, Compose, Dual Pane, Evaluate, Scratch**. Keep History/Compare as local Evaluate controls. Use the same destinations in the mobile bottom rail. Preserve existing routes, shortcuts, and browser Back/Forward behavior. | Every destination has one clear active state. Navigation preserves drafts and works through clicks, keyboard shortcuts, direct links, and browser history. |
| **L4** | **Additional palettes** | Separate **palette** from **light/dark mode**. Start with Ember, Ocean, Forest, and Plum, each providing coordinated surface, text, border, accent, selection, and focus colors. Centralize tokens so dialogs, menus, editors, and inspectors follow the selected palette. Persist both choices; use light mode on a fresh installation. | Check all eight combinations, including muted text, selected controls, disabled states, and dialogs. Reload preserves the selection without a visible theme flash. |
| **L5** | **Prompt and collection artwork** | Add an artwork picker with built-in icons, local image upload, preview, replacement, and removal. Show artwork consistently in cards, rows, folders, and inspector headings. Validate image format and size; avoid external image requests. Store prompt artwork in prompt metadata. **Recommended:** include collection artwork in exported collection metadata so it travels with the library; keep layout preferences local. | Assign, replace, remove, save, reload, export, and import artwork. Invalid or oversized files produce a clear error without losing existing artwork. Failed saves retain the pending changes. |
| **L6** | **Structured folders** | Add parent-folder selection, expandable folder rows, breadcrumbs, and **Move to folder** controls. Selecting a parent includes its descendants, with that behavior stated visibly. Validate duplicate names and prevent moving a folder into itself or a descendant. Preserve existing flat collections during migration. Folder removal must explicitly distinguish keeping contents from deleting prompts. | Existing assignments survive migration. Nested create, move, rename, filtering, deletion, and import/export preserve prompts and folder relationships. |
| **L7** | **More Library views** | Offer **List, Compact, Cards, Gallery** in a labeled view selector. List emphasizes metadata; Compact maximizes density; Cards balances text and actions; Gallery emphasizes assigned artwork. Add comfortable/compact density where useful. Share filtering, selection, sorting, and actions across views. Persist the chosen presentation. | Switching views preserves search, sort, selected prompts, and inspector state. Long titles and missing artwork remain readable at mobile, desktop, and ultrawide sizes. |
| **L8** | **Version identification** | Implement the existing versioning contract: one canonical version, an allowlisted bump command, consistency checks across packages/manifests/Tauri/Cargo/UI, and a release-tag guard. Show the source revision in development builds, for example `1.8.0-dev (abc1234)`, and expose fuller build information in About. A numeric bump alone must not imply a published release. | Deliberately mismatched versions fail checks. Incorrect release tags fail before publication. The deployed UI identifies the revision actually built. |
| **C1** | **Unnecessary result scrolling** | Replace the vertical Results → Follow-ups → History stack with visible tabs in a bounded output workspace. Keep the result heading and primary actions outside the text scroller. Allow long source/output text to scroll inside its own panel; remove redundant surrounding scroll containers. Preserve the existing side-by-side layout option. | At short and tall viewports, tabs and actions remain reachable without scrolling through the generated prompt. No document overflow or competing scrollbars around the same content. |
| **C2** | **Unclear generation controls** | Group controls under **Refinement settings**, with plain labels and concise descriptions. Explain task type, destination, refinement mode, and alternatives. Keep the chosen settings visible in a short summary when collapsed. Separate **Refine prompt** from testing, saving, and draft management; move infrequent actions into a labeled menu. | A user can identify what will run, which settings affect it, and whether an action rewrites, tests, or saves. Disabled actions explain their requirements. |
| **C3** | **Buried follow-ups** | Add a persistent **Follow-ups** tab beside Results and History, with a count when suggestions exist. Put the source selector and **Suggest follow-ups** action at the top. Explain whether the source is the enhanced prompt or a saved run output. Give each suggestion explicit Copy, Open as new draft, and Add to Composer actions. | Follow-ups are reachable without scrolling past results. Generation, cancellation, failure, and empty states are visible. Opening a suggestion preserves its provenance and the parent prompt. |
| **C4** | **Buried run history** | Add a persistent **History** tab with the run count. Show newest runs first with status, time, provider/model, and refinement mode. Clearly indicate whether the list belongs to the current saved prompt or recent unsaved work. Provide a route to the full Evaluate workspace. Loading an earlier result must not silently overwrite the current draft. | History remains reachable with long outputs. Failed and cancelled attempts appear correctly. Switching prompts shows the correct scope and preserves current work. |
| **C5** | **Confusing single candidate** | When only one result exists, remove the candidate-selection rail and label the content **Refined prompt** or its actual transformation name. Keep Preview, Changes, Copy, and Save near the output. Show a candidate selector only when alternatives exist, with meaningful labels and concise differences. Consolidate duplicated actions. | One-result mode contains no redundant selector. Multiple-result mode supports keyboard selection and always copies/saves the selected result. |
| **C6** | **Hideable Quick prompts** | Combine Recent and Quick prompts into a collapsible **Prompt shortcuts** section with a count. Default it closed on mobile and remember the preference. When expanded, use a bounded list with readable titles and clearly labeled Copy/Load actions. Loading a shortcut should use the existing draft-preservation behavior. | Mobile opens with useful editor space. Collapsing shortcuts preserves content and focus; expanding them does not push essential actions off the page. |
| **C7** | **Editing versus new prompt** | Introduce a persistent context bar with explicit states: **New unsaved prompt** or **Editing saved prompt: [title]**. Show folder context, unsaved-change state, and the primary save behavior. Use **Save changes / Save new version** for existing prompts and **Save new prompt** for new drafts, matching actual storage semantics. Make **Start new prompt** a distinct action with recoverable draft handling. | Users can tell what Save will affect before clicking. Creating a new draft never changes the existing prompt's identity, and navigating away cannot silently discard edits. |
| **M1** | **Mobile layout evidence** | Apply the changes above as one mobile layout pass: compact branding and account controls, collapsed shortcuts/settings, bounded editor/output panels, visible result tabs, and the existing bottom navigation with safe-area spacing. Keep Refine prominent while grouping secondary actions. Test the on-screen keyboard and landscape separately. | Verify at 375×812 and the supplied screenshot's proportions, plus short landscape. No page overflow, obscured actions, inaccessible tabs, or controls hidden behind the keyboard/navigation. |

The main data-design choice is **L6**: use stable folder IDs with parent
references and migrate existing collection strings. That supports reliable
renaming and moving without treating a display name as a permanent identity.
L5's collection artwork can then attach to those same IDs.
