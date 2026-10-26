# October intake: Write, Scratch and Library requests

Date: 2026-10-26. Source: Dave's PromptLab Scratch intake list (undated items,
October 21, October 23 and later additions), triaged against `main` at
`5572cf3` and the issue snapshot of 2026-10-26.

Status: accepted 2026-10-26. Dave gave the go with every recommended option
(D-017). Each slice still ships through its own pull request, checks and
production verification. Issue Backlog rows track each slice.

## Triage

Ratings: **Accepted As Is**, **Keep and Change** (accepted with a stated change),
**Cautious** (needs a decision or spike before work), **Denied**.

| ID | Request | Rating | Disposition |
| --- | --- | --- | --- |
| T01 | Resizable left-hand panel | Accepted As Is | Scratch note index (fixed 240 px) becomes resizable in Slice 1; the Library folder drawer (fixed 12rem) follows in Slice 2. |
| T02 | Remove Write/Split/Preview; show formatting live with no exposed Markdown | Cautious | Needs a live-formatting editor in all three shells while notes stay Markdown. Decision D-INT-1, then a spike. |
| T03 | Expandable text area in Scratch | Keep and Change | Shipped 2026-10-25 as the fill-the-pane editor and Focus mode (PR205, PR209). Remaining: an Expand control on the new Write-side Scratch panel. Slice 1. |
| T04 | Compact Scratch list: one-line title, no metadata, grey date if it fits | Accepted As Is | Compact becomes the default; the current three-line rows stay as Detailed. Slice 1. |
| T05 | More icons; allow icon uploads | Keep and Change | Image upload already exists (PNG, JPEG or WebP up to 64 KB) but is hidden in a collapsed inspector section. Grow the 10 built-in choices from icons the app already bundles, add emoji, no new icon library. Slice 3. |
| T06 | Gallery view looks broken with no way to add a picture | Keep and Change | Upload exists but cannot be found from the gallery. Cards without artwork get a clear placeholder and an Add image action. Slice 3. |
| T07 | Clicking a prompt's icon in Library opens an icon or emoji picker | Accepted As Is | Popover picker on the card artwork in all four Library layouts. Slice 3. |
| T08 | See Scratch notes while in Write view | Accepted As Is | Highest priority. Write gets a Scratch panel beside the editor. Dual Pane disposition is decision D-INT-2. Slice 1. |
| T09 | Menu manifest, then reorganize, consolidate and restyle menus | Keep and Change | Split into a code-grounded manifest, then a reorganization proposal for approval, then the visual redesign. Only the first two are planned here. Slice 7. |
| T10 | Shortcuts to send or append bug reports and feature requests from the app | Keep and Change | Tracked and not started. No bug-report API route exists on `main`. Start with a local Feedback dialog that appends to a Scratch note; any sending destination is decision D-INT-3. Slice 4. |
| T11 | "Dual Pane / 200 credit" | Cautious | Read as two notes: Dual Pane (D-INT-2) and the open issue to verify the hosted API credit grant, which needs the provider console. Confirm the reading. |
| T12 | New Prompt keeps moving; unclear whether work continues on the same or a new prompt | Keep and Change | Placement shipped 2026-10-23 (PR199). A remaining defect makes new drafts borrow another prompt's title. Slice 0. |
| T13 | Give the active Scratch pad more of the screen | Accepted As Is | Shipped 2026-10-25 (PR205, PR209). No new work. |
| T14 | Status of naming upgrades | Accepted As Is | Shipped 2026-10-25 (PR212): custom titles preserved, local task-name suggestions, no AI naming calls. Further upgrades wait for a selection. |
| T15 | Generic prompt mode | Cautious | Tracked, but no code, doc or issue text defines it. Decision D-INT-4. |
| T16 | What is on the local branch | Accepted As Is | Answered in the triage report: the main checkout matches `origin/main`. No product work. |
| T17 | Feature request and bug reporting | Accepted As Is | Same request as T10. |
| T18 | Compact Scratch sidebar to one line | Accepted As Is | Same request as T04. |
| T19 | Automatic tab-organization browser extension | Denied | A separate product idea, outside Prompt Lab. |
| T20 | Desktop or browser notification when a prompt finishes | Keep and Change | Opt-in, only when the window is not focused and the run was long. Hosted web first plus a tab-title marker on every shell; extension and desktop need permission and plugin work later. Slice 5. |
| T21 | Version has not changed with recent updates | Keep and Change | Correct: shared source has been `1.8.0` since 2026-10-18 across 50 merged pull requests, and untagged builds only add `-dev (revision)`. Make each deployed build visibly distinct now; the release cut is decision D-INT-6. Slice 6. |
| T22 | Inspector panel could stretch wider | Keep and Change | Already drag-resizable since 2026-10-18 but capped at 640 px or 55 percent of the workspace. Raise the cap and make the handle visible. Slice 2. |
| T23 | Favorites and Recent in the sidebar from Write | Accepted As Is | The panel beside Write gets a Prompts view with All, Recent and Favorites. Slice 2. |

