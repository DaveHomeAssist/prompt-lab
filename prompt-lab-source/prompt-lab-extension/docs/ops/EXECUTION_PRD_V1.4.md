# Prompt Lab — Execution PRD

**Version:** 1.3.1 → 2.0.0
**Date:** 2026-03-12
**Baseline:** commit `9d9cdd0`, branch `main`
**Canonical root:** `prompt-lab-source/prompt-lab-extension/`

---

## Critical baseline finding

Six modules exist in `src/` but are **not imported by any running component**:

| Module | Exports | Imported by |
|---|---|---|
| `promptLint.js` | `lintPrompt`, `applyLintQuickFix` | **nothing** |
| `errorTaxonomy.js` | `normalizeError` | **nothing** |
| `sensitiveData.js` | `detectSensitiveData`, `redactSensitiveData`, `redactPayloadStrings`, etc. | **nothing** |
| `redactionGate.js` | `scanSensitiveData`, `redactPayload`, `summarizeMatches` | **nothing** |
| `experimentHistory.js` | `addExperimentRecord`, `filterExperimentHistory`, etc. | **nothing** |
| `experimentStore.js` | `saveExperiment`, `listExperiments`, `getExperimentById` | **nothing** |

Additionally, `sensitiveData.js` and `redactionGate.js` have **swapped names** — `redactionGate.js` contains scan/detect functions while `sensitiveData.js` contains the redaction engine.

**This means the previous plan's claim that "App.jsx already calls lintPrompt()" was wrong.** None of these modules are wired in. The app currently has zero lint checks, zero PII scanning, zero structured error handling, and zero experiment persistence at runtime. Everything flows through `callModel` → raw response → display.

This changes the plan. Before adding features, we must wire what exists.

---

## Guiding principles

1. **Wire before you build.** The codebase has ~1,200 lines of tested pure-logic modules sitting unused. Integrate them before writing new code.
2. **Normalize before you extend.** Fix the swapped file names and confused module boundaries so new code goes in the right place.
3. **Ship working increments.** Every milestone ends with a version bump and a CWS-publishable build.
4. **On-demand over always-on.** Use `activeTab` (user-gesture-gated) instead of `<all_urls>` content scripts.
5. **No premature storage migration.** Raw IndexedDB is fine until the schema demands relations. Let prompt versioning be the trigger.
6. **Bundle size discipline.** Target: total extension < 500 KB gzipped. Every new dependency must justify its weight.

---

## M0 — Stabilize & Wire (1 week)

> **Goal:** Zero new features. Fix the foundation so M1-M3 land cleanly.

### M0.1 — Normalize security modules

**Problem:** `redactionGate.js` contains detection/scan logic. `sensitiveData.js` contains the redaction engine. Names are backwards.

**Action:**
| Current file | Rename to | Role |
|---|---|---|
| `src/redactionGate.js` | `src/piiScanner.js` | Detection: `scanSensitiveData()`, `redactPayload()`, `summarizeMatches()` |
| `src/sensitiveData.js` | `src/redactionEngine.js` | Redaction: `detectSensitiveData()`, `redactSensitiveData()`, `redactPayloadStrings()`, settings management |

**Files touched:**
- Rename `src/redactionGate.js` → `src/piiScanner.js`
- Rename `src/sensitiveData.js` → `src/redactionEngine.js`
- Update imports in `tests/sensitiveData.test.mjs` and `tests/redactionGate.test.mjs` (in archived test suite)
- Verify 204 tests still pass

### M0.2 — Wire existing modules into the running app

Integrate the six dead modules into the actual UI:

**a) Lint checks in the editor**
- `src/App.jsx`: Import `lintPrompt` from `./promptLint`
- Show lint issues below the editor textarea (warning/info pills with one-click quick-fix via `applyLintQuickFix`)
- Trigger on `raw` text changes, debounced (300ms)

**b) Structured error handling**
- `src/App.jsx`: Import `normalizeError` from `./errorTaxonomy`
- Replace raw `catch (e) { setError(e.message) }` with `normalizeError(e)` → render `userMessage`, `suggestions[]`, and action buttons (`retry`, `open_provider_settings`)
- Wire `open_provider_settings` action to `chrome.runtime.openOptionsPage()`

