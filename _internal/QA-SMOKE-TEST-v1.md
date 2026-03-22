# Prompt Lab — Manual Smoke Test Checklist v1

**Date:** 2026-03-16
**Build:** v1.7.0 (post Starter Libraries, edit fix, pad formatting, promote flow)
**Scope:** Starter Libraries, Library Edit, Promote from Pad, Scratchpad Formatting, Persistence, Collections, Multi-Pad

---

## Execution Strategy

Run in **4 passes**, not one long blur.

| Pass | Scope | Goal | Stop on |
|---|---|---|---|
| 1 | Starter Libraries 1.1–1.8 | Confirm onboarding and seed import are real | duplicate prompts, missing metadata, bad persistence |
| 2 | Edit + Promote flows 2.1–3.4 | Confirm editor and library state transitions are safe | duplicate saves, stale editingId, blank editor load |
| 3 | Scratchpad formatting + pads 4.1–4.4, 7.1–7.6 | Confirm note taking is reliable | lost content, cursor bugs, migration failure |
| 4 | Save / reload / collections 5.1–6.3, 8.1–8.5 | Confirm persistence layer is stable | reload loss, delete failure, filter mismatch |

### Smart Stop Conditions

Stop the run and log immediately if you hit any of these:
- Duplicate library entries
- Reload loses data
- Save updates wrong entry
- Promote opens blank editor
- Legacy migration fails
- Autosave claims "Saved" but reload loses content
- White screen on corrupt localStorage

### Tightened Fast Path

For highest signal in least time, run exactly:

`1.1 → 1.2 → 1.3 → 1.5 → 2.1 → 2.2 → 3.1 → 3.2 → 3.3 → 4.1 → 4.3 → 5.1 → 5.2 → 6.2 → 7.1 → 7.2 → 7.5 → 7.6`

---

## Severity Rubric

| Severity | Meaning | Example |
|---|---|---|
| **P0** | Core trust or data integrity issue | duplicate prompts, data loss, reload wipe, wrong entry overwritten |
| **P1** | Major workflow broken but recoverable | editor not loading correctly, filters wrong, migration flaky |
| **P2** | Polish or UX issue | toast missing, button state wrong, highlight not clearing |
| **P3** | Cosmetic | spacing, color, alignment |

---

## Pass / Fail Log Template

| ID | Area | Test | Result | Notes | Severity | Repro |
|---|---|---|---|---|---|---|
| 1.1 | Starter Libraries | Packs visible on fresh state | | | | |
| 1.2 | Starter Libraries | Load a pack | | | | |
| 1.3 | Starter Libraries | Loaded pack persists on reload | | | | |
| 1.4 | Starter Libraries | Duplicate prevention — re-click | | | | |
| 1.5 | Starter Libraries | Duplicate prevention — metadata level | | | | |
| 1.6 | Starter Libraries | Existing library not disturbed | | | | |
| 1.7 | Starter Libraries | Starter section hides when all loaded | | | | |
| 1.8 | Starter Libraries | Loaded prompt metadata correct | | | | |
| 2.1 | Library Edit | Edit loads content into editor | | | | |
| 2.2 | Library Edit | Edit saves update, not duplicate | | | | |
| 2.3 | Library Edit | Edit preserves version history | | | | |
| 2.4 | Library Edit | Cancel edit clears state | | | | |
| 3.1 | Promote | Promote button state | | | | |
| 3.2 | Promote | Promote transfers content | | | | |
| 3.3 | Promote | Promote then save completes flow | | | | |
| 3.4 | Promote | Promote does not destroy pad | | | | |
| 4.1 | Formatting | Each formatting button works | | | | |
| 4.2 | Formatting | Insert at cursor (no selection) | | | | |
| 4.3 | Formatting | Formatting triggers autosave | | | | |
| 4.4 | Formatting | Date stamp insertion | | | | |
| 5.1 | Persistence | New save creates entry | | | | |
| 5.2 | Persistence | Library persists across reload | | | | |
| 5.3 | Persistence | Delete removes entry | | | | |
| 5.4 | Persistence | Auto-title generation | | | | |
| 6.1 | Collections | Collection created on save | | | | |
| 6.2 | Collections | Collection filter shows only matching | | | | |
| 6.3 | Collections | Starter pack creates collection automatically | | | | |
| 7.1 | Multi-Pad | Create new pad | | | | |
| 7.2 | Multi-Pad | Switch between pads | | | | |
| 7.3 | Multi-Pad | Rename pad | | | | |
| 7.4 | Multi-Pad | Delete pad | | | | |
| 7.5 | Multi-Pad | Legacy migration | | | | |
| 7.6 | Multi-Pad | Corrupt storage recovery | | | | |
| 8.1 | Edge Cases | Save during edit + reload | | | | |
| 8.2 | Edge Cases | Promote while editing another entry | | | | |
| 8.3 | Edge Cases | Starter pack + active collection filter | | | | |
| 8.4 | Edge Cases | Very large pad content | | | | |
| 8.5 | Edge Cases | Hard refresh + cache clear | | | | |

