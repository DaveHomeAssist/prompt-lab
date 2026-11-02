# November intake and first implementation slice

Status: active supporting brief. Decisions below remain Open unless explicitly recorded as approved.

Date: November 2, 2026. Requested order: backlog, scoped brief, then begin implementation. Baseline: main aad2b55. Existing sprint membership is unchanged.

## Tracked requests

### N01: Copy individual code blocks

[Issue](https://app.notion.com/40c255fc8f448150a92efe8b618c509c). Each rendered fenced code block has a keyboard accessible Copy code button. Copy exact code text without fences or language label; preserve whitespace, Unicode and literal markup. Show success only after clipboard acknowledgement, show failure with retry. Verify multiple blocks, both themes and narrow layouts.

### N02: Chat with AI inside Prompt Lab

[Issue](https://app.notion.com/40c255fc8f44816e8a27e0a1b10c6ee6). Explore a conversation alongside prompt authoring with explicit context selection and an action to apply or save a useful response. Reuse provider selection, cancellation, privacy and quota controls. Decide conversation retention and whether chat is a panel or destination before implementation.

### N03: Bulk edit prompt icons tags and metadata

[Issue](https://app.notion.com/40c255fc8f4481aeb3c9e2dce700ed1c). Select multiple prompts, preview scope, apply icons, tag additions/removals and explicit metadata fields; preserve unselected prompts and detect stale edits. Surface write failures. Define editable field allowlist and mixed-value handling before implementation.

### N04: Name custom labels and coordinate their colors

[Issue](https://app.notion.com/40c255fc8f4481ad982ed9c6ca30edf6). Create named labels paired with colors; display text as well as color and filter by label. Define compatibility with existing tags before changing storage. Labels survive reload and export/import.

### N05: Suggest smart tags for prompts

[Issue](https://app.notion.com/40c255fc8f448192b4eefbd9c9d11b31). Suggest relevant tags and preview changes for user acceptance. Reuse existing tagging work where present; no silent tagging or provider calls. Define local rule suggestions first, with semantic suggestions a later explicit choice.

### N06: Save smart groups and folder rules

[Issue](https://app.notion.com/40c255fc8f4481da84d6ca5f401b337a). Create named dynamic groups from existing filters. Membership updates as matching metadata changes without moving or deleting prompts. Distinguish a saved query from a physical folder; preserve existing collections.

### N07: Choose app and Scratch fonts and text size

[Issue](https://app.notion.com/40c255fc8f44814d9862ca0464767a77). Offer three font families and selectable text sizes in Settings, with independent Scratch override and inherit option. Proposed families: system sans, serif and monospace without remote font requests. Persist settings, preserve code readability and check narrow layouts.

### N08: Extract a reusable generic template

[Issue](https://app.notion.com/40c255fc8f44818b844ece5f2cd6336c). Add a transformation that generalizes supplied prompt specifics into a reusable template with deliberate variables. This differs from existing neutral General enhance mode. Preserve the source and let the user review/save separately. Define placeholder and sensitive-data behavior before implementation.

### N09: Enhance skill instructions

[Issue](https://app.notion.com/40c255fc8f4481c9a715e8b5f7ffd58c). Improve supplied skill instructions while preserving intended scope, triggers, inputs, outputs and constraints. This is prompt authoring, separate from executing Skill Lab workflows. Preserve source and show reviewable output.

### N10: Author and enhance system prompts

[Issue](https://app.notion.com/40c255fc8f4481668168f6da751a37bb). Offer a system-prompt authoring mode with clear role, constraints, precedence and output behavior; preserve provider/model independence and source text. Do not infer permissions or execute generated instructions.

### N11: One formatted Scratch editor

[Existing issue](https://app.notion.com/p/2cb0cb70403440e3bc223c225408b4e9). Reaffirm approved October D-INT-1: live-preview Markdown with syntax visible only on the edited line and Markdown storage. Run a cross-shell spike before replacing Write/Split/Preview. Verify selection, undo, keyboard, code blocks, reload, export/import and failed-save recovery. Binary RTF migration is outside this slice.

### N12: Agent enhance

[Existing issue](https://app.notion.com/p/40b255fc8f44817d98dae197c1b19ddb). Extend Agent/Notion authoring with this renewed request. Preserve goals, tools, permissions, constraints, completion and handoffs, plus the existing result variants. Execution remains a separate capability.

## First slice: code block copying

Problem: fenced code in Markdown previews needs manual selection to copy. Outcome: each fenced block exposes Copy code, reachable by pointer and keyboard. Activate it, wait for clipboard acknowledgement and show Copied within that block. Failure keeps code selectable and permits retry. Copy only decoded code without fences or language markers, preserving indentation, blank lines, Unicode and literal markup. Include unfinished fences.

Implementation: extend the escaped Markdown renderer with static controls and delegate clicks through MarkdownPreview. Keep controls above the code in normal flow, inheriting theme colors, with wrapping feedback. Shared React preview covers web, desktop and extension. Independent Swift editor and diagnostic pre elements are excluded. No dependencies, API, permission requests, schema/save changes or model calls.

Risks: clipboard permission and secure-context differences. Missing/rejected APIs must show failure. Keep long code within its scrolling panel and escaped source inert.

Acceptance: exact-text and per-block component regressions; pending acknowledgement and failure/retry; missing API and escaped markup; extension build; browser clipboard/keyboard and layout checks in light/dark at375x812,1440x900 and3840x1080. Required PR checks, merge, deployment and live acceptance are separate gates. Done requires full acceptance.

## Later decisions

Recommendations remain Open, without blocking the first slice.

- D-NOV-1 Chat: A (recommended) contextual authoring panel, B separate conversation destination. A keeps prompt context nearby; B gives conversations more space. Define retention and explicit context inclusion before provider calls.
- D-NOV-2 Labels: A (recommended) named colors on existing tags, B separate labels. A reduces duplicate classification; B expands storage/export contracts.
- D-NOV-3 Smart groups: A (recommended) saved local filter rules, B semantic suggestions with explicit provider consent. A is deterministic and offline; B adds cost/privacy decisions.
- D-NOV-4 Fonts: A (recommended) system sans, serif and monospace, B three bundled families. A avoids requests/dependencies; B fixes typography at a bundle cost.

Next: finish N01 verification and delivery, then select the next bounded slice.