**c) PII scanning before send**
- `src/App.jsx` or `src/api.js`: Import `scanSensitiveData` from `./piiScanner`
- Before each `callModel()`, run scan on the prompt text
- If matches found: show a warning modal listing detected items with "Send anyway" / "Redact & send" / "Cancel" options
- "Redact & send" calls `redactPayload()` before forwarding to background

**d) Experiment history persistence**
- `src/ABTestTab.jsx`: Import from `./experimentStore` (IndexedDB) or `./experimentHistory` (localStorage)
- **Decision:** Use `experimentStore.js` (IndexedDB with localStorage fallback) — it's the more robust implementation
- On A/B test completion, call `saveExperiment()` with the result record
- Add a "History" section to ABTestTab showing past experiments via `listExperiments()`
- **Delete** `experimentHistory.js` — it's a redundant localStorage-only version of the same concept

**Files touched:**
- `src/App.jsx` — add imports for `lintPrompt`, `normalizeError`, `scanSensitiveData`; add lint display, error rendering, PII gate
- `src/ABTestTab.jsx` — add imports for `saveExperiment`, `listExperiments`; add history UI
- `src/api.js` — optionally add PII check wrapper
- Delete `src/experimentHistory.js` (redundant)

### M0.3 — Freeze duplicate tree

**Problem:** Both `prompt-lab-source/extension/` and `prompt-lab-source/prompt-lab-extension/extension/` exist.

**Action:**
- Verify the outer `prompt-lab-source/extension/` directory contains only stale copies
- Remove or add a `DEPRECATED.md` pointing to the canonical path
- Add a note to the repo README (or a new `CONTRIBUTING.md` one-liner) identifying the canonical root

### M0.4 — Version bump → `1.4.0`

Run full test suite. Build. Smoke test all 5 providers. Ship to CWS.

**Effort:** ~8-12 hours (most time in M0.2 wiring + manual QA).
**Risk:** Low — no new logic, just connecting existing tested code.

---

## M1 — Pre-flight Engine (2-3 weeks)

> **Goal:** Prompt quality checks that run before send. Pluggable architecture with per-check toggles.

### M1.1 — PreFlight check registry

**New file:** `src/preflight.js`

```js
// Check interface:
// { id: string, label: string, category: 'pii'|'quality'|'rate'|'schema',
//   run: (context) => { pass: bool, severity: 'error'|'warning'|'info', message: string } }

export function runPreflightChecks(prompt, opts, enabledChecks) { ... }
export function getDefaultCheckConfig() { ... }  // returns { [checkId]: { enabled, mode: 'strict'|'lenient' } }
```

Checks are plain functions. The registry iterates enabled checks and collects results.

**Store config:** `chrome.storage.local` key `pl2-preflight-config` with per-check toggles and strict/lenient mode.

**UI:** Settings gear in the editor header → dropdown listing checks with on/off toggles.

### M1.2 — Quality checks (extend promptLint.js)

Add to `promptLint.js` and register as preflight checks:

| Check ID | Trigger | Severity |
|---|---|---|
| `vague_quantifier` | Uses "some", "many", "a few", "several" without numbers | `warning` |
| `missing_source_grounding` | Asks for facts but no grounding instructions ("based on", "according to", source references) | `warning` |
| `unbounded_generation` | No constraints + no examples + large max_tokens | `info` |

~50 new lines in `promptLint.js`. Registered in `preflight.js`.

### M1.3 — PII check (wraps existing scanner)

Register `piiScanner.js`'s `scanSensitiveData()` as a preflight check. This was wired in M0.2 as a modal; now it also appears in the preflight results panel.

Add new patterns to the scanner:
- IBAN: `/\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/`
- Passport (US): `/\b[A-Z]\d{8}\b/`
- Private key headers: `/-----BEGIN (RSA |EC |DSA )?PRIVATE KEY-----/`

~20 lines added to `piiScanner.js`.

### M1.4 — Rate limit tracking

**Extend:** `extension/background.js`

After each provider response, extract rate-limit headers:
- Anthropic: `x-ratelimit-remaining-requests`, `x-ratelimit-limit-requests`, `x-ratelimit-reset-requests`
- OpenAI: `x-ratelimit-remaining-requests`, `x-ratelimit-reset-requests`
- OpenRouter: `x-ratelimit-remaining-*`
- Gemini: `x-ratelimit-*`
- Ollama: skip (local)

**Important implementation detail:** The current provider functions call `response.json()` directly, which consumes the body. Must extract headers **before** parsing the body. Refactor each `callProvider()` to:
```js
const headers = Object.fromEntries(response.headers.entries());
const data = await response.json();
return { data, rateLimit: extractRateLimit(headers) };
```