---

## Pass 1 — Starter Libraries

### 1.1 Packs visible on fresh state
- **Priority:** P1
- **Setup:** Clear `pl2-loaded-packs` from localStorage (or use incognito)
- **Action:** Open Library view, scroll to bottom
- **Expected:** "Starter Libraries" section visible with pack cards showing icon, name, description, prompt count, and violet "Load" button
- **Failure risk:** Starter section missing = `getStarterLibraries()` not wired or seed JSON import broken

### 1.2 Load a pack
- **Priority:** P0
- **Setup:** At least one pack shows "Load"
- **Action:** Click "Load" on "Data & Table Toolkit"
- **Expected:** Button briefly shows "Loading...", then switches to green "Loaded ✓". Toast: "Loaded 9 prompts into Data & Table Toolkit". Prompts appear at top of library list. Collection "Data & Table Toolkit" appears in collection filter bar.
- **Failure risk:** Prompts not appearing = `setLibrary(prev => [...newEntries, ...prev])` not firing

### 1.3 Loaded pack persists on reload
- **Priority:** P0
- **Setup:** Load a pack successfully
- **Action:** Reload page
- **Expected:** Pack button shows "Loaded ✓". Prompts still in library. `pl2-loaded-packs` in localStorage contains the pack ID.
- **Failure risk:** Reverts to "Load" = `saveJson(LOADED_PACKS_KEY)` failed

### 1.4 Duplicate prevention — re-click
- **Priority:** P1
- **Setup:** Pack already shows "Loaded ✓"
- **Action:** (Inspect element to remove `disabled`) Click "Load" again
- **Expected:** `loadStarterPack` returns null. No duplicate prompts. No duplicate toast.
- **Failure risk:** Duplicate entries = `loadedPacks.includes(packId)` guard failed

### 1.5 Duplicate prevention — metadata level
- **Priority:** P0
- **Setup:** Load a pack. Manually remove the pack ID from `pl2-loaded-packs` in localStorage (simulating partial state). Reload.
- **Action:** Click "Load" on same pack
- **Expected:** 0 new prompts added (existing entries matched by `metadata.packId` + `metadata.seedPromptId`). Toast: "Pack already loaded." Pack re-added to `pl2-loaded-packs`.
- **Failure risk:** Duplicate prompts = `existingSeeds` set check broken. This catches partial state corruption.

### 1.6 Existing library not disturbed
- **Priority:** P0
- **Setup:** Save 2-3 custom prompts to library first
- **Action:** Load a starter pack
- **Expected:** Custom prompts still present, in same order. Starter prompts prepended above them.
- **Failure risk:** Custom prompts gone or reordered = spread operator overwriting instead of prepending

### 1.7 Starter section hides when all loaded
- **Priority:** P2
- **Setup:** Load every available pack
- **Action:** Check library view
- **Expected:** "Starter Libraries" section disappears
- **Failure risk:** Section persists with all "Loaded ✓" = `.some(p => !p.loaded)` filter wrong

