# Feature Spec: Run Timeline Panel

> **Status:** Spec only — not started
> **Priority:** Highest-impact next feature
> **Depends on:** Nothing — all infrastructure exists
> **Blocked by:** Nothing

---

## Problem

Prompt Lab stores every execution in IndexedDB (`eval_runs` store) with full metadata — provider, model, latency, input, output, verdict, golden score, and version linkage. But this data is only surfaced as a compact 12-item list in the editor. There is no way to:

- Browse full run history for a prompt
- Compare outputs between runs
- See whether a prompt is improving or degrading over time
- Compare the same prompt across different models
- Export run history

The data layer is complete. The experience layer is missing.

---

## What Exists Today

### Storage (ready, no changes needed)

**IndexedDB store:** `eval_runs` in `prompt_lab_local` database (version 3)

**Indices:** `createdAt`, `promptId`, `mode`, `provider`

**Record schema** (from `evalSchema.js`):

```js
{
  id:              string,       // UUID
  createdAt:       string,       // ISO 8601
  promptId:        string|null,  // links to SavedPromptEntity.id
  promptVersionId: string|null,  // links to SavedPromptVersion.id
  promptTitle:     string,       // denormalized for display
  mode:            'enhance'|'ab'|'test-case',
  provider:        string,       // 'anthropic', 'openai', 'google', 'openrouter', 'ollama'
  model:           string,       // e.g. 'claude-sonnet-4-5-20250514'
  variantLabel:    string,       // A/B variant label
  input:           string,       // up to 12KB
  output:          string,       // up to 20KB
  latencyMs:       number,       // 0+
  verdict:         'pass'|'fail'|'mixed'|null,
  notes:           string,       // up to 2KB
  status:          'success'|'error',
  testCaseId:      string|null,
  goldenScore:     number|null   // 0-1 similarity to pinned golden response
}
```

**Capacity:** 1000 records (FIFO). localStorage fallback if IndexedDB unavailable.

### Query layer (ready, no changes needed)

```js
listEvalRuns({ promptId, mode, provider, status, search, limit })
getEvalRunById(id)
filterEvalRuns(records, filters)
```

### Execution hook (ready, already writes runs)

`useExecutionFlow.js` calls `saveEvalRun()` after every execution — enhance, A/B test, and test case. Golden score computed automatically if a golden response is pinned.

### Current display (minimal, upgrade target)

`useEvalRuns.js` loads runs filtered by `promptId` on tab change. `App.jsx` renders last 12 as a compact list. No expand, no compare, no trend.

---

## Proposed Feature

### Run Timeline Panel

A dedicated panel (or tab) showing the complete run history for the currently selected prompt. Replaces the current 12-item compact list with a richer browseable view.

### Layout

```
┌─────────────────────────────────────────────────────┐
│  Run History · prompt-title                         │
│  ┌───────────────────────────────────────────────┐  │
│  │ Filters: [All modes ▾] [All providers ▾]  🔍  │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  ┌─ Mar 16, 2:41pm ─────────────────────────────┐  │
│  │ claude-sonnet-4-5 · enhance · 1.2s            │  │
│  │ v3 → "Rewrite the intro paragraph to..."      │  │
│  │                                                │  │
│  │ Output preview (first 3 lines)                 │  │
│  │ ...                                            │  │
│  │                                                │  │
│  │ Golden: 0.82  ████████░░  [pass]   [compare]  │  │
│  │ Notes: "Better tone but lost the CTA"          │  │
│  └────────────────────────────────────────────────┘  │
│                                                     │
│  ┌─ Mar 16, 2:38pm ─────────────────────────────┐  │
│  │ gpt-4o · enhance · 0.8s                       │  │
│  │ v3 → "Rewrite the intro paragraph to..."      │  │
│  │                                                │  │
│  │ Output preview (first 3 lines)                 │  │
│  │ ...                                            │  │
│  │                                                │  │
│  │ Golden: 0.71  ███████░░░  [mixed]  [compare]  │  │
│  └────────────────────────────────────────────────┘  │
│                                                     │
│  Load more (38 older runs)                          │
└─────────────────────────────────────────────────────┘
```

### Run Card Contents

Each run card shows:

| Element | Source field | Display |
|---------|-------------|---------|
| Timestamp | `createdAt` | Relative ("2 min ago") or absolute, user's locale |
| Provider + model | `provider` + `model` | Pill badge, color-coded by provider |
| Mode | `mode` | "enhance" / "A/B" / "test case" |
| Latency | `latencyMs` | "1.2s" |
| Version | `promptVersionId` | "v3" (resolve from prompt's version array) |
| Input preview | `input` | First 120 chars, truncated |
| Output preview | `output` | First 3 lines or 200 chars, expandable |
| Golden score | `goldenScore` | Bar visualization (0-1 scale) + numeric |
| Verdict | `verdict` | pass/fail/mixed pill, clickable to toggle |
| Notes | `notes` | Inline editable, auto-saves on blur |
| Compare button | — | Opens side-by-side diff view |

### Interactions

**Verdict toggle:** Click the verdict pill to cycle through `null → pass → fail → mixed → null`. Writes directly to IndexedDB via `saveEvalRun()` (update existing record).

**Inline notes:** Click notes area to edit. Auto-save on blur. Same write path.

**Expand output:** Click output preview to expand full text. Click again to collapse.

**Compare mode:** Click "compare" on any two runs to open a side-by-side diff panel. Shows full output for both runs with highlighted differences.

**Filter bar:**
- Mode dropdown: All / Enhance / A/B / Test Case
- Provider dropdown: All / Anthropic / OpenAI / Google / OpenRouter / Ollama (populated from actual run data)
- Search: free text search across input, output, notes, model name
- All filters use existing `filterEvalRuns()` — no new query logic needed

**Pagination:** Show 20 runs initially. "Load more" button fetches next 20. Uses existing `limit` parameter in `filterEvalRuns`.

### Golden Score Trend

If the prompt has a pinned golden response, show a sparkline or mini bar chart at the top of the timeline:

```
Golden trend (last 10 runs)
█ █ ▄ █ ▆ ▄ █ █ ▇ █
0.82  avg: 0.76  best: 0.88
```

This is computed client-side from the filtered run list. No new storage needed.

### Model Comparison View

When runs exist across multiple providers for the same prompt, offer a "Compare models" toggle that groups runs by model:

```
┌──────────────────┬──────────────────┬──────────────────┐
│ claude-sonnet-4-5│ gpt-4o           │ gemini-2.0-flash │
│ Latest run       │ Latest run       │ Latest run       │
│ Golden: 0.82     │ Golden: 0.71     │ Golden: 0.68     │
│ Latency: 1.2s    │ Latency: 0.8s    │ Latency: 0.4s    │
│ Verdict: pass    │ Verdict: mixed   │ Verdict: fail    │
│                  │                  │                   │
│ [Full output]    │ [Full output]    │ [Full output]     │
└──────────────────┴──────────────────┴──────────────────┘
```

Only shown if 2+ distinct models appear in the filtered run list. Computed client-side.

---

## What NOT to Build

- No new IndexedDB stores or schema changes
- No new persistence hooks
- No backend or sync
- No streaming replay
- No automated re-execution ("run again" is just clicking Enhance)
- No prompt diffing (version diff is a separate feature)
- No export in v1 (can add later as JSON download from `listEvalRuns`)

---

## Data Layer Changes

**None required.** All queries use existing `listEvalRuns()` and `filterEvalRuns()`.

**One optional enhancement:** Allow `saveEvalRun()` to update an existing record (for verdict/notes edits). Currently it uses `put()` which already handles upserts — so this works today with no code change. The UI just needs to call `saveEvalRun(updatedRecord)` with the same `id`.

---

## Hook Changes

### Existing: `useEvalRuns.js`

Currently loads runs on tab change and caps at 12. Modify to:

- Accept a `limit` parameter (default 20, loadable in increments)
- Accept filter state (mode, provider, search)
- Return `{ runs, loading, hasMore, loadMore, updateRun }`
- `updateRun(id, patch)` calls `saveEvalRun({ ...existing, ...patch })` and refreshes list

**Backward compatibility requirement:** Existing call sites for `useEvalRuns` must continue to work without modification. Any new parameters must be optional with safe defaults that preserve the current behavior (12-run compact list). The existing compact eval display in `App.jsx` must not regress. Do not remove or change the current 12-run compact display logic — the new History panel must coexist with it.

### New: none

No new hooks needed. The existing hook just needs its cap lifted and filter params added.

---

## Component Structure

```
RunTimelinePanel (new component)
├─ RunFilterBar
│  ├─ ModeDropdown
│  ├─ ProviderDropdown
│  └─ SearchInput
├─ GoldenTrendBar (conditional — only if goldenResponse pinned)
├─ RunCardList
│  ├─ RunCard (×N)
│  │  ├─ RunMeta (timestamp, provider pill, mode, latency, version)
│  │  ├─ RunPreview (input/output, expandable)
│  │  ├─ GoldenScoreBar (conditional)
│  │  ├─ VerdictPill (clickable toggle)
│  │  └─ NotesInline (editable)
│  └─ LoadMoreButton
└─ ModelComparisonView (toggle, conditional)
```

All components are pure presentational except `RunTimelinePanel` which manages filter state and calls the `useEvalRuns` hook.

---

## Entry Point

**Where it lives in the UI:** New tab in the editor panel, or a collapsible section below the current eval history. Recommend a tab labeled "History" alongside existing "Editor" / "Library" / "Tests" tabs.

**Trigger:** Switching to the History tab loads `listEvalRuns({ promptId: currentPrompt.id })`. If no prompt is selected, show empty state: "Select a prompt to see its run history."

---

## Acceptance Criteria

- [ ] Run timeline shows all runs for the selected prompt, newest first
- [ ] Each run card displays: timestamp, provider, model, mode, latency, version, input preview, output preview, golden score, verdict, notes
- [ ] Output preview expands on click
- [ ] Verdict is toggleable (null → pass → fail → mixed → null) and persists
- [ ] Notes are inline-editable and persist on blur
- [ ] Filters work: mode, provider, free text search
- [ ] Pagination: initial 20, "load more" in increments of 20
- [ ] Golden trend sparkline appears when golden response is pinned
- [ ] Model comparison view appears when 2+ models in filtered results
- [ ] Compare button opens side-by-side output diff for any two runs
- [ ] Works in extension, desktop, and web (same component, no platform branching)
- [ ] Graceful fallback if IndexedDB unavailable (reads localStorage fallback)
- [ ] No new storage schemas, no backend, no breaking changes

---

## Implementation Estimate

**Scope:** UI-only feature. No infrastructure work.

**Files touched:**
- `useEvalRuns.js` — lift cap, add filters, add updateRun
- New component: `RunTimelinePanel.jsx` + sub-components
- `App.jsx` — add History tab routing
- Tailwind classes only (no new CSS files)

**Risk:** Low. No schema changes, no persistence changes, no provider changes. Pure presentation layer on existing data.
