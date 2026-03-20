# Prompt Lab — Codex Task Queue

Split prompts for delegating sprint board work to OpenAI Codex. Each task is self-contained, scoped to specific files, and includes verification steps.

**Repo:** `DaveHomeAssist/prompt-lab`
**Branch strategy:** Each task creates its own branch from `main`

---

## Phase 0: Unlock Hidden Features

### CODEX-001: Wire prompt lint into editor UI

```
Branch: feat/wire-prompt-lint

In prompt-lab-source/prompt-lab-extension/src/, the file promptLint.js exports a linting function that analyzes prompts for quality issues (missing role, vague instructions, etc.) but it is NOT currently called from the editor UI.

Wire it in:

1. Read promptLint.js to understand its API (what it exports, what it returns)
2. In App.jsx, find where the user's prompt text (raw input) is stored in state
3. After the user types or pastes a prompt, call the lint function on the raw text
4. Display the lint results below the editor input area — use the existing lintIssues state and lintOpen toggle if they exist
5. Each lint issue should show: severity (warning/error), message, and a suggested fix if available
6. Style using existing Tailwind classes from the codebase (check constants.js for the T theme object)

Verification:
- Type a vague prompt like "help me" — lint warnings should appear
- Type a well-structured prompt with role, task, constraints — fewer or no warnings
- Run: npm test (from prompt-lab-source/prompt-lab-extension/)
```

### CODEX-002: Add PII redaction pre-send gate

```
Branch: feat/redaction-gate

In prompt-lab-source/prompt-lab-extension/src/, two files exist but are not wired:
- sensitiveData.js — detects PII patterns (emails, phone numbers, API keys, etc.)
- redactionGate.js — provides a UI gate that warns before sending

Wire them into the enhance/send flow:

1. Read both files to understand their APIs
2. In App.jsx or the enhance flow, BEFORE the API call fires, run the sensitive data detector on the prompt text
3. If PII is detected, show a warning modal/banner listing what was found (e.g., "1 email address, 1 API key detected")
4. Give the user options: "Send anyway", "Redact and send", or "Cancel"
5. If "Redact and send", use the redaction function to mask the PII before sending
6. Use existing modal patterns from the codebase (check DesktopSettingsModal or BugReportModal for the pattern)

Verification:
- Type a prompt containing "my email is test@example.com" — warning should appear
- Type a prompt containing "sk-abc123..." — API key warning should appear
- "Redact and send" should replace the PII with [REDACTED] before the API call
- Run: npm test
```

### CODEX-003: Hook experiment history into A/B test UI

```
Branch: feat/experiment-history-ui

In prompt-lab-source/prompt-lab-extension/src/, experimentHistory.js exports functions for persisting and retrieving A/B test experiment runs, but the ABTestTab.jsx component does not use it.

Wire it in:

1. Read experimentHistory.js to understand: how experiments are saved, retrieved, and structured
2. In ABTestTab.jsx, after an A/B comparison completes, save the run to experiment history
3. Add a "History" section below the A/B comparison area showing past runs
4. Each history entry should show: date, prompt snippet, providers compared, and a "Load" button to re-view results
5. Use existing list/card patterns from LibraryPanel.jsx for visual consistency

Verification:
- Run an A/B test between two providers
- The result should automatically save to history
- Reload the page — history persists (check localStorage)
- Click "Load" on a history entry — the comparison re-renders
- Run: npm test
```

### CODEX-004: Surface error taxonomy in error UX

```
Branch: feat/error-taxonomy-ui

In prompt-lab-source/prompt-lab-extension/src/, errorTaxonomy.js classifies API errors into user-friendly categories (auth failure, rate limit, model not found, network error, etc.) but the UI currently shows raw error messages.

Wire it in:

1. Read errorTaxonomy.js to understand the classification API
2. In App.jsx (or wherever API errors are caught and displayed), pass the raw error through the taxonomy classifier
3. Replace the raw error message with a structured display:
   - Error type badge (e.g., "Auth Error", "Rate Limit", "Network")
   - User-friendly message explaining what happened
   - Suggested action (e.g., "Check your API key in Settings", "Wait 60 seconds and retry")
4. Use the existing Toast component for transient errors, and inline display for persistent ones
5. Style error badges using the existing red/amber color tokens from constants.js

Verification:
- Trigger a 401 error (use an invalid API key) — should show "Auth Error" with "Check your API key" suggestion
- Trigger a rate limit (if possible) — should show "Rate Limit" with retry guidance
- Run: npm test
```

---

## Sprint 1: Output-Centric UX & Readability

