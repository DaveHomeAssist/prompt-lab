# Prompt system architecture

> The model does not execute templates. It only responds to fully resolved input.

This document captures the mental model, architecture, and build principles for how PromptLab treats prompts as compiled artifacts rather than instructions sent raw to an LLM.

---

## Core principle

The LLM is a pure function at the end of your pipeline — not the pipeline itself.

Everything that feels "smart" — variable handling, data binding, workflow logic, validation, bullet enforcement — is your responsibility upstream. The model's only job is formatting and tone enforcement on clean, validated, fully resolved input.

If the model is doing gap-filling, inferring missing fields, or producing inconsistent output, the problem is almost always in layers 1–4, not in the prompt itself.

---

## The 5-layer pipeline

```
Data Sources
     ↓
Normalization Layer
     ↓
Validation Layer
     ↓
Prompt Compiler
     ↓
LLM (formatter only)
     ↓
Output
```

### Layer 1 — Data sources

Raw, inconsistent, unformatted input. Notion databases, GitHub status, manual entry, API payloads.

No assumptions about cleanliness. Everything downstream must treat layer 1 as untrusted.

### Layer 2 — Normalization layer

**This is the current build gap in PLB.** *(as of 2026-03-27 — see D-001 in DECISIONS.md)*

Responsibilities:
- Trim bullets to signal-only items
- Enforce tense consistency (past for shipped, present continuous for in-progress, imperative for next actions)
- Cap bullet counts per section before the LLM ever sees them
- Drop vague or low-signal entries ("worked on stuff", "made progress")
- Normalize phrasing to a consistent register

Why this matters: if normalization happens inside the prompt as LLM instructions, outputs are non-deterministic. If it happens upstream in code, outputs are consistent and debuggable.

### Layer 3 — Validation layer

Schema enforcement before the LLM call fires. Fail fast here rather than getting malformed output downstream.

Minimum validation schema:
```json
{
  "required": ["date", "repo", "branch", "audience"],
  "properties": {
    "audience": { "enum": ["team", "stakeholder", "public"] },
    "shipped": { "type": "array" },
    "in_progress": { "type": "array" },
    "blocked": {
      "type": "array",
      "items": { "required": ["owner", "blocker", "next_action"] }
    }
  }
}
```

Unresolved `{{ }}` detection belongs here. Any template token that survived normalization is a hard block — do not proceed to the compiler.

### Layer 4 — Prompt compiler

Takes fully normalized, validated data and injects it into the template structure. Produces a single resolved string — the execution artifact.

The compiled prompt is what gets sent to the LLM. Nothing unresolved should exist at this stage.

Dry run mode intercepts here: show the compiled prompt, bullet counts per section, and any flagged fields before the API call fires. This is the highest-ROI debug feature in the pipeline.

### Layer 5 — LLM (formatter only)

Receives only clean, validated, count-enforced input. Responsibilities are narrow:
- Apply tone rules for the specified audience
- Enforce tense on output text
- Format into the defined output structure

The LLM should not be reasoning about what to include, filling in missing context, or making judgment calls about signal quality. All of that happened upstream.

---

## Bullet budget enforcement

Enforce upstream in code, not as LLM instructions.

```
total = shipped + in_progress + blocked + risks + next_24_48h
max = 12

truncation priority (last to cut → first to cut):
  blocked → risks → shipped → next → in_progress
```

Note: blocked and risks are highest signal and should survive truncation longest. The original recommendation to truncate blocked first is inverted here — blocked items are often the most important thing in a status update.

---

## Input format

For human-in-the-loop use, structured markdown is faster and less error-prone than JSON:

```markdown
- Repo: prompt-lab
- Branch: main
- Audience: team

Shipped:
- TDZ crash fix deployed to Vercel
- SSE parser moved into providerRegistry

In progress:
- App.jsx Phase 2 component extraction
```

For machine-generated input (Notion API, GitHub Actions), enforce JSON:

```json
{
  "date": "2026-03-27",
  "repo": "prompt-lab",
  "branch": "main",
  "audience": "team",
  "shipped": ["TDZ crash fix deployed", "SSE parser refactor merged"],
  "in_progress": ["App.jsx Phase 2 extraction"],
  "blocked": [],
  "risks": [],
  "next_24_48h": ["Wire Notion Sprint Tracker as task source"]
}
```

Support both. The normalization layer handles the format difference. The compiler produces the same resolved artifact either way.

---

## PLB current state vs target state

| Layer | Current state | Target state |
|---|---|---|
| 1. Data sources | Manual paste, Notion MCP | Notion API + GitHub automated feeds |
| 2. Normalization | Inside prompt as LLM instructions | Upstream resolver function in code |
| 3. Validation | PLB linter — unresolved `{{ }}` detection | Full JSON schema validation, fail-fast |
| 4. Prompt compiler | PLB Add button — compiled preview | Explicit dry-run mode with field audit |
| 5. LLM | Claude via DaveLLM Router | Same, with audience tone enforcement |

---

## Failure modes and causes

| Symptom | Root cause | Fix |
|---|---|---|
| Blank structured output | Unresolved `{{ }}` passed to LLM | Layer 3 catch — block execution |
| Model ignores sections | Empty inputs trigger omit rules | Layer 2 — explicit empty vs missing distinction |
| Generic filler in output | Model forced to guess missing data | Layer 2 normalization before compile |
| Inconsistent formatting | Partial resolution or mixed input formats | Layer 4 — single resolved artifact only |
| Bullet count exceeded | Enforcement left to LLM instructions | Layer 2 — enforce count in code |

---

## Dry run mode spec

Before any LLM call, expose:

```
COMPILED PROMPT PREVIEW
-----------------------
Repo: prompt-lab
Branch: main
Audience: team

Shipped (2 bullets):
- TDZ crash fix deployed to Vercel
- SSE parser moved into providerRegistry

In progress (1 bullet):
- App.jsx Phase 2 extraction

Blocked: none
Risks: none
Next 24-48h (1 bullet):
- Wire Notion Sprint Tracker as task source

TOTAL BULLETS: 4 / 12 max
UNRESOLVED TOKENS: none
MISSING REQUIRED: none

[ Send to LLM ] [ Cancel ]
```

---

## One-line rules (burn these in)

- If you see `{{ }}`, you are in template mode, not execution mode
- Resolver = thinking. LLM = formatting.
- Never compensate for bad inputs with a smarter prompt
- If the output is wrong, the bug is upstream of the LLM
- Make the LLM dumb on purpose

---

*Last updated: 2026-03-27*
*Source: Claude conversation — prompt pipeline architecture discussion*
*Related: CLAUDE.md, PIPELINE.md, DECISIONS.md*