### 1.8 Loaded prompt metadata correct
- **Priority:** P1
- **Setup:** Load a pack
- **Action:** Expand a starter prompt, inspect (or check localStorage `pl2-library`)
- **Expected:** Entry has `metadata.source: "starter-library"`, `metadata.packId`, `metadata.packName`, `metadata.seedPromptId`, `metadata.category`. Notes say "Starter prompt from {pack name}." Collection matches pack name. `useCount: 0`.
- **Failure risk:** Missing metadata = `seedToEntry` not applying fields correctly

---

## Pass 2 — Edit + Promote Flows

### 2.1 Edit loads content into editor
- **Priority:** P0
- **Setup:** Have a saved prompt in library
- **Action:** Expand entry, click "Edit"
- **Expected:** Editor tab activates. Raw input populated with `entry.original`. Enhanced field populated with `entry.enhanced`. Save panel open. Title field shows entry title. Tags populated. Entry highlighted with violet border in library.
- **Failure risk:** Editor empty = `loadEntry()` not calling `setRaw`/`setEnhanced`. Save panel closed = `openSavePanel()` not fired.

### 2.2 Edit saves update (not duplicate)
- **Priority:** P0
- **Setup:** Click Edit on existing entry
- **Action:** Modify the raw text, click Save
- **Expected:** Existing entry updated in place (same ID). Toast: "Prompt updated!" No new entry created. Library count unchanged.
- **Failure risk:** New entry created = `editingId` not set, so `doSave` creates instead of updates. Duplicate entries kill trust fast.

### 2.3 Edit preserves version history
- **Priority:** P1
- **Setup:** Edit and save an entry twice
- **Action:** Expand entry, check versions
- **Expected:** Version history shows previous snapshots with timestamps
- **Failure risk:** No versions = `updatePromptEntry` not pushing to `versions` array

### 2.4 Cancel edit clears state
- **Priority:** P1
- **Setup:** Click Edit, then press Escape or click away
- **Action:** Check editor state
- **Expected:** `editingId` cleared. Violet border removed from library entry. Editor can accept new input without overwriting the old entry.
- **Failure risk:** Stale `editingId` = next save silently overwrites wrong entry

### 3.1 Promote button state
- **Priority:** P2
- **Setup:** Open Scratchpad tab
- **Action:** Check "Promote to Library" button with empty pad vs. pad with content
- **Expected:** Disabled (greyed) when pad empty. Enabled when pad has text.
- **Failure risk:** Always enabled = missing `!text.trim()` disabled check

### 3.2 Promote transfers content
- **Priority:** P0
- **Setup:** Type content in scratchpad. Pad named "My Draft".
- **Action:** Click promote button
- **Expected:** Tab switches to Editor. Raw field = pad content. Enhanced field = pad content. Save title = "My Draft". Save panel open. Toast: "Loaded into editor — save to library when ready."
- **Failure risk:** Empty editor = `setRaw(content)` not receiving text. Wrong tab = `setTab('editor')` not called.

### 3.3 Promote then save completes flow
- **Priority:** P0
- **Setup:** Promote pad content to editor
- **Action:** Add tags, click Save
- **Expected:** New entry in library with pad content as original/enhanced. Title matches pad name. Scratchpad content unchanged.
- **Failure risk:** Save fails = save panel wiring broken after promote. Cross-view flow bugs are common.

### 3.4 Promote does not destroy pad
- **Priority:** P1
- **Setup:** Promote content
- **Action:** Switch back to Scratchpad tab
- **Expected:** Pad still has original content, same pad selected
- **Failure risk:** Pad cleared = promote handler accidentally calling `setText('')`

---

## Pass 3 — Scratchpad Formatting + Multi-Pad

### 4.1 Each formatting button works
- **Priority:** P1
- **Setup:** Type "test text" in pad, select the word "text"
- **Action/Expected:**

| Button | Expected insertion |
|---|---|
| H | `\n## text\n` wrapping selection |
| Bullet | `\n- text` |
| Numbered | `\n1. text` |
| Code | `` \n```\ntext\n```\n `` wrapping selection |
| Quote | `\n> text` |

- **Failure risk:** No insertion = `insertAtCursor` not finding textarea ref