### CODEX-005: Output panel card treatment + copy CTA

```
Branch: feat/output-card

In App.jsx, the enhanced output currently renders as secondary content below the input. Make it feel like the primary deliverable:

1. Find where the enhanced result is rendered (look for "enhanced" or "result" in the JSX)
2. Wrap the output in a distinct card: rounded-lg border, slightly elevated background (use surface-alt or a subtle violet tint), larger font-size (text-base instead of text-sm)
3. Add a prominent "Copy" button at the top-right of the output card — use the existing copy-to-clipboard pattern from the code demo section
4. Add a "Replace prompt with result" button below Copy — when clicked, it replaces the input textarea content with the enhanced output
5. If the output is streaming, show a subtle shimmer/loading state (check index.css for .pl-skeleton-line)

Verification:
- Enhance a prompt — output should appear in a visually distinct card
- Click Copy — clipboard should contain the enhanced text
- Click "Replace prompt" — input textarea should update with the enhanced text
- Run: npm test
```

### CODEX-006: Bump touch targets to 44px

```
Branch: feat/touch-targets

In prompt-lab-source/prompt-lab-extension/src/index.css, the .ui-control class sets min-height to 2rem (32px). WCAG requires 44px minimum for touch targets.

1. In index.css, change .ui-control min-height from 2rem to 2.75rem (44px)
2. Update the density mode overrides:
   - .pl-density-compact .ui-control: min-height 2.5rem (40px) — allow slight reduction in compact
   - .pl-density-spacious .ui-control: min-height 3rem (48px)
3. Check that all button, tab, and interactive elements use the .ui-control class or have equivalent min-height
4. In App.jsx, verify the tab bar buttons have min-height applied
5. Test at all three density modes to ensure nothing clips or overflows

Verification:
- Inspect any button in DevTools — min-height should be >= 44px in comfortable mode
- Switch to compact density — buttons should be >= 40px
- Switch to spacious density — buttons should be >= 48px
- No text clipping or layout overflow in any mode
- Run: npm test
```

### CODEX-007: Bump text sizes and tab labels

```
Branch: feat/text-size-bump

In prompt-lab-source/prompt-lab-extension/src/:

1. In constants.js, find the T (theme) object. If there's a font-size related token, increase the base from text-xs (12px) to text-sm (14px) for interactive elements
2. In App.jsx, find the tab bar buttons. Change their font size from text-[11px] to text-sm (14px)
3. In EditorActions.jsx, change button label text from text-xs to text-sm
4. Search all components for text-[10px] and text-[11px] — upgrade to text-xs (12px) minimum for anything the user needs to read
5. Keep monospace data labels at text-xs — only bump interactive/readable text

Verification:
- Tab labels should be visibly larger and more readable
- Button text should be 14px
- No layout overflow from the size increase
- Run: npm test
```

### CODEX-008: Strengthen active tab indicator

```
Branch: feat/tab-indicator

In App.jsx, the active tab currently uses border-b-2 border-violet-500 (a bottom border only). This is too subtle.

1. Find the tab button rendering in App.jsx (look for role="tab" or the tab bar section)
2. Change the active state from bottom-border-only to include a background tint:
   - Active: bg-violet-500/10 text-violet-400 border-b-2 border-violet-500
   - Inactive: bg-transparent text-gray-500
3. Add a smooth transition: transition-colors duration-150
4. Ensure the hover state for inactive tabs is: bg-gray-800/50 text-gray-300

Verification:
- Active tab should have a noticeable violet background tint
- Switching tabs should show a smooth color transition
- Run: npm test
```

---

## Sprint 3: Architecture Extraction (Gate Sprint)

### CODEX-009: Extract useEditorState hook

```
Branch: refactor/extract-editor-state

App.jsx (77KB) is a monolith. Extract the editor state management into a dedicated hook.

1. In App.jsx, identify ALL state variables and functions related to the editor:
   - raw (input text), enhanced (output), variants, notes
   - loading, streaming, error states
   - enhMode (enhancement mode selection)
   - lintIssues, lintOpen, showDiff, showNotes
   - The enhance function, cancel function
   - Any effect hooks that manage editor state

2. Create src/hooks/useEditorState.js containing:
   - All the state declarations listed above
   - All the functions that modify editor state
   - Return an object with all state values and functions

3. In App.jsx, replace the extracted state with:
   const editor = useEditorState();
   Then update all references from direct state to editor.raw, editor.enhanced, etc.

4. Do NOT change any behavior — this is a pure extraction refactor

Verification:
- App should work identically before and after
- Run: npm test — all 52 tests must pass
- Verify: enhance flow works, mode switching works, lint display works
- App.jsx should be measurably smaller (check file size before/after)
```