## Slice 0: New drafts borrow another prompt's title

Problem: for a new, unsaved draft, `useEvalRuns` loads runs without a prompt
filter, so `latestSuccessfulRun` in `App.jsx` can belong to a different prompt.
`suggestedSaveTitle` and the golden comparison then fall back to that run's
output. This is the likely cause of a 2026-10-26 observation: a "Rename the
chat" prompt was saved with the title "An image has been provided", which
matches the previous prompt's enhanced output. Reproduce before fixing.

Fix: the fallback uses only runs that belong to the current prompt. A saved
prompt uses runs tagged with its id. An unsaved draft uses only its own latest
successful run, recorded in `resultMeta.runId`, which New Prompt clears; saving
already links that run to the new entry. Custom titles keep the PR212 behavior.
No new stored field is needed.

Acceptance:

- A test mounts the real App with a successful run from another prompt and an
  empty new draft; the suggested title derives from the draft's own text and no
  golden verdict appears. It fails on `5572cf3` and passes with the fix.
- Enhancing a fresh draft after enhancing a different prompt produces a title
  from the fresh draft.
- Existing failed-run and title-preservation tests still pass.

Effects: no storage or API change.

## Slice 1: Scratch beside Write

Problem: Scratch is a separate destination, so notes cannot be read or edited
while writing a prompt. Dual Pane offers Library and Editor, not notes.

Outcome: while writing, the active note is visible and editable next to the
prompt, and the Scratch list is compact enough to scan at a glance.

Flow:

1. Write currently shows the editor alone (the Library sidebar is hidden in
   Create). A Scratch toggle in the editing context bar, or Cmd or Ctrl plus
   backslash, opens a Scratch panel beside the editor. Whether it is open, and
   its width, persist per installation.
2. The panel shows the compact note list and the active note in a plain
   editor with autosave, save status and a read-failure retry.
3. Note actions: Insert into prompt (at the cursor), Open in Scratch (opens the
   full Scratch destination in Focus, covering T03), and New note.
4. The panel and the Scratch note index use one shared resizer: pointer drag,
   arrow keys, Home and End, double-click to reset, width persisted and
   clamped (T01). The Library folder drawer adopts it in Slice 2, where the
   Library grid is already being changed.
5. Below the two-column breakpoint, Scratch opens as a slide-over drawer from a
   header button and a keyboard shortcut, so the editor keeps its full width.
6. The Scratch list defaults to compact rows: color dot, title, pin, and a grey
   relative date only when it fits. A Detailed option restores the current
   three-line rows (T04).

Smallest useful slice: steps 1 to 4 and 6 on desktop widths, with the drawer
in step 5 for narrower layouts. Formatting changes stay in the full Scratch
destination.

Exclusions: no rich-text editing (T02), no Scratch schema change, no change to
Dual Pane until D-INT-2 is answered.

Data and save effects: both surfaces use the existing Scratch persistence and
revision checks. Only one Scratch editor is mounted at a time; switching
reloads from storage so an edit made in one surface is never overwritten by
the other. New persisted UI keys: side-column mode, side-column width, Scratch
index width, Library drawer width, Scratch list density.

Risks: the contained-shell flex chain at short heights; focus order across the
new column; two autosave paths if both surfaces could mount together.

Acceptance:

- In Write at 1440 px, switching to Scratch shows the active note; typing
  autosaves, and the text is intact after reload and after visiting the full
  Scratch destination.
- Insert into prompt places the note text at the editor cursor.
- Each resizer works by pointer and keyboard, persists, resets on double-click
  and never causes horizontal page overflow at 320 px, 768 px, 1440 px and
  3840 px in both themes.
- At 768 px the drawer opens and closes by button, shortcut and Escape, and
  returns focus to the trigger.
- The compact list shows one line per note; Detailed shows the current rows.
- Quota and read-error handling for Scratch still pass their tests.

## Slice 2: Write sidebar views and a wider inspector

Problem: Favorites and Recent exist only in the full Library destination. The
inspector is resizable but stops at 640 px.

Change: the panel beside Write gains a Prompts view with All, Recent and
Favorites, using the Library's existing smart-view rules (T23). The Library
folder drawer becomes resizable with the shared resizer from Slice 1 (T01). The inspector cap rises to
960 px or 70 percent of the workspace, whichever is smaller, and the resize
handle shows on hover and focus (T22).

Acceptance: each view lists the same prompts as its Library counterpart; the
inspector reaches the new cap by pointer and keyboard without hiding the
results list below its minimum width.

Effects: one persisted key for the selected sidebar view. No schema change.

## Slice 3: Prompt artwork that can be found

Problem: the artwork picker exists only inside a collapsed inspector section,
so gallery cards look broken and icons cannot be changed from the list.

Change:

- Selecting a card's artwork in list, tiles, compact or gallery opens a popover
  picker with built-in icons, emoji and Choose image (T07).
- Built-in icon choices grow from the 10 current ones using icons the app
  already bundles, with no new dependency (T05).
- Gallery cards without artwork show a neutral placeholder and an Add image
  action that opens the same picker (T06).

Data effect: prompt artwork gains an optional `emoji` field holding one emoji.
Export and import carry it. Older builds ignore it and may drop it when they
re-save that prompt; release notes must say so.

Acceptance: the picker opens by click and keyboard, closes on Escape, and
returns focus to the card; chosen artwork survives reload, export and import;
image limits and error messages are unchanged.

## Slice 4: Feedback from inside the app

Problem: there is no in-app way to capture a bug or request, and the earlier
hosted bug-report route is no longer present.

Change: a Feedback dialog reached from the Help menu, the command palette and a
keyboard shortcut. It asks for type (bug or feature request) and text, and
attaches the version, build revision, shell, current view and, for bugs, the
most recent error message if one is shown. Slice 4 offers Append to feedback
note (a Scratch note created on first use) and Copy as Markdown. Any sending
destination follows D-INT-3.

Acceptance: an appended entry appears in the feedback note with a timestamp and
the attached context; the dialog works offline; nothing leaves the device.

## Slice 5: Finish notifications

Change: an opt-in Settings switch. When an enhance, run or test batch finishes
after more than 10 seconds while the window is not focused, the hosted web app
shows a system notification. Every shell also marks the tab or window title
until the result is viewed.

Exclusions: extension and desktop system notifications. The extension needs a
manifest permission and store review; desktop needs the Tauri notification
plugin and a signed build. Both are later slices.

Acceptance: with the switch off nothing is requested; with it on, permission is
requested once, a long run in a background tab notifies once, and clicking the
notification focuses the result.

## Slice 6: Visible build identity

Change: the header and Settings show the version with the build date and short
revision, for example `1.8.0-dev · Oct 26 · 5572cf3`, so each deployment is
visibly different. Tagged releases keep the plain version. The version policy
in `release-versioning.md` is unchanged.

Acceptance: two deployments from different commits show different labels, and
a release build shows no `-dev` marker.

## Slice 7: Menu manifest and reorganization proposal

Change: replace the March `CURRENT_MENU_SYSTEM.md` content with a manifest
generated from the current header, navigation registry, command palette,
settings and shortcuts, each entry with its location, purpose and route. Then
write a reorganization proposal with keep, move, merge and remove calls,
reconciled with the unified navigation work (Library controls L3) and the
viewport shell plan. The visual redesign starts only after the proposal is
approved.

Acceptance: every visible menu control on `main` appears in the manifest, and
the proposal names each change with its reason.

## Open decisions

### D-INT-1: Live formatting in Scratch (T02)

- A. Live-preview Markdown editor: formatting renders in place, syntax shows only
  on the line being edited, storage stays Markdown. **Recommended.**
- B. Full rich-text editor with Markdown conversion. Higher risk of altering
  note text on round trips.
- C. Keep the modes but open notes in Preview and switch to editing on click. No
  new dependency; Markdown still appears while editing.

Unlocks: a spike, then a Scratch editor slice. A or B adds a dependency to all
three shells.

### D-INT-2: Dual Pane after Scratch beside Write (T08, T11)

- A. Keep Dual Pane unchanged.
- B. Retire Dual Pane as a destination once Slice 1 ships; its routes open Write.
  **Recommended.**
- C. Rebuild Dual Pane as Write plus Scratch.

### D-INT-3: Where feedback is sent (T10)

- A. Local only for now: append to the feedback note and copy as Markdown.
  **Recommended.**
- B. Also open a prefilled GitHub issue. The repository is public, so reports
  become public.
- C. A hosted endpoint that files into the Notion bug inbox. Needs a new API
  route, a token and a cost review.

### D-INT-4: Meaning of generic prompt mode (T15)

- A. A General enhance mode that makes no coding or agent assumptions.
  **Recommended.**
- B. A pass-through mode that saves and sends prompts exactly as written.
- C. Model-neutral output with no provider-specific formatting.

### D-INT-5: Order after Slice 0

- A. Slices 1, 2, 3, 6, 4, 5, 7. **Recommended:** the most-requested change
  first, small wins next.
- B. Numeric order.

### D-INT-6: Release cut (T21)

- A. Ship Slice 6 now; cut the tagged `1.8.0` release when the existing release
  gates pass, then move source to `1.9.0-dev`. **Recommended.**
- B. Bump the minor version on every feature merge. This contradicts the
  accepted versioning policy.

## Delivery

Each slice ships as its own pull request with targeted tests, shared builds,
CI and a production check of the hosted web app, in the repository's usual
order. Issue Backlog rows for the accepted slices were created on 2026-10-26.
Physical-device, signing and tagged-release acceptance stay separate gates.
