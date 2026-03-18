# Feature Spec: Preset Packs

**Priority:** Backlog — after Ghost Variables and Golden Response
**Scope:** ~300-400 lines across 5-6 files
**Risk:** Low — additive feature, no existing behavior modified
**Schema:** See `docs/preset-pack-schema.json` for the full data contract

---

## Problem

Prompt Lab currently stores individual prompts in a flat library. Users build up collections of related prompts (e.g., "UI audit prompts", "code review prompts") but have no way to:

1. Group prompts into themed packs
2. Run prompts in a defined sequence (chains)
3. Share a collection as a single importable unit
4. Track which prompts in a pack they've already run

## Solution

Add a **Preset Pack** system — a lightweight layer on top of the existing prompt library that groups prompts into named packs with metadata, chains, and variable inputs.

---

## Schema Overview

A preset pack is a JSON object with this shape:

```
pack
├── id, title, description, tags, status
├── presets[]
│   ├── id, title, category, summary
│   ├── inputs[] (dynamic form fields with {{variable}} placeholders)
│   ├── prompt (template string with {{variables}})
│   ├── outputFormat (expected sections in the response)
│   └── modelHints (suggested model, temperature)
└── chains[]
    ├── id, title, description
    ├── steps[] (ordered preset IDs)
    └── rules[] (execution constraints)
```

### Key Design Decisions

**Why `inputs[]` with `{{variables}}`?**
Prompt Lab already has a variable system (`{{var}}` syntax in `promptSchema.js`). Preset inputs extend this by defining the form fields upfront — label, type, placeholder, required. The existing `compilePrompt` logic handles substitution. This means preset packs work with the existing variable UI with zero refactoring.

**Why `chains[]`?**
The UI audit prompts in this session revealed a natural execution order (navigation → CTA → hierarchy → density → micro → anticipatory → reactive → performance). Each pass depends on preserving the output of the previous pass. Chains encode this dependency as an ordered step list with rules like "output only net-new changes."

**Why `modelHints`?**
Different prompts work better with different models. A microinteraction prompt works fine with Sonnet, but a complex architecture prompt benefits from Opus. Model hints let the pack author suggest the best model without forcing it.

**Why `outputFormat.sections[]`?**
When a prompt says "OUTPUT FORMAT: 1. Interaction Map 2. UI Changes 3. Keyboard Shortcut Map", the response should be parseable into those sections. The `sections` array lets the UI render structured output cards instead of a raw text blob. This connects to the existing `renderMarkdown()` pipeline.

---

## Data Flow

```
Import JSON → validate against schema → store in localStorage
                                         ↓
                              Render pack sidebar
                              Render preset cards
                                         ↓
                              User selects preset
                              Dynamic input form rendered from inputs[]
                              User fills {{variables}}
                                         ↓
                              compilePrompt(template, formData)
                              Compiled prompt shown in preview
                                         ↓
                              User clicks Run or Copy
                              Response stored in run history
```

## Storage

```javascript
// Keys
"pl-prompt-packs"      // Array of pack objects
"pl-prompt-ui-state"   // Active pack, preset, filters, form data
"pl-prompt-history"    // Run history with compiled prompts and responses
"pl-prompt-favorites"  // Favorited preset IDs
```

## UI Components

| Component | Purpose |
|---|---|
| `PresetPackSidebar` | Pack list, chain list, tag/category filters |
| `PresetCardList` | Searchable grid of preset cards within active pack |
| `PresetCard` | Summary, tags, status badge, quick actions |
| `PresetDetailPanel` | Full prompt, input form, compiled preview |
| `PromptInputForm` | Dynamic fields rendered from `inputs[]` |
| `CompiledPromptPanel` | Final rendered prompt with copy button |
| `ChainRunnerPanel` | Step-by-step chain execution with progress |
| `RunHistoryPanel` | Prior outputs with timestamps and diffs |

## Chain Execution

When running a chain:

1. Show all steps with current step highlighted
2. For each step, render the preset's input form
3. User fills inputs and runs the prompt
4. Output is saved and displayed
5. User advances to next step (or skips)
6. Previous step outputs are visible for reference
7. Chain rules are displayed as a constraint bar at the top

## Variable Compilation

Uses the same logic as existing `{{variable}}` handling:

```javascript
function compilePrompt(template, formData) {
  return template.replace(/\{\{(.*?)\}\}/g, (_, key) => {
    const value = formData[key.trim()];
    return value == null ? "" : String(value);
  });
}
```

## Import/Export

- **Import**: User drops a `.json` file or pastes JSON. Schema validated before storage.
- **Export**: Single pack exported as `.json` with all presets and chains.
- **Share**: URL with base64-encoded pack (for small packs) or download link.

## Relationship to Existing Features

| Existing Feature | How Preset Packs Interact |
|---|---|
| Prompt Library | Packs are a grouping layer on top of library entries |
| Variables (`{{var}}`) | Preset `inputs[]` define the variable form; compilation reuses existing logic |
| Version Snapshots | Each preset run can be versioned like a regular prompt |
| Golden Response | Chain outputs can be compared against golden responses |
| Ghost Variables | Ghost vars (clipboard, date) work inside preset templates |

## First Pack: UI Enhancement

The schema file includes 9 presets and 1 chain as a working example:

1. Navigation Simplification
2. CTA Clarity Optimization
3. Visual Hierarchy Compression
4. Interaction Density
5. Microinteraction System
6. Anticipatory UX
7. Reactive UI States
8. Perceived Performance
9. Single-File UI Optimization

Chain: `ui-audit-stack` — runs 1-8 in order with preservation rules.

---

## Implementation Order

1. Schema validation (`validatePresetPack(json)`)
2. Import/export UI (file drop + JSON paste)
3. Pack sidebar + preset card list
4. Preset detail panel with input form
5. Compiled prompt preview + copy
6. Run history storage
7. Chain runner UI
8. Favorites