Store in `chrome.storage.session` (ephemeral). Register as a preflight check that warns when < 20% remaining.

**UI:** Small pill in editor header showing remaining requests.

### M1.5 — Preflight UI

**New file:** `src/PreflightPanel.jsx`

Renders below the editor (collapsible):
- List of check results: green checkmark / yellow warning / red error per check
- Click a warning to see details + suggested fix
- "Run all" button + auto-run on send (if enabled in config)

**Files touched:**
- `src/preflight.js` (new — registry)
- `src/PreflightPanel.jsx` (new — UI)
- `src/promptLint.js` (add 3 rules)
- `src/piiScanner.js` (add 3 patterns)
- `extension/background.js` (rate limit header extraction)
- `src/App.jsx` (wire PreflightPanel, rate limit badge)
- `manifest.json` (no new permissions needed)

### M1.6 — Version bump → `1.5.0`

**Effort:** ~15-20 hours.
**Testing:** Extend battle tests for new lint rules and PII patterns. Add unit tests for `preflight.js` registry.
**Risk:** Low — all logic is pure functions. UI is additive.

---

## M2 — UX Acceleration (2-3 weeks)

> **Goal:** Reduce friction for power users. Keyboard-first workflows.

### M2.1 — Side panel migration

> Moved here from M0 per revised assessment — the popup is functional for M0-M1. Side panel becomes necessary when the UI surface grows.

**Files:**
- New: `sidepanel.html` (thin wrapper pointing to the same Vite bundle)
- `manifest.json`: Add `"side_panel": { "default_path": "sidepanel.html" }`, add `"sidePanel"` to permissions, remove `default_popup`
- `extension/background.js`: Add `chrome.action.onClicked` listener → `chrome.sidePanel.open()`
- Keep `panel.html` for dev/direct-access

**Persisted state audit:** Verify `usePersistedState` (localStorage-backed) survives panel lifecycle. Note: `usePersistedState` uses `localStorage`, not `chrome.storage` — this works in side panels but cross-context sync (e.g., options page writes, panel reads) goes through `chrome.storage.local`. Verify no conflicts.

### M2.2 — Keyboard shortcuts via `chrome.commands`

**Files:** `manifest.json`, `extension/background.js`, `src/App.jsx`

```json
"commands": {
  "enhance-prompt": {
    "suggested_key": { "default": "Ctrl+Shift+E", "mac": "Command+Shift+E" },
    "description": "Enhance current prompt"
  },
  "save-to-library": {
    "suggested_key": { "default": "Ctrl+S", "mac": "Command+S" },
    "description": "Save to library"
  }
}
```

Start with **2 high-value shortcuts** only. Add more after user feedback.

Background listens to `chrome.commands.onCommand`, forwards to panel via `chrome.runtime.sendMessage({ type: 'COMMAND', command })`. Panel dispatches.

### M2.3 — Omni-search (Cmd+K)

**New dependency:** `minisearch` (19 KB gzipped, zero transitive deps)

**New files:**
- `src/OmniSearch.jsx` — modal overlay with text input, keyboard navigation, result list
- `src/useSearch.js` — hook wrapping MiniSearch index

**Index sources:** Library entries (title, tags, collection, first 200 chars of original, first 200 chars of enhanced). Rebuild on library changes.

**Integration:** Replace existing `showCmdPalette` state in `App.jsx`. Merge command actions (enhance, save, toggle diff, switch tab) into the same palette below search results.

### M2.4 — Version bump → `1.6.0`

**Effort:** ~12-16 hours.
**Risk:** Medium — side panel migration changes the app lifecycle model. MiniSearch adds a dependency.

---

## M3 — Architectural Depth (4-6 weeks)

> **Gate:** Only begin after 1.6.0 is approved on CWS and stable for ≥1 week.

### M3.1 — On-demand context sniffing

**Approach:** `activeTab` + `chrome.scripting.executeScript()` — no persistent content script, no `<all_urls>`.

When the user clicks "Grab page context" in the panel:
1. `chrome.scripting.executeScript()` runs a function in the active tab
2. Function returns `{ title: document.title, url: location.href, selection: getSelection().toString().slice(0, 2000) }`
3. Panel shows a "Use as context" card with the snippet
4. User can prepend to prompt, dismiss, or edit before using

