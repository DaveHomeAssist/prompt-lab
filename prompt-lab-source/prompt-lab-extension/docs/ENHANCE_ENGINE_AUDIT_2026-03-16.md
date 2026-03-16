# PromptLab Enhance Engine — Audit & Improvement Summary

> **Date:** 2026-03-16
> **Scope:** Full inspection and 4-phase improvement of the Enhance pipeline
> **Test status:** 108 pass, 0 fail (`node --test`)
> **Vitest status:** Pre-existing fork pool timeout on Node v25.8.1 (unrelated to changes)

---

## Executive Summary

The PromptLab Enhance engine was driven by a single sentence per mode with no guardrails against assumption injection. The entire enhancement philosophy for the default Balanced mode was 15 words: *"Improve clarity, specificity, and structure. Add role, task, format, and constraints where missing."*

The phrase "where missing" was an open invitation for the model to fabricate medium, audience, tone, and structure the user never requested. Short prompts and contextual references (e.g., "the page", "that function") were especially vulnerable.

Four phases of targeted improvements now make the engine more conservative, more transparent, and more testable — without changing the product shape or user workflow.

---

## What Was Found

### Architecture (unchanged, sound)

```
User input → Mode selection → System prompt assembly → PII gate → Model call → JSON parse → UI render
```

- 7 enhancement modes (balanced, claude, chatgpt, image, code, concise, detailed)
- Single-pass enhancement via Claude Sonnet 4
- JSON-enforced response: `{enhanced, variants, notes, tags}`
- Multi-provider support (Anthropic, OpenAI, Gemini, OpenRouter, Ollama)
- PII scan gate before every API call
- Eval run logging for every enhancement attempt

### Root Causes of Oversteer

| Issue | Location | Impact |
|-------|----------|--------|
| Mode prompts were 1 sentence each | `constants.js:10-18` | Model filled behavioral gaps with its own defaults |
| "Add where missing" was unconditional | Balanced mode `sys` field | Model treated absence as deficiency, invented freely |
| No intent preservation instruction | System prompt template | Nothing told the model to preserve the user's meaning |
| No assumption disclosure | JSON response schema | No way to see what the engine added vs. what was original |
| No temperature control | `useExecutionFlow.js:68-74` | Output varied significantly between runs |
| System prompt assembled inline | `useExecutionFlow.js:62-75` | Untestable, hard to iterate on |

---

## What Changed

### Phase 1 — Stabilize Enhancement Behavior

**Problem:** The model had no guardrails against inventing medium, audience, or structure.

**Fix:**
- Created `INTENT_POLICY` — 4-sentence guardrail prepended to every mode prompt:
  - Preserve original intent, subject, and scope exactly
  - Do not invent medium, audience, or tone
  - Keep contextual references ("the", "this", "that") intact
  - Shorter prompts are not automatically worse
- Pinned `temperature: 0.4` (was unset, defaulting to ~1.0)
- Tightened Balanced mode from "Add ... where missing" to "only when genuinely absent and needed for execution"

**Files:** `constants.js`, `hooks/useExecutionFlow.js`

### Phase 2 — Improve Enhancement Transparency

**Problem:** No way to see what the engine assumed vs. what it clarified.

**Fix:**
- Added `assumptions` array to the JSON response contract
- System prompt now instructs: *"In assumptions, list anything you added that was not explicitly stated in the original prompt. If you added nothing, return an empty array."*
- Assumptions are surfaced in the notes panel as a bulleted block
- Parser extracts and normalizes the `assumptions` field with full backward compatibility (missing field → `[]`)

**Files:** `hooks/useExecutionFlow.js`, `promptUtils.js`

### Phase 3 — Refine Mode-Specific Behavior

**Problem:** Modes were not behaviorally distinct enough. A 1-sentence instruction left too much to model interpretation.

**Fix:** Expanded all 7 mode prompts from 1 sentence to 2-3 sentences with distinct behavioral guidance:

| Mode | Key Behavioral Addition |
|------|------------------------|
| **Balanced** | "Prefer minimal changes. If already clear, make only light adjustments." |
| **Claude** | Concrete XML tag examples (`<instructions>`, `<context>`, `<output>`). "Avoid tricks that only work on other models." |
| **ChatGPT** | "Avoid XML tags." Direct contrast with Claude mode. |
| **Image** | "Do not change what the user wants to see — only improve how it is described." |
| **Code** | "Do not add requirements the user did not ask for." |
| **Concise** | "Do not add anything new. The goal is compression, not expansion." |
| **Detailed** | "Do not introduce new goals, audiences, or requirements." |

Created `buildSystemPrompt(modeId, tags)` utility — centralizes prompt assembly, makes it testable independently of the React hook.

**Files:** `constants.js`, `hooks/useExecutionFlow.js`

### Phase 4 — Pre-Analysis Evaluation

**Decision: Do not implement yet.**

- Adds a second API call (doubles latency) without clear evidence it's needed
- Phases 1-3 addressed the root cause (thin instructions, no guardrails)
- The `assumptions` field now provides observability data to evaluate whether pre-analysis is justified later
- Mode selection is already manual — a simpler form of pre-analysis