### 4.2 Insert at cursor (no selection)
- **Priority:** P2
- **Setup:** Place cursor in middle of text, no selection
- **Action:** Click Heading button
- **Expected:** `\n## \n` inserted at cursor position
- **Failure risk:** Inserted at wrong position = `selectionStart` not read correctly

### 4.3 Formatting triggers autosave
- **Priority:** P1
- **Setup:** Type text, wait for "Saved" indicator
- **Action:** Click a formatting button
- **Expected:** `saveState` goes to "saved" after formatting. Content persists on reload.
- **Failure risk:** Content lost on reload = `commitSave` not called after `insertAtCursor`. Easy place for hidden save regressions.

### 4.4 Date stamp insertion
- **Priority:** P2
- **Setup:** Pad with some text
- **Action:** Click Date button (or Cmd+Shift+D)
- **Expected:** `\n── Mon, Mar 16, 2026 ──\n` inserted at cursor. Autosave fires.
- **Failure risk:** Wrong format or no insertion

### 7.1 Create new pad
- **Priority:** P1
- **Setup:** On Scratchpad tab
- **Action:** Click "New" button (or Cmd+T)
- **Expected:** Prompt dialog asks for name. New pad appears in sidebar. Editor switches to empty pad.
- **Failure risk:** No dialog = `handleCreatePad` not wired

### 7.2 Switch between pads
- **Priority:** P0
- **Setup:** Create 2 pads with different content
- **Action:** Click pad names in sidebar
- **Expected:** Editor content switches. Previous pad content saved. Active pad highlighted.
- **Failure risk:** Content lost = `flushActivePad` not called before switching

### 7.3 Rename pad
- **Priority:** P2
- **Setup:** Active pad named "Pad 1"
- **Action:** Click Rename button
- **Expected:** Prompt dialog with current name. After confirm, sidebar and header update.
- **Failure risk:** Name reverts on reload = `persistPadsState` not called after rename

### 7.4 Delete pad
- **Priority:** P1
- **Setup:** 2+ pads exist
- **Action:** Click Delete on active pad, confirm
- **Expected:** Pad removed. Adjacent pad becomes active. Cannot delete last remaining pad.
- **Failure risk:** App crashes = fallback pad selection logic broken

### 7.5 Legacy migration
- **Priority:** P0
- **Setup:** Set `pl2-pad` in localStorage with content "old note", clear `pl2-pads` and `pl2-pads-schema-version`
- **Action:** Reload app, open Scratchpad
- **Expected:** Single pad created with legacy content. `pl2-pad` key removed. Schema version set to "2".
- **Failure risk:** Empty pad = migration not detecting legacy key. Upgrade path can silently wreck data.

### 7.6 Corrupt storage recovery
- **Priority:** P0
- **Setup:** Manually set `pl2-library` to `{broken json` or `pl2-pads` to `null`
- **Action:** Reload app
- **Expected:** App does not crash. Falls back gracefully to empty safe state or recovery notice. No white screen.
- **Failure risk:** White screen or broken boot due to unsafe JSON parse path. Local-first tools live or die on recovery behavior.

---

## Pass 4 — Save / Reload / Collections / Edge Cases

### 5.1 New save creates entry
- **Priority:** P0
- **Setup:** Type prompt in editor, no `editingId` active
- **Action:** Cmd+S, fill title/tags, Save
- **Expected:** New entry at top of library. Toast: "Saved!" Entry has generated ID, `createdAt` timestamp, `useCount: 0`.
- **Failure risk:** No entry = `createPromptEntry` failed

### 5.2 Library persists across reload
- **Priority:** P0
- **Setup:** Save 3 prompts
- **Action:** Reload page
- **Expected:** All 3 prompts present in same order. Tags, collections, notes intact.
- **Failure risk:** Empty library = localStorage write failed. Persistence is core product credibility.

### 5.3 Delete removes entry
- **Priority:** P1
- **Setup:** Have entries in library
- **Action:** Expand entry, Delete, Confirm
- **Expected:** Entry removed. Toast: "Prompt deleted." Library count decremented.
- **Failure risk:** Entry persists = filter not triggering persistence