**Manifest changes:**
```json
"permissions": ["sidePanel", "activeTab", "scripting"]
```

No content script file needed. `executeScript` with a function is cleaner.

**Files touched:**
- `manifest.json` (add `activeTab`, `scripting`)
- `src/App.jsx` (add "Grab context" button + context card UI)

### M3.2 — Context budget visualizer

**New file:** `src/ContextBudget.jsx`

A bar below the editor showing:
- Estimated token count: `text.split(/\s+/).length × 1.3` (accurate within ~10% for English)
- Model context window from a new `MODEL_CONTEXT_WINDOWS` map in `constants.js`
- Color-coded: green < 50%, yellow < 80%, red > 80%

~80 lines. Pure UI. No dependencies.

**`src/constants.js` addition:**
```js
export const MODEL_CONTEXT_WINDOWS = {
  'claude-sonnet-4-20250514': 200000,
  'claude-opus-4-20250514': 200000,
  'claude-haiku-4-5-20251001': 200000,
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,
  'gemini-2.5-flash-preview-04-17': 1000000,
  'gemini-2.5-pro-preview-05-06': 1000000,
  // ... etc
};
```

### M3.3 — Prompt versioning

**Extend:** `src/useLibrary.js` (which already has a `versions` array on library entries!)

`useLibrary.js:77` already does:
```js
versions: [...(e.versions || []), { enhanced: e.enhanced, variants: e.variants, savedAt: e.updatedAt || e.createdAt }].slice(-10)
```

**This is already implemented for library entries.** The UI for browsing versions (`expandedVersionId`, `restoreVersion`) is already in `useLibrary.js`.

