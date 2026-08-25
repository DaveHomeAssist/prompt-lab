# Codex Prompt: App.jsx UI Wiring for Ghost Variables + Golden Response

> **Archived — delivered.** This build prompt asked for App.jsx wiring for
> Ghost Variables and Golden Response. Both shipped: `isGhostVar` /
> `resolveGhostVars` in `promptUtils.js`, `pinGoldenResponse` /
> `clearGoldenResponse` in `usePromptLibrary.js`, and the `GoldenBenchmark`
> panel in `CreateEditorPane.jsx`. Its line-number references point at a
> pre-redesign `App.jsx` and no longer resolve. Retained for provenance only.


**Target file (modify only this):**
- `prompt-lab-extension/src/App.jsx`

**Do NOT modify:** any hooks, utilities, schema files, or other components.

## Context

Two data-layer features have been implemented and verified:

1. **Ghost Variables** — `isGhostVar()` and `resolveGhostVars()` exist in `promptUtils.js`.
   The `loadEntry()` hook in `usePromptEditor.js` already resolves ghost vars and
   pre-fills `varVals` with their values. The var form modal in App.jsx (line 613)
   currently renders all variables identically — ghost vars need a visual indicator.

2. **Golden Response** — `pinGoldenResponse()` and `clearGoldenResponse()` exist on
   the library hook. `ngramSimilarity()` exists in `promptUtils.js`. `wordDiff()` is
   already imported and used. The prompt schema now includes `goldenResponse` on
   library entries. The UI needs pin buttons and a comparison panel.

## Current App.jsx Structure (relevant sections)

**Imports (line 1–18):**
```javascript
import { wordDiff, scorePrompt, extractVars, looksSensitive } from './promptUtils';
import useLibrary from './hooks/usePromptLibrary.js';
```

**Hook destructuring (line 46–72):**
```javascript
const lib = useLibrary(notify);
const ed = usePromptEditor(ui, lib);
const {
  // ...existing destructured values...
  varVals, setVarVals, showVarForm, setShowVarForm, pendingTemplate, applyTemplate,
  enhance, doSave, clearEditor, openSavePanel, openOptions, copy,
  loadEntry, addToComposer,
  editingId, enhanced, showDiff, evalRuns, showEvalHistory,
} = ed;
```

**Var form modal (lines 613–636):**
Renders a modal with inputs for each key in `varVals`. All vars look identical.

**Enhanced output section (lines 287–307):**
Shows the enhanced text with Show Diff / Copy buttons in the header.

**Eval history section (lines 334–368):**
Collapsible panel showing eval runs with provider, model, latency, and copy button.

## Task

### Part 1: Ghost Variable Badges

**1a. Add import:**
Add `isGhostVar` to the existing import from `'./promptUtils'` (line 4):
```javascript
import {
  wordDiff, scorePrompt, extractVars,
  looksSensitive, isGhostVar,
} from './promptUtils';
```

**1b. Update var form (line 622–627):**
For each variable in the form, check `isGhostVar(k)`. If true, add a small
`(auto)` badge next to the label. The pre-filled value is already in `varVals[k]`
from the hook — no logic changes needed, just visual.

Current:
```jsx
{Object.keys(varVals).map(k => (
  <div key={k}>
    <label className="text-xs font-mono font-semibold text-violet-400 block mb-1">{`{{${k}}}`}</label>
    <input className={`w-full ${m.input} border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-violet-500 ${m.text}`}
      placeholder={`Value for ${k}…`} value={varVals[k]} onChange={e => setVarVals(p => ({ ...p, [k]: e.target.value }))} />
  </div>
))}
```

Change to:
```jsx
{Object.keys(varVals).map(k => (
  <div key={k}>
    <label className="text-xs font-mono font-semibold text-violet-400 block mb-1">
      {`{{${k}}}`}
      {isGhostVar(k) && <span className="ml-1.5 text-emerald-400 font-sans text-[10px] font-normal">(auto)</span>}
    </label>
    <input className={`w-full ${m.input} border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-violet-500 ${m.text}`}
      placeholder={isGhostVar(k) ? `Auto-filled · editable` : `Value for ${k}…`}
      value={varVals[k]} onChange={e => setVarVals(p => ({ ...p, [k]: e.target.value }))} />
  </div>
))}
```

### Part 2: Golden Response UI

**2a. Add imports:**
Add `ngramSimilarity` to the `promptUtils` import (line 4):
```javascript
import {
  wordDiff, scorePrompt, extractVars,
  looksSensitive, isGhostVar, ngramSimilarity,
} from './promptUtils';
```

**2b. Add state for golden comparison toggle (after line 72):**
```javascript
const [showGoldenCompare, setShowGoldenCompare] = useState(false);
```

Add `useState` is already imported on line 1.

**2c. Derive the current entry's golden response (after existing derived values ~line 75):**
```javascript
const currentEntry = editingId ? lib.library.find(e => e.id === editingId) : null;
const goldenResponse = currentEntry?.goldenResponse || null;
```

**2d. Add "Pin as Golden" button to enhanced output header (line 291):**

In the enhanced section header (line 289–296), add a pin button between the
existing buttons. Only show when `editingId` is set and `enhanced` has content:

Current header buttons area:
```jsx
<div className={`flex items-center gap-3 ${compact ? 'flex-wrap justify-end' : ''}`}>
  <button onClick={() => setShowDiff(p => !p)} ...>Show Diff</button>
  <button onClick={() => copy(enhanced)} ...>Copy</button>
</div>
```