### 5.4 Auto-title generation
- **Priority:** P2
- **Setup:** Open save panel without entering a title
- **Action:** Save with raw text "Write a Python script that parses CSV files and outputs JSON"
- **Expected:** Title auto-generated from first sentence, truncated at word boundary (~60 chars max)
- **Failure risk:** Title shows "Untitled Prompt"

### 6.1 Collection created on save
- **Priority:** P1
- **Setup:** Save a prompt with collection field set to "My Pack"
- **Action:** Check collection filter bar
- **Expected:** "My Pack" button appears in collection filters
- **Failure risk:** Missing = `setCollections` not called

### 6.2 Collection filter shows only matching
- **Priority:** P1
- **Setup:** Save prompts in 2 different collections + load a starter pack
- **Action:** Click a collection filter button
- **Expected:** Only prompts from that collection visible. "All" button clears filter.
- **Failure risk:** All prompts shown = `activeCollection` filter not applied. Filter bugs make library feel fake.

### 6.3 Starter pack creates collection automatically
- **Priority:** P1
- **Setup:** Load "Notion Page Formatter" pack
- **Action:** Check collection filter bar
- **Expected:** "Notion Page Formatter" collection button appears
- **Failure risk:** Missing = `setCollections` spread not firing

### 8.1 Save during edit + reload
- **Priority:** P0
- **Setup:** Edit an existing entry, change content, save, reload
- **Action:** Check library after reload
- **Expected:** Updated entry persists, same ID, same version chain, no duplicate
- **Failure risk:** Duplicate entry or lost update

### 8.2 Promote while editing another entry
- **Priority:** P1
- **Setup:** Start editing a library item (editingId set), then go to scratchpad and hit Promote
- **Action:** Check editor state after promote
- **Expected:** Clear, intentional behavior — either replaces current editor draft safely, or warns before replacing. No silent overwrite of the wrong library entry on next save.
- **Failure risk:** Stale `editingId` causes promote content to overwrite the previously-editing entry

### 8.3 Starter pack + active collection filter
- **Priority:** P1
- **Setup:** Apply a collection filter, then load a starter pack
- **Action:** Check library view
- **Expected:** Filter behavior remains sane. New collection appears in filter bar. No blank state weirdness.
- **Failure risk:** Blank library view because new prompts are in a different collection than the active filter

### 8.4 Very large pad content
- **Priority:** P2
- **Setup:** Paste 5000+ words into scratchpad, apply formatting, switch pads, reload
- **Action:** Return to original pad
- **Expected:** No truncation. Autosave still works. Content intact.
- **Failure risk:** localStorage size limit hit silently, or debounce timer drops content

### 8.5 Hard refresh + cache clear
- **Priority:** P1
- **Setup:** Load starter packs, save custom prompts, create multiple pads
- **Action:** Hard refresh (Cmd+Shift+R). Separately: clear site data, reload.
- **Expected:** Hard refresh: all data intact. Cache clear: app boots to clean state without crash.
- **Failure risk:** Browser cache lies about what's deployed vs. what's persisted

---

## Highest Risk Items Summary

| Priority | ID | Test | Why |
|---|---|---|---|
| P0 | 1.5 | Duplicate prevention — metadata level | catches partial state corruption |
| P0 | 2.2 | Edit saves update, not duplicate | duplicate entries kill trust fast |
| P0 | 3.3 | Promote then save completes flow | cross-view flow bugs are common |
| P0 | 5.2 | Library persists across reload | persistence is core product credibility |
| P0 | 7.5 | Legacy migration | upgrade path can silently wreck data |
| P0 | 7.6 | Corrupt storage recovery | local-first tools live or die on recovery |
| P0 | 8.1 | Save during edit + reload | silent data loss on core workflow |
| P1 | 4.3 | Formatting triggers autosave | easy place for hidden save regressions |
| P1 | 6.2 | Collection filter shows only matching | filter bugs make library feel fake |
| P1 | 8.2 | Promote while editing another entry | stale state cross-contamination |

---

*Estimated execution time: 20-25 minutes full pass, 10-12 minutes fast path.*