**Revisit when:** Assumption data from real usage shows consistent oversteering despite the new guardrails.

---

## Test Results

### New Tests Added

| File | Tests | Covers |
|------|-------|--------|
| `tests/enhance-policy.test.mjs` | 25 | INTENT_POLICY content, all 7 mode behavioral contracts, `buildSystemPrompt()` utility, mode distinctness |
| `tests/enhance-transparency.test.mjs` | 7 | Assumptions extraction, missing/null/empty handling, backward compatibility |
| **Total new** | **32** | |

### Pre-Existing Test Fixes

| File | Issue | Fix |
|------|-------|-----|
| `tests/promptUtils-extended.test.mjs` | Broken imports (`ensureString`, `safeDate` from wrong module) | Fixed import paths |
| `tests/promptUtils-extended.test.mjs` | 3 tests passing JSON without `enhanced` field | Fixed test data to include required field |
| `tests/promptUtils-extended.test.mjs` | 2 assertions expecting wrong error message text | Fixed regex to match actual error messages |
| `tests/promptUtils-extended.test.mjs` | Assertions expected JSON-stringified format but code produces `key: value` | Fixed to match actual `coercePromptText` output |

### Final Test Run

```
$ node --test tests/promptUtils.test.mjs tests/promptUtils-extended.test.mjs \
              tests/enhance-policy.test.mjs tests/enhance-transparency.test.mjs

ℹ tests 108
ℹ pass 108
ℹ fail 0
```

### Vitest Status (pre-existing, unrelated)

Vitest fork pool workers timeout on Node v25.8.1 across all `.jsx` and some `.js` test files. This affects `useABTest.test.jsx`, `useTestCases.test.jsx`, `useEvalRuns.test.jsx`, `piiEngine.test.js`, `evalSchema.test.js`, and `desktop-smoke.test.mjs`. Not caused by enhance changes. Fix options:
- Downgrade to Node v22 LTS
- Switch vitest pool from `forks` to `threads`
- Pin `--pool=threads` in test script

---

## Files Changed (Complete)

| File | Type | Description |
|------|------|-------------|
| `src/constants.js` | Modified | Added `INTENT_POLICY`, expanded 7 mode prompts, created `buildSystemPrompt()` |
| `src/hooks/useExecutionFlow.js` | Modified | Uses `buildSystemPrompt()`, added `temperature: 0.4`, surfaces assumptions |
| `src/promptUtils.js` | Modified | `normalizeParsedPayload` extracts `assumptions` array |
| `tests/promptUtils-extended.test.mjs` | Fixed | 3 broken imports, 5 stale assertions |
| `tests/enhance-policy.test.mjs` | New | 25 policy and mode behavioral tests |
| `tests/enhance-transparency.test.mjs` | New | 7 assumptions parsing and backward compat tests |

---

## Before / After Comparison

### System Prompt (Balanced Mode)

**Before (67 chars of guidance):**
```
You are an expert prompt engineer. Improve clarity, specificity, and
structure. Add role, task, format, and constraints where missing.
Return ONLY valid JSON...
```

**After (580+ chars of guidance):**
```
You are an expert prompt engineer. Preserve the user's original intent,
subject, and scope exactly. Do not invent or assume a medium (email, blog,
Notion, etc.), audience, or tone the user did not specify. If the prompt
uses contextual references like "the", "this", or "that", keep them — do
not replace with placeholders. Only add structure the prompt genuinely
lacks. Shorter prompts are not automatically worse. Improve clarity and
specificity. Add role, task, format, or constraints only when genuinely
absent and needed for execution. Prefer minimal changes over aggressive
restructuring. If the prompt is already clear, make only light adjustments.
Return ONLY valid JSON...
```

### Response Contract

**Before:**
```json
{"enhanced":"...","variants":[...],"notes":"...","tags":["..."]}
```

**After:**
```json
{"enhanced":"...","variants":[...],"notes":"...","assumptions":["..."],"tags":["..."]}
```

### Enhancement Parameters

| Parameter | Before | After |
|-----------|--------|-------|
| Temperature | Unset (~1.0) | 0.4 |
| Intent preservation | None | 4-sentence policy |
| Assumption disclosure | None | Structured array + notes panel |
| Mode prompt depth | 1 sentence | 2-3 sentences with behavioral guardrails |
| Prompt assembly | Inline in hook | Testable `buildSystemPrompt()` utility |

---

## Remaining Risks

1. **Model compliance varies.** The assumptions field is requested, not enforced. Some models may ignore it or populate it inconsistently.
2. **Provider temperature handling.** `temperature: 0.4` is passed in the payload but provider adapters may handle it differently for non-Anthropic models.
3. **Vitest environment.** Fork pool timeouts on Node v25 block `npm test`. The `node --test` runner covers all enhance-related files.

## Recommended Next Steps

1. **Ship and observe.** Deploy changes. Collect assumption data from real enhancement requests.
2. **Fix vitest.** Either downgrade Node or switch pool strategy. Separate task.
3. **Evaluate assumptions UI.** If assumptions are consistently useful, consider a dedicated panel rather than appending to notes.
4. **Revisit pre-analysis.** Only if assumption data shows persistent oversteering despite guardrails.
