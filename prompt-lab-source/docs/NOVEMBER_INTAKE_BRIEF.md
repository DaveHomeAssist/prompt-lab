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

## First slice delivery

[PR308](https://github.com/DaveHomeAssist/prompt-lab/pull/308) merged as fdd0abf after all 16 checks passed on the identical application tree. The production deployment is READY and the served application carries the revision and copy control. Dominic Node 22.23.4 passed 13 focused tests, extension build and actual clipboard paste/keyboard checks at 375, 1440 and 3840 pixels, including actual light/dark switching. CI passed 1,700 shared tests, 231 legacy tests, 108 hosted browser checks with one skip, 25 landing checks, four desktop package acceptance jobs and macOS universal packaging/diagnostics. Signed-in production clipboard interaction and physical/human acceptance remain unverified; the issue stays In progress.

Next: verify signed-in production copying, then select the next bounded slice.

## Signed-in Copy code acceptance

November 2: visible production b4f08ab, signed in as Owner Pro, passed exact clipboard readback for five independent blocks: whitespace/blank lines, Unicode/emoji and literal markup, a second block, empty code, a long line and an unfinished fence. Keyboard use passed. Light/dark and 375x812, 1440x900 and 3840x1080 checks passed with no page overflow. Delayed acknowledgement, rejection, missing write API and successful retry were exercised with temporary test-tab overrides that were removed. Original empty clipboard, theme and viewport were restored. A synthetic Scratch note remains for inspection; no Library prompt was changed or provider called. N01 is Done; broader product acceptance remains separate.

## N02 implementation slice: contextual chat

Dave's November 2 continuation directs proceeding with best available context without confirmation. Choose the recommended contextual Write panel as the implementation default for D-NOV-1. Keep messages in page memory only, retained while the panel closes and reopens, cleared by reload or New chat. This is a scoped default under the current instruction, not a claim of an earlier user answer. Persistent conversations remain a later decision.

Problem: trying a prompt currently needs another app and manual copying between workspaces. Outcome: a multi-turn AI conversation beside Write with an explicit way to turn a useful reply into a new prompt.

Flow: open Chat beside Write; enter a message; optionally include the current prompt using an unchecked control with a visible context preview; Send through the current Provider Settings. Render replies as escaped Markdown with code block copying. Offer Cancel during a request, New chat, Copy reply and Use as new prompt. Use starts a new draft through the existing recoverable handoff, so normal Library Save remains explicit. Close/reopen keeps the page-session conversation; no send occurs on open. Explain page-session retention and normal provider usage.

Ownership: App owns one chat controller for the page. The panel renders it. A pure payload builder maps successful message pairs into the existing provider-independent chat envelope. One synchronous request guard prevents duplicate sends; AbortController cancels transport and a request identity rejects late results. Prompt identity changes clear the conversation. Including or removing prompt context starts a new conversation; editing included context aborts pending work and clears the earlier context. Pending sensitive-data approval belongs to the exact composed message, transcript and context. Provider changes invalidate approval and cancel the active request. No raw settings or keys enter messages.

Data and API effects: no new endpoint, provider, secret, storage schema, dependency or persistent chat key. Existing callModel, sensitive-data preflight, error taxonomy, provider/model settings and hosted quota controls stay authoritative. Request output is bounded to 1024 tokens; reject overlong conversations with explicit guidance rather than silently dropping context. No automatic retries or background requests. Redacted sends retain the actual redacted message history. No agent/tool execution or automatic actions from model replies.

Acceptance: real multi-turn envelopes; explicit context and privacy review including prior turns; double-send guard; cancellation and ignored late success; error/retry without duplicate turns; context/owner/provider changes; close/reopen retention and reload clearing; recoverable reply handoff and normal Save. Browser checks cover both themes, keyboard, no page overflow at phone/desktop/ultrawide and no call on open. Use mocked transport for deterministic failure cases, then verify the delivered UI visibly in signed-in production with synthetic content and a bounded real chat request. Keep N02 In progress until applicable CI, merge, deployment and interaction acceptance pass.
