# Prompt Lab — Enhance Layout Refactor

## Target

```
/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/
```

## Objective

Restructure the Enhance tab layout so the result card is the visual hero, input is secondary, diagnostics are compact, diff is a drawer not a modal, and errors surface near the action point. No new features — this is a layout and elevation pass on existing components.

## Pre-read (mandatory before any edits)

| File | Lines | Role |
|---|---|---|
| `App.jsx` | 978 | Main render orchestration — contains score card, lint panel, error block, loading status, textarea |
| `EditorActions.jsx` | 157 | Action rail — mode selector, enhance, save, overflow menu |
| `ResultPane.jsx` | ~150 | Enhanced output display, tabs, copy, replace-input |
| `DiffPane.jsx` | ~130 | Full-screen diff modal — needs drawer conversion |
| `ModalLayer.jsx` | — | Modal orchestration — remove DiffPane from here after conversion |
| `useEditorState.js` | 80 | Lint state, debounce, handleLintFix |
| `hooks/useUiState.js` | — | Theme, colorMode |

## Changes in order

### 1. Relocate error banner (App.jsx)

Current location: lines 755-809, below result pane.

- Cut the `{error && ( ... )}` block
- Paste it immediately after the `EditorActions` component (after ~line 695)
- No markup changes needed — the existing error block has category badge, retryable indicator, suggestions, and action buttons
- Wrap in a render function for clarity:

```jsx
function renderErrorBanner() {
  if (!error) return null;
  return ( /* existing error JSX, unchanged */ );
}
```

### 2. Wrap textarea in input card (App.jsx)

Current textarea: lines 548-612.

- Wrap the existing textarea and its surrounding elements in a card container
- Add a compact header row above the textarea with:
  - Left: `INPUT` label (11px uppercase tracking-wide, violet-300 in dark mode)
  - Right: live word / character / approx token count (xs text, slate-400)
- Token estimate: `Math.ceil(raw.length / 4)` (good enough, no tokenizer needed)

```
Card:       rounded-xl border border-white/10 bg-white/[0.03] p-4
Header:     mb-2 flex items-center justify-between
Label:      text-[11px] font-semibold uppercase tracking-[0.16em] text-violet-300
Meta:       text-xs text-slate-400
```

Do NOT change the textarea element itself, its state bindings, or its focus behavior.

### 3. Merge score + lint into diagnostic strip (App.jsx)

Current score card: lines 614-633.
Current lint panel: lines 634-673.

- Remove both blocks
- Replace with a single compact strip that renders only when `raw.trim()` is non-empty
- Strip content:
  - Left cluster: score pill (`N/5`), first 1-2 lint issue summaries
  - Right: "Fix" button (calls `handleLintFix` on the first fixable issue)
- Extract as `renderDiagnosticStrip()`

```
Strip:      mt-3 flex items-center justify-between gap-3 rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-2
Score pill: rounded-full bg-slate-900/70 px-2 py-1 text-[11px] font-medium text-slate-200
Summary:    text-xs text-amber-100/90 truncate
Fix btn:    h-8 rounded-md px-3 text-xs font-medium
```

When score is 4-5/5 and no lint issues, strip should use a neutral/green border instead of amber.

### 4. Elevate result card (App.jsx + ResultPane.jsx)

- In App.jsx, wrap the `<ResultPane>` invocation in an elevated card container
- This card should visually outrank the input card

```
Wrapper:    rounded-2xl border border-violet-400/20 bg-violet-500/[0.06] p-4
            shadow-[0_0_0_1px_rgba(167,139,250,0.06),0_12px_40px_rgba(0,0,0,0.28)]
```

- In ResultPane.jsx, remove the `diff` entry from `resultTabs` — diff moves to a drawer (step 5)
- Ensure Copy and Replace Input buttons are prominent in the result header

### 5. Convert DiffPane from modal to inline drawer (App.jsx + DiffPane.jsx)

- In App.jsx, add a "Show Diff" toggle button inside the result card actions
- New state: `const [diffOpen, setDiffOpen] = useState(false)`
- Render the diff drawer inline below the result body, collapsed by default
- Drawer only renders when `diffOpen && enhanced`

```
Drawer:     mt-3 rounded-xl border border-white/10 bg-slate-950/60 p-3
Header:     mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400
Content:    max-h-[240px] overflow-auto text-sm leading-7
Added:      rounded bg-emerald-500/15 px-1 text-emerald-200
Deleted:    rounded bg-rose-500/15 px-1 line-through text-rose-200
```

- Remove DiffPane from ModalLayer.jsx modal list
- The DiffPane.jsx file can be repurposed or the diff logic inlined — use judgment based on complexity

### 6. Touch target and width fixes

- In EditorActions.jsx, bump all interactive elements to `h-11` (44px)
- Add `min-w-[120px]` to the Enhance button to prevent width jitter during loading
- Mode select: `h-11 min-w-[132px] text-sm`

### 7. Add overflow menu items (EditorActions.jsx)

Add these items below the existing "Clear Editor" entry:

- Reset Result — calls a new `onResetResult` prop (clears enhanced/variants/notes)
- Export Prompt — calls a new `onExport` prop
- Redaction Settings — calls a new `onOpenRedactionSettings` prop

Wire the props in App.jsx. The handlers likely already exist or are trivial:
- Reset: `() => { setEnhanced(''); setVariants([]); setNotes(''); }`
- Export: check for existing export logic in the codebase before writing new
- Redaction settings: likely opens an existing modal via useUiState

## Constraints

- Tailwind only — no new CSS files
- Respect existing `m` (theme mode) object for dark/light colors
- Respect existing `compact` flag for tighter layouts
- Do NOT touch: useEditorState.js, useExecutionFlow.js, promptLint.js, redactionEngine.js, piiScanner.js — these are stable
- Do NOT add new dependencies
- Do NOT change the enhance/save/load execution flow
- Do NOT modify the API call shape or provider logic
- Preserve all keyboard shortcuts (Cmd+Enter, Cmd+S, etc.)

## Render order after refactor

```
<EditorActions />          ← action rail (exists)
{renderErrorBanner()}      ← moved up from below result
{renderInputCard()}        ← new wrapper around existing textarea
{renderDiagnosticStrip()}  ← merged score + lint
<ResultCardWrapper>        ← new elevated wrapper
  <ResultPane />           ← exists, minus diff tab
  {renderDiffDrawer()}     ← new inline drawer
</ResultCardWrapper>
```

## Verification

After implementation:

1. `npm run build` passes with no errors
2. Enhance flow works end-to-end (input -> enhance -> result -> copy)
3. Score updates live on input
4. Lint issues appear in diagnostic strip
5. Fix button applies quick-fix
6. Diff drawer toggles open/closed
7. Error banner appears below action rail on provider failure
8. All buttons are 44px tall
9. Result card is visually dominant over input card
10. Clear is only accessible via overflow menu
11. No regressions on save, load, keyboard shortcuts
12. Dark and light themes both work
13. Compact mode still works

## Do NOT

- Add features not in this list
- Refactor hooks or state management
- Extract App.jsx into multiple files beyond the render functions listed
- Add comments explaining what unchanged code does
- Touch the library panel, composer tab, A/B test tab, or pad tab