Add after the Copy button:
```jsx
{editingId && (
  <button onClick={() => lib.pinGoldenResponse(editingId, { text: enhanced })}
    className={`flex items-center gap-1 text-xs ${m.textSub} hover:text-amber-400 transition-colors`}
    title="Pin current output as golden response">
    <Ic n="Star" size={10} />Pin Golden
  </button>
)}
```

**2e. Add "Pin as Golden" button to each eval run row (line 343–361):**

Inside the eval run card, after the existing copy button (line 356–359), add:

```jsx
{editingId && run.output && (
  <button onClick={() => lib.pinGoldenResponse(editingId, {
    text: run.output,
    runId: run.id,
    provider: run.provider,
    model: run.model,
  })}
    className={`mt-1 flex items-center gap-1 ${m.textSub} hover:text-amber-400 transition-colors`}>
    <Ic n="Star" size={10} />Pin as Golden
  </button>
)}
```

**2f. Add Golden Response comparison panel (after line 368, after eval history closes):**

After the eval history `</div>` (the one closing the surface container on line 368),
add a new collapsible section. Only render when `goldenResponse` exists:

```jsx
{goldenResponse && (
  <div className={`${m.surface} border ${m.border} rounded-lg`}>
    <button onClick={() => setShowGoldenCompare(p => !p)}
      className={`w-full flex justify-between items-center px-3 py-2 text-xs font-semibold text-amber-400 uppercase tracking-wider`}>
      <span className="flex items-center gap-1.5"><Ic n="Star" size={10} />Golden Response</span>
      <Ic n={showGoldenCompare ? 'ChevronUp' : 'ChevronDown'} size={10} />
    </button>
    {showGoldenCompare && (
      <div className="px-3 pb-3 flex flex-col gap-2">
        {enhanced && (
          <div className="flex items-center gap-3">
            <span className={`text-xs ${m.textMuted}`}>
              Similarity: {Math.round(ngramSimilarity(enhanced, goldenResponse.text) * 100)}%
            </span>
            <div className="flex-1 h-1.5 rounded-full bg-gray-700 overflow-hidden">
              <div className="h-full bg-amber-400 rounded-full transition-all"
                style={{ width: `${Math.round(ngramSimilarity(enhanced, goldenResponse.text) * 100)}%` }} />
            </div>
          </div>
        )}
        <div className={`${m.codeBlock} border ${m.border} rounded-lg p-3 text-sm leading-loose max-h-48 overflow-y-auto`}>
          {enhanced ? (
            wordDiff(goldenResponse.text, enhanced).map((d, i) => (
              <span key={i} className={`${d.t === 'add' ? m.diffAdd : d.t === 'del' ? m.diffDel : m.diffEq} px-0.5 rounded mr-0.5`}>{d.v}</span>
            ))
          ) : (
            <p className={`text-xs ${m.textAlt}`}>{goldenResponse.text.slice(0, 500)}{goldenResponse.text.length > 500 ? '…' : ''}</p>
          )}
        </div>
        <div className="flex items-center justify-between">
          <span className={`text-xs ${m.textMuted}`}>
            Pinned {new Date(goldenResponse.pinnedAt).toLocaleDateString()}
            {goldenResponse.provider && ` · ${goldenResponse.provider}`}
            {goldenResponse.model && ` ${goldenResponse.model}`}
          </span>
          <button onClick={() => lib.clearGoldenResponse(editingId)}
            className={`text-xs ${m.textSub} hover:text-red-400 transition-colors`}>
            Clear Golden
          </button>
        </div>
      </div>
    )}
  </div>
)}
```

## Constraints

- Do NOT modify any hook files, utility files, or schema files
- Do NOT add new component files — all changes are inline in App.jsx
- Do NOT change any existing behavior — this is purely additive UI
- The `lib` object already exposes `pinGoldenResponse` and `clearGoldenResponse` —
  just call them. Check `usePromptLibrary.js` line 234 if needed.
- The `Ic` component (lucide icons) is already imported. Use icon names like
  `"Star"`, `"Copy"`, `"ChevronUp"`, `"ChevronDown"` — these are already used elsewhere.
- Do NOT compute `ngramSimilarity` twice — if you need the value in both the percentage
  text and the progress bar, compute it once and store in a variable.
- Maintain the existing code style: Tailwind classes, `${m.xxx}` theme tokens,
  single-line JSX where the existing code uses it.
- All 49 existing tests must still pass.

## Verification

After your changes:

1. Load a template with `{{date}}` and `{{topic}}` — var form shows `{{date}}` with
   `(auto)` badge and pre-filled value, `{{topic}}` with no badge and empty input
2. In the editor with `editingId` set and enhanced output showing — "Pin Golden" button
   visible next to Copy in the enhanced header
3. Click "Pin Golden" — toast says "Pinned as golden response"
4. Golden Response section appears below eval history with amber star icon
5. Expand it — shows similarity percentage with progress bar, word diff of golden
   vs current enhanced, pinned date, and "Clear Golden" button
6. Click "Clear Golden" — section disappears, toast confirms
7. In eval history, each run row shows "Pin as Golden" button when `editingId` is set
8. Click pin on an eval run — golden response set with that run's output, provider, model
9. No `editingId` set — no pin buttons visible anywhere