### CODEX-010: Extract usePromptLibrary hook

```
Branch: refactor/extract-library

Extract library state management from App.jsx into a dedicated hook.

1. In App.jsx, identify ALL state and functions related to the prompt library:
   - library (saved prompts array), collections, activeCollection
   - search, sortBy
   - CRUD functions: save, update, delete, duplicate
   - Import/export functions
   - Collection management

2. Create src/hooks/usePromptLibrary.js (or update if it already exists as a partial extraction)

3. In App.jsx, replace with: const library = usePromptLibrary();

4. Pure extraction — no behavior changes

Verification:
- Save a prompt, reload, verify it persists
- Search, filter by collection, sort — all work
- Import/export JSON — works
- Run: npm test — all 52 tests pass
```

### CODEX-011: Extract useExperiments hook

```
Branch: refactor/extract-experiments

Extract A/B test and experiment state from App.jsx.

1. In App.jsx, identify ALL state and functions related to experiments:
   - A/B test variants (left/right)
   - compareRuns, evalRuns
   - Test cases (testCasesByPrompt, currentTestCases)
   - Run functions (runSingleCase, runAllCases)
   - batchProgress state

2. Create src/hooks/useExperiments.js

3. In App.jsx, replace with: const experiments = useExperiments();

4. Pure extraction — no behavior changes

Verification:
- A/B test flow works end-to-end
- Test case creation and execution works
- Run history displays correctly
- Run: npm test — all 52 tests pass
```

---

## Sprint 4: Navigation Polish

### CODEX-012: Rename ambiguous labels

```
Branch: feat/nav-labels

In App.jsx and navigationRegistry.js:

1. Find the "Experiments" tab/view label — rename to "Runs"
2. Find the "Library" sub-tab label (the one that conflicts with the Library sidebar panel) — rename to "Saved" or "Saved Prompts"
3. Update navigationRegistry.js command palette entries to match new labels
4. Update any aria-label attributes that reference the old names
5. Search the entire src/ directory for the old strings to catch any tooltips, help text, or comments

Verification:
- Tab bar shows "Runs" instead of "Experiments"
- Library sub-tab shows "Saved" instead of "Library"
- Command palette (Cmd+K) uses the new labels
- Run: npm test
```

### CODEX-013: Add arrow-key tab navigation

```
Branch: feat/arrow-key-tabs

In App.jsx, the tab bar uses role="tablist" and role="tab" but does not support left/right arrow key navigation (ARIA best practice).

1. Find the tab bar container with role="tablist"
2. Add a keydown handler:
   - ArrowRight: focus next tab, activate it
   - ArrowLeft: focus previous tab, activate it
   - Home: focus first tab
   - End: focus last tab
3. Set tabIndex={0} on the active tab and tabIndex={-1} on inactive tabs (roving tabindex pattern)
4. When a tab is activated via arrow key, also trigger the view switch (same as click)

Verification:
- Tab to the tab bar, then use arrow keys to navigate between tabs
- Each arrow press should visually activate the tab and switch the view
- Home/End should jump to first/last tab
- Run: npm test
```

---

## How to Use These Prompts

### With Codex via ChatGPT:
1. Open ChatGPT → Codex
2. Connect the `DaveHomeAssist/prompt-lab` repo
3. Paste one prompt at a time
4. Review the resulting PR

### With Codex via GitHub:
1. Create an issue with the prompt text as the body
2. Assign @codex to the issue
3. Codex creates a branch and PR automatically

### With Codex API:
```bash
curl https://api.openai.com/v1/codex/tasks \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
    "repo": "DaveHomeAssist/prompt-lab",
    "prompt": "<paste task prompt here>",
    "branch": "<branch name from task>"
  }'
```

### Recommended execution order:
1. **CODEX-001 through CODEX-004** in parallel (Phase 0 — no file conflicts)
2. **CODEX-005 through CODEX-008** in parallel (Sprint 1 — minimal overlap, test after merge)
3. **CODEX-009 through CODEX-011** sequentially (Sprint 3 — each extraction changes App.jsx)
4. **CODEX-012 and CODEX-013** in parallel (Sprint 4 — after extraction is merged)

### What to keep for Claude Code (interactive):
- Sprint 2 (Create workflow compression) — needs judgment calls about layout
- Sprint 5 (Experiments unification) — highest-risk refactor, needs real-time feedback
- Sprint 6 (Compose polish) — UX design decisions, iterative
- Sprint 7 (Validation) — interactive testing and debugging