What's missing:
- Version diffing UI (show what changed between versions)
- Extend to non-library prompts (editor scratch prompts don't have versions)
- For scratch prompts: use `experimentStore.js` to persist version snapshots

**Action:**
- Add a "Version history" panel in the editor for library entries (uses existing `versions` data)
- Add `wordDiff` (already in `promptUtils.js`) to show inline diffs between versions
- For non-library prompts: optionally auto-save to `experimentStore` on each enhance action

This is lighter than originally scoped because the data model already exists.

### M3.4 — Version bump → `2.0.0`

**Effort:** ~20-25 hours.
**Risk:** High for M3.1 (CWS permission review for `activeTab` + `scripting`). Low for M3.2-M3.3.

---

## DaveLLM Integration (parallel workstream, independent of M0-M3)

**Location:** `/Users/daverobertson/Documents/DaveLLM/dave_llm_router.py`

**Current state:** FastAPI with `/chat` (custom format) and `/health`. Forwards to llama.cpp nodes at `http://127.0.0.1:9001/generate`.

**Goal:** Make DaveLLM speak Ollama's API dialect so Prompt Lab can use it as an Ollama endpoint with zero extension changes.

### DLM-1 — Add `/api/tags` endpoint

```python
@app.get("/api/tags", tags=["Ollama Compat"])
def list_models():
    """Ollama-compatible model list."""
    models = []
    for node in nodes:
        models.append({
            "name": node.get("model", "local-model"),
            "size": 0,
            "details": {
                "family": "llama",
                "parameter_size": node.get("param_size", "unknown"),
            },
            "modified_at": "2026-01-01T00:00:00Z",
        })
    return {"models": models}
```

### DLM-2 — Add `/api/chat` endpoint (Ollama-compatible)

```python
class OllamaChatMessage(BaseModel):
    role: str
    content: str

class OllamaChatRequest(BaseModel):
    model: Optional[str] = None
    messages: List[OllamaChatMessage]
    stream: Optional[bool] = False

@app.post("/api/chat", tags=["Ollama Compat"])
def ollama_chat(request: OllamaChatRequest):
    """Ollama-compatible chat endpoint."""
    # Extract last user message as prompt
    prompt = next((m.content for m in reversed(request.messages) if m.role == "user"), "")
    # Forward to existing node logic
    node_url = random.choice(NODES)
    resp = requests.post(f"{node_url}/generate", json={"prompt": prompt, "max_tokens": 256}, timeout=60)
    resp.raise_for_status()
    data = resp.json()
    answer = data.get("response") or str(data)
    return {
        "model": request.model or "local-model",
        "message": {"role": "assistant", "content": answer},
        "done": True,
    }
```

### DLM-3 — Extend node configuration

Update `nodes` list to include model metadata:
```python
nodes = [
    {"name": "mac-test-node", "url": "http://127.0.0.1:9001", "model": "llama3.2:3b", "param_size": "3B"},
]
```

### DLM-4 — (Future) Add `/v1/embeddings`

Once DaveLLM supports an embedding model, expose a compatible endpoint. This would unblock drift detection without bundling a 23MB ONNX model in the browser.

**Usage from Prompt Lab:** User sets Ollama Base URL to `http://localhost:8000` (DaveLLM's default FastAPI port). Model discovery, chat, and everything else works through existing Ollama provider code.

**Effort:** ~3-4 hours for DLM-1 through DLM-3.

---

## What we're NOT doing (and why)

| Item | Decision | Reason |
|---|---|---|
| Dexie.js migration | Skip | Raw IndexedDB wrapper is 134 lines with localStorage fallback. Works. Revisit only if M3.3 creates schema complexity that demands it. |
| js-tiktoken | Skip | 3.5 MB WASM. Word count × 1.3 is within 10% accuracy. If exact counts matter later, route through DaveLLM's `/v1/embeddings` or a server-side tokenizer. |
| Handlebars templating | Skip | `extractVars` + `{{var}}` already exists in `promptUtils.js` and is wired in `App.jsx`. Handlebars adds 25 KB and its `{{}}` syntax collides. |
| Drift detection | Defer | 23 MB ONNX model. Revisit only after DaveLLM has `/v1/embeddings`. |
| `<all_urls>` content scripts | Reject | Use `activeTab` + `chrome.scripting.executeScript()` instead. On-demand, user-gesture-gated, no persistent content script, lighter CWS review. |
| Macro triggers | Defer | No clear user demand signal. Revisit post-2.0. |

---

## Dependency budget

| Dependency | Size (gzip) | Milestone | Purpose |
|---|---|---|---|
| `minisearch` | 19 KB | M2.3 | Full-text search for library |
| **Total new deps** | **19 KB** | | |

---

## Complete file change matrix

| Milestone | New files | Modified files | Deleted files |
|---|---|---|---|
| M0.1 | — | Rename: `redactionGate.js` → `piiScanner.js`, `sensitiveData.js` → `redactionEngine.js` | — |
| M0.2 | — | `App.jsx`, `ABTestTab.jsx`, `api.js` | `experimentHistory.js` |
| M0.3 | `CONTRIBUTING.md` (one-liner) | — | — |
| M1.1 | `src/preflight.js` | — | — |
| M1.2 | — | `src/promptLint.js` | — |
| M1.3 | — | `src/piiScanner.js` | — |
| M1.4 | — | `extension/background.js` | — |
| M1.5 | `src/PreflightPanel.jsx` | `src/App.jsx` | — |
| M2.1 | `sidepanel.html` | `manifest.json`, `extension/background.js` | — |
| M2.2 | — | `manifest.json`, `extension/background.js`, `src/App.jsx` | — |
| M2.3 | `src/OmniSearch.jsx`, `src/useSearch.js` | `src/App.jsx`, `package.json` | — |
| M3.1 | — | `manifest.json`, `src/App.jsx` | — |
| M3.2 | `src/ContextBudget.jsx` | `src/App.jsx`, `src/constants.js` | — |
| M3.3 | — | `src/useLibrary.js`, `src/App.jsx` | — |

**New files total:** 6
**Deleted files:** 1 (`experimentHistory.js`)

---

## Branch strategy

```
main (stable, CWS-published)
 ├── chore/stabilize       (M0) → merge, publish 1.4.0
 ├── feat/preflight-engine (M1) → merge, publish 1.5.0
 ├── feat/ux-acceleration  (M2) → merge, publish 1.6.0
 └── feat/arch-depth       (M3) → merge, publish 2.0.0
```

DaveLLM work happens in its own repo (`/Users/daverobertson/Documents/DaveLLM/`) on `main` — no branch needed for 3-4 hours of work.

---

## Version timeline

| Version | Milestone | Key deliverable |
|---|---|---|
| `1.4.0` | M0 | Dead modules wired in, file names normalized, foundation stable |
| `1.5.0` | M1 | PreFlight engine with quality/PII/rate checks + toggleable config |
| `1.6.0` | M2 | Side panel, keyboard shortcuts, omni-search |
| `2.0.0` | M3 | Context sniffing, budget visualizer, prompt versioning UI |
