# Enhancement Council product and technical specification

## Status

- Status: `active`
- Updated: `2026-08-20`
- Scope: shared PromptLab frontend, provider layer, evaluation store, extension,
  desktop, and hosted web app
- Intended delivery: incremental feature behind an explicit capability flag

## Purpose

PromptLab currently performs enhancement as one model call. A valid structured
response is accepted even when the proposed prompt is unchanged or the model
claims that no improvement is needed without demonstrating that claim.

Enhancement Council adds an opt-in execution strategy that asks multiple
independent council members to improve the same prompt, then uses a blind judge
to select or synthesize the strongest result. The feature is intended to reduce
single-model blind spots, make disagreement inspectable, and establish a real
quality floor without replacing the existing fast enhancement path.

This specification defines the product behavior, execution architecture, data
contracts, failure handling, cost controls, accessibility requirements, testing
gates, and rollout sequence.

## Source of truth

This specification is grounded in the current shared implementation:

- `prompt-lab-extension/src/constants.js`
- `prompt-lab-extension/src/hooks/useExecutionFlow.js`
- `prompt-lab-extension/src/hooks/useABTest.js`
- `prompt-lab-extension/src/lib/platform.js`
- `prompt-lab-extension/src/lib/desktopApi.js`
- `prompt-lab-extension/src/lib/providers.js`
- `prompt-lab-extension/src/lib/providerRegistry.js`
- `prompt-lab-extension/src/lib/enhancementResult.js`
- `prompt-lab-extension/src/lib/evalSchema.js`
- `prompt-lab-extension/src/PostEnhanceResults.jsx`
- `api/proxy.js`

`ARCHITECTURE.md` remains the canonical runtime architecture document. The
versioned enhance contract remains the cross-surface contract authority for
Quick enhancement. Council-specific fields must not be added to that contract
until the React and native parity work is intentionally scheduled.

If this document conflicts with shipped code, shipped code describes current
behavior and this document describes the accepted target.

## Terminology

| Term | Meaning |
|---|---|
| Quick | Existing single-model enhancement strategy. |
| Council | Multi-member enhancement followed by blind judgment. |
| Enhancement mode | Balanced, Claude, ChatGPT, Image Gen, Code Gen, Concise, or Detailed. |
| Execution strategy | Quick or Council. This is independent from enhancement mode. |
| Member | One isolated provider/model/lens execution that returns an enhancement proposal. |
| Lens | A bounded review emphasis added to the shared mode policy. |
| Judge | The final model call that receives anonymized proposals and returns scores plus a final result. |
| Council run | One logical user action containing member calls, judgment, and any bounded correction call. |
| Proposal | A member's structured candidate and supporting analysis. |
| Synthesis | A final result composed from useful parts of multiple proposals. |

## Product principles

1. Council is a quality strategy, not a new enhancement mode.
2. Quick remains the default and retains its current latency and cost profile.
3. Every member works independently. Members never see peer responses.
4. Judgment is blind to provider and model identity.
5. The final result must remain compatible with PromptLab's existing Improved,
   Tighter, and Strict JSON result workflow.
6. A no-change result requires evidence. Generic praise is not a successful
   enhancement.
7. Cost, provider count, progress, partial failure, and cancellation must be
   truthful and visible.
8. Council must never silently multiply requests because a strategy persisted
   from an earlier prompt or session.
9. Full member output is execution evidence, not Library content. Saved prompts
   retain compact Council provenance while run history owns the detailed trace.
10. Provider diversity is preferred, but the UI must distinguish a multi-model
    council from one model operating through multiple lenses.

## Goals

1. Produce a materially useful enhancement when one model would return a no-op.
2. Expose meaningful agreement and disagreement without overwhelming the main
   result view.
3. Reuse the existing provider registry, result UI, run store, and portable
   export model.
4. Preserve the original prompt, selected enhancement mode, and assumptions
   through every member and judge call.
5. Keep the maximum number of provider calls bounded and cancelable.
6. Continue safely when one member fails.
7. Give users a direct path from Council output to save, version, copy, Compose,
   A/B testing, and run history.

## Non-goals

- No free-form conversation among council members.
- No recursive debate or unbounded agent loop.
- No automatic Council execution for every enhancement.
- No replacement of Model Arena or prompt A/B testing.
- No automatic provider-key provisioning.
- No provider leaderboard based on pooled user data.
- No hidden server-side use of providers the user has not configured or the
  hosted service has not explicitly enabled.
- No native SwiftUI implementation in the first delivery slice.
- No claim that three calls from one model equal three different models.

## Current behavior and gap

The current Quick pipeline is:

```text
Raw prompt
  -> selected enhancement mode
  -> shared intent policy plus mode system prompt
  -> PII gate
  -> one provider call
  -> JSON parse and normalization
  -> post-enhance result
  -> evaluation run persistence
```

The parser requires a nonempty enhanced string but does not prove that it is
materially different from the source. Retries cover transient execution
failures, not weak results. Model Arena already supports multiple concurrent
provider/model variants, but it executes prompt responses rather than the
structured enhancement contract and therefore is not the Council controller.

## Target experience

### Entry point

The Create workspace exposes one execution-strategy control adjacent to the
enhancement mode control:

- `Quick`
- `Council`

Quick is selected by default. Council selection applies only to the current
draft. `New prompt`, draft reset, and a new browser/app session reset the
strategy to Quick. The enhancement mode may retain its existing persistence
behavior.

The primary action labels communicate the operation:

- Quick: `Refine prompt`
- Council: `Run council · 3 members + judge`

If a correction pass becomes necessary, the progress view explains that a
fifth bounded call may be used. The initial button must not promise exactly four
calls because partial failure or early validation can reduce the total.

### Council roster

The default roster contains three members.

Auto-selection prefers:

1. three distinct provider/model descriptors
2. two distinct provider/model descriptors plus one distinct lens
3. one provider/model using three distinct lenses

The UI labels the resulting topology exactly:

- `3 models`
- `2 models · 3 members`
- `1 model · 3 lenses`

It must never label repeated calls to the same model as a multi-model council.

Users can inspect and replace roster members before execution when multiple
configured providers are available. The roster cannot contain more than three
members in v1.

### Default lenses

Every member receives the same original prompt, enhancement mode, shared intent
policy, and response schema. A member also receives one bounded lens:

| Lens | Responsibility |
|---|---|
| Intent Guardian | Preserve subject, scope, and explicit constraints; identify unsafe assumptions. |
| Structure Architect | Improve task clarity, context, constraints, output format, and success criteria. |
| Adversarial Critic | Find ambiguity, likely failure modes, missing edge cases, and unjustified no-op conclusions. |

With three distinct models, lenses increase complementary coverage. With one
model, lenses are required to prevent three near-identical executions.

### Progress

Council progress uses explicit stages:

1. `Preparing council`
2. `Running 3 independent reviews`
3. `2 of 3 proposals ready`
4. `Blind review`
5. `Synthesizing final prompt`
6. `Checking for a material improvement`
7. `Council complete`

Member status is shown independently as `queued`, `running`, `complete`,
`failed`, or `canceled`. Provider errors remain attached to the affected member
instead of replacing the entire workspace.

### Results

The existing post-enhance result remains the primary surface. Council produces
the canonical candidate set:

- Improved
- Tighter
- Strict JSON

The result header adds:

- Council topology, such as `3 models`
- agreement summary, such as `2 of 3 preferred this direction`
- total latency
- total input, output, and combined token usage when available
- partial-failure disclosure

An initially collapsed `Council review` section contains:

- member proposals
- provider and model provenance revealed after judgment
- rubric scores
- winning contributions
- material disagreements
- rejected assumptions
- judge reasoning
- correction-pass disclosure when applicable

The judge is blind during execution, but the user is not. Provenance is visible
after judgment for transparency and debugging.

### No defensible improvement

Council must not convert change-for-change's-sake into a quality requirement.
If all valid proposals are no-ops and the judge cannot defend a material
improvement, the operation returns a distinct state:

`No defensible improvement found`

That state must include:

- completed rubric scores
- specific reasons the prompt is already executable
- any unresolved question that would unlock a better result
- available member proposals, if they differ
- actions to copy the original, edit it, change mode, or run again

It must not present the source text as a newly enhanced result or report generic
success.

## Execution architecture

```text
Create UI
  -> useEnhancementCouncil controller
      -> roster resolver
      -> one PII decision
      -> council orchestrator
          -> member adapter A --\
          -> member adapter B ----> proposal normalizer
          -> member adapter C --/          |
                                             v
                                      blind candidate set
                                             |
                                             v
                                         judge call
                                             |
                                             v
                                    deterministic quality gate
                                      |                 |
                                      | pass            | correction needed
                                      v                 v
                              result normalization   one correction call
                                      |
                                      v
                            result UI plus run persistence
```

### Ownership boundaries

#### `lib/councilSchema.js`

Owns pure normalization and validation for:

- roster descriptors
- member proposals
- judge decisions
- compact Council summaries
- persisted Council run details

This module must not depend on React or provider transports.

#### `lib/enhancementCouncil.js`

Owns provider-independent orchestration:

- member fan-out
- concurrency limit
- independent request construction
- anonymization and deterministic shuffle
- minimum-success threshold
- judge invocation
- correction invocation
- aggregation of usage, latency, and statuses
- abort propagation

It receives `callModel`, prompt builders, clocks, ID generation, and persistence
callbacks as dependencies so orchestration can be unit tested without live
providers.

#### `hooks/useEnhancementCouncil.js`

Owns UI-adjacent state:

- selected execution strategy
- roster editing
- stage and member progress
- current AbortController
- retry and cancel actions
- conversion of a completed Council result into editor state

It must not parse raw provider responses or write directly to storage.

#### Existing provider layer

`callModel`, `getConfiguredProviders`, and provider registry adapters remain the
only transport boundary. Council must not introduce provider-specific fetches
inside React components or the orchestrator.

#### Existing result layer

`normalizeResultMeta` remains responsible for the canonical result consumed by
`PostEnhanceResults`. It may gain a compact optional `council` summary, but full
member payloads remain in evaluation history.

## Execution algorithm

### 1. Preflight

The controller validates:

- source prompt is nonempty
- enhancement mode is valid
- roster contains exactly three valid members
- every selected provider/model is currently configured or hosted-allowed
- Council capability is enabled on the current surface
- no Council run is already active for the draft

### 2. Privacy decision

PII scanning happens once against the logical Council payload before any member
call begins.

If the user chooses redaction, the same redacted source is sent to every member
and the judge. If the user chooses send anyway, that single decision applies to
the current Council run only. Canceling at the privacy gate creates no provider
calls.

### 3. Member fan-out

Three member calls start concurrently with a concurrency limit of three. Each
call receives:

- source prompt
- selected enhancement mode
- shared intent-preservation policy
- assigned lens
- strict member response contract
- no peer proposal or provider identity

The member contract returns:

- proposed enhanced prompt
- missing dimensions found
- semantic changes
- assumptions
- reasoning
- confidence
- no-op claim and evidence, when applicable

### 4. Minimum valid set

- Three valid proposals: continue normally.
- Two valid proposals: continue and mark the run partial.
- One valid proposal: do not invoke the judge; show the proposal and offer
  `Use proposal`, `Retry failed members`, or `Return to Quick`.
- Zero valid proposals: fail the logical run and preserve the source draft.

### 5. Blind judgment

Valid proposals are assigned opaque IDs and deterministically shuffled using
the Council run ID. Provider, model, lens name, latency, and token usage are
excluded from the judge payload.

The judge receives:

- original prompt
- enhancement mode
- anonymized proposals
- scoring rubric
- final response contract

The judge can select one proposal or synthesize across proposals. It cannot ask
members follow-up questions.

### 6. Quality gate

The final result is checked deterministically before it reaches editor state.

Required checks:

- Improved candidate is nonempty.
- Tighter and Strict JSON candidates are nonempty and distinct.
- Candidate IDs and roles normalize to the canonical result contract.
- Assumptions and reversible edits are structurally valid.
- Judge scores exist for every valid proposal.
- Judge reasoning names at least one concrete execution improvement or returns
  the explicit no-defensible-improvement state.
- An exact normalized copy of the source cannot be reported as enhanced.
- A near-identical result with no semantic changes cannot pass as a material
  improvement.

Initial near-no-op signal:

```text
exactNoOp = normalizeWhitespace(source) == normalizeWhitespace(result)
lowDiff = changedTokenCount < 3 AND no structural format change
unsupportedImprovement = semanticChanges is empty OR judge reasoning is generic
```

`exactNoOp`, or `lowDiff` combined with `unsupportedImprovement`, triggers one
bounded correction pass. Thresholds must live in a named policy module and be
covered by fixtures rather than being scattered through UI code.

### 7. Correction pass

The correction prompt receives the rejected final result plus deterministic
validation failures. It may revise the result once.

There is no second correction. If the corrected result still fails:

- preserve all valid member proposals
- return `No defensible improvement found` when rubric evidence supports it
- otherwise return an acknowledged Council failure with retry actions

### 8. Commit and persistence

Editor state changes atomically only after a valid final result exists. A
failed, canceled, or incomplete Council run never clears the previous completed
result or source draft.

## Prompt contracts

### Member system prompt shape

```text
You are an independent member of an enhancement council.

[shared intent policy]
[selected enhancement mode policy]
[assigned lens]

Improve the source prompt independently. Do not refer to other council members.
Do not claim that no improvement is needed without completing the rubric and
giving concrete evidence. Return only the member JSON contract.
```

### Member response contract

```json
{
  "proposal": "string",
  "missing_dimensions": ["string"],
  "changes": [
    { "type": "added|removed|changed", "label": "string" }
  ],
  "assumptions": [
    { "id": "string", "text": "string", "added_text": "string" }
  ],
  "reasoning": "string",
  "confidence": 0.0,
  "no_op": {
    "claimed": false,
    "evidence": []
  }
}
```

`confidence` is bounded to `0..1`. It is shown as member metadata but is not a
judge score and does not influence ranking directly.

### Judge rubric

Each dimension is scored from `0` to `4`:

| Dimension | Question |
|---|---|
| Intent fidelity | Does the proposal preserve the user's actual subject, scope, and constraints? |
| Executability | Could a capable model act without avoidable clarification? |
| Specificity | Are task, context, constraints, and success conditions appropriately explicit? |
| Output contract | Is the requested response shape clear where one is useful? |
| Assumption safety | Are additions grounded, disclosed, and reversible? |
| Efficiency | Does the proposal avoid verbosity and structure that do not improve execution? |
| Material improvement | Is it meaningfully better than the source rather than merely reformatted? |

The judge must score every valid proposal and cite proposal-specific evidence.
Provider identity and self-reported confidence are unavailable to the judge.

### Judge response contract

```json
{
  "decision": "select|synthesize|no-defensible-improvement",
  "selected_proposal_ids": ["candidate-id"],
  "scores": [
    {
      "proposal_id": "candidate-id",
      "intent_fidelity": 0,
      "executability": 0,
      "specificity": 0,
      "output_contract": 0,
      "assumption_safety": 0,
      "efficiency": 0,
      "material_improvement": 0,
      "evidence": ["string"]
    }
  ],
  "agreement_summary": "string",
  "dissent": ["string"],
  "result": {
    "enhanced": "string",
    "variants": [
      { "label": "Tighter", "content": "string" },
      { "label": "Strict JSON", "content": "string" }
    ],
    "change_summary": "string",
    "changes": [
      { "type": "added|removed|changed", "label": "string" }
    ],
    "notes": "string",
    "reasoning": "string",
    "assumptions": [],
    "reversible_edits": [],
    "tags": []
  }
}
```

The `result` object uses the existing enhancement result contract. For
`no-defensible-improvement`, it contains the source for comparison but is not
committed as a newly enhanced result.

## Data model

### Council member descriptor

```ts
type CouncilLens = 'intent-guardian' | 'structure-architect' | 'adversarial-critic';

type CouncilMemberDescriptor = {
  id: string;
  provider: string;
  model: string;
  lens: CouncilLens;
};
```

### Compact saved-result summary

```ts
type CouncilResultSummary = {
  councilRunId: string;
  topology: 'multi-model' | 'mixed-model' | 'multi-lens';
  memberCount: 3;
  validProposalCount: number;
  partial: boolean;
  selectedProposalIds: string[];
  agreementSummary: string;
  dissent: string[];
  judgeProvider: string;
  judgeModel: string;
  totalLatencyMs: number | null;
  usage: { input: number | null; output: number | null; total: number | null } | null;
  correctionUsed: boolean;
};
```

This summary may be stored under `resultMeta.council`. It must survive Library
save/version, workspace export/import, pack export/import when result metadata
is included, cross-tab reconciliation, and legacy normalization.

### Full Council run

The evaluation store owns the detailed trace:

```ts
type CouncilRunRecord = {
  id: string;
  mode: 'enhance-council';
  status: 'running' | 'success' | 'partial' | 'failed' | 'canceled';
  sourcePrompt: string;
  enhanceMode: string;
  startedAt: string;
  completedAt: string | null;
  members: CouncilMemberRun[];
  judge: CouncilJudgeRun | null;
  correction: CouncilCorrectionRun | null;
  finalResultMeta: object | null;
  error: object | null;
};
```

Member and judge records include provider, model, request status, raw structured
payload, normalized payload, latency, usage, and an acknowledged error. Secrets
and provider keys are never persisted.

The run appears as one parent row in Recent Runs. Member and judge executions
are nested details, not four or five unrelated top-level rows.

## Provider and surface behavior

### Extension

- Uses configured providers from Chrome storage.
- Supports cross-provider rosters when at least two descriptors are configured.
- Uses the existing background message and abort boundary for every member.
- A Council cancel sends an abort for every active request ID.

### Desktop

- Uses configured providers from local settings through the shared provider
  registry.
- Supports Anthropic, OpenAI, Gemini, OpenRouter, and Ollama according to current
  provider availability.
- Local Ollama models are allowed but must disclose missing usage metadata.

### Hosted web app

The current hosted path forces Anthropic and applies shared-key request, input,
token, timeout, and daily-budget controls. One Council operation can consume
four or five provider requests, so it must not ship on the current shared demo
quota by merely calling the existing endpoint repeatedly.

Hosted Council requires one of these explicit release paths:

1. signed-in entitlement plus a server-side logical Council-operation budget
2. user-supplied provider credentials through an approved hosted BYOK design
3. a curated server roster with per-operation cost caps and at least two
   enabled models

Until one path is implemented, the hosted UI must explain that Council requires
configured multi-model access. It may offer `1 model · 3 lenses` only if product
and cost gates explicitly allow the required calls. It must not imply provider
diversity that does not exist.

### Native SwiftUI app

Native Council is deferred. The initial shared React implementation must keep
Council fields optional so native Quick enhancement and the current versioned
contract remain valid. Native parity work requires a separately approved
contract version and XCTest updates.

## Cost and resource controls

### Call budget

| Stage | Maximum calls | Suggested output cap |
|---|---:|---:|
| Members | 3 | 1,200 tokens each |
| Judge | 1 | 1,800 tokens |
| Correction | 1 | 1,200 tokens |
| Total | 5 | 6,600 tokens |

These are maximums, not guaranteed consumption. The provider and hosted proxy
may enforce lower caps.

### Required controls

- Quick remains the default.
- Council strategy resets on New Prompt and fresh session.
- The action discloses the expected number of calls.
- Concurrency is capped at three member calls.
- One AbortController group owns the logical run.
- One correction pass is the hard maximum.
- No member retries a content-quality failure independently.
- Council does not inherit Quick's automatic transient retry. Partial-member
  handling and explicit retry actions keep one activation within the five-call
  ceiling. Every later user-triggered retry is a new disclosed attempt.
- Hosted logical-operation budgets must be enforced server-side, not only in UI.
- Actual token usage is aggregated without inventing values when a provider
  omits usage.

## Failure and recovery behavior

| Failure | Required behavior |
|---|---|
| One member fails | Continue with two proposals; disclose partial result. |
| Two members fail | Do not judge; preserve the one proposal and offer recovery actions. |
| All members fail | Preserve source and prior result; show per-member causes. |
| Judge fails | Preserve proposals; allow manual proposal selection or judge retry. |
| Correction fails | Preserve judged result as rejected evidence; do not report enhancement success. |
| User cancels | Abort all active requests and record one canceled logical run. |
| App closes mid-run | On restore, mark the interrupted run failed or canceled; never leave `running` indefinitely. |
| Persistence fails | Keep the completed result in editor state, mark history save failure, and offer retry/export. |
| Provider configuration changes | Freeze the run roster at start; apply new settings only to a later run. |

Retries never clear successful proposals. A retry creates a new attempt under
the same logical run when safe, with previous failure evidence retained.

## Accessibility and responsive requirements

- Strategy control uses radio-group or tab semantics with a visible label.
- Roster controls have explicit provider, model, and lens labels.
- Council progress is announced through a polite live region without repeating
  streaming content.
- Failures use alert semantics when user action is required.
- Member status is not communicated by color alone.
- The member list and judge score table are keyboard navigable.
- Expand/collapse controls expose `aria-expanded` and their target relationship.
- Cancel remains reachable while any request is active.
- Focus moves to the result heading on success and to the failure summary on an
  acknowledged terminal failure.
- Reduced-motion preference removes animated progress transitions.
- At 400 and 560 pixels, the Council review uses one member at a time with an
  accessible tablist or stacked disclosures; no horizontal page overflow.
- At tablet and desktop widths, the final result remains visually primary over
  member evidence.

## Entitlement behavior

Council uses a named capability: `canUseEnhancementCouncil`.

The capability decision can consider:

- surface
- hosted feature availability
- configured provider roster
- account entitlement
- billing-disabled or prelaunch state
- server budget health

Unavailable states must distinguish:

- `Configure another model`
- `Council is unavailable on hosted web`
- `Hosted Council budget reached`
- `Council requires Pro`
- `Council is temporarily unavailable`

Do not collapse these into a generic locked button. Existing prelaunch-open
behavior must remain truthful; the feature cannot appear open if the backend
cannot fund or execute it.

## Analytics and evaluation

No prompt content, proposal content, or provider credential is sent to product
analytics.

Permitted event metadata after consent:

- surface
- topology
- member count
- success/partial/failure/canceled status
- selected enhancement mode
- provider families as non-secret categorical values
- total latency bucket
- token-usage bucket
- correction-used boolean
- no-defensible-improvement boolean
- selected proposal versus synthesized result

Local evaluation history retains exact content under the existing local-first
model.

### Product quality metrics

- Council completion rate
- partial-result rate
- member and judge failure rate
- correction-pass rate
- no-defensible-improvement rate
- save/copy/adopt rate after Council versus Quick
- user-selected member proposal versus synthesized result
- median latency and token usage by topology
- exact and near-no-op rate by enhancement mode

Metrics describe product behavior; they must not automatically rank providers
across users without a separate privacy and evaluation design.

## UI state model

```ts
type CouncilStage =
  | 'idle'
  | 'preflight'
  | 'privacy-review'
  | 'members-running'
  | 'judging'
  | 'validating'
  | 'correcting'
  | 'complete'
  | 'no-improvement'
  | 'failed'
  | 'canceled';
```

Only one terminal state may be active. Derived booleans such as `loading`,
`partial`, and `canRetry` should be computed from the stage and member records,
not stored independently in multiple components.

The Council controller is the source of truth for active execution. The editor
remains the source of truth for source and committed result content. The
evaluation store remains the source of truth for completed execution evidence.

## Proposed implementation touchpoints

### New modules

- `prompt-lab-extension/src/lib/councilSchema.js`
- `prompt-lab-extension/src/lib/enhancementCouncil.js`
- `prompt-lab-extension/src/hooks/useEnhancementCouncil.js`
- `prompt-lab-extension/src/EnhancementCouncilPanel.jsx`
- focused unit and integration tests for each boundary

### Existing modules likely to change

- `prompt-lab-extension/src/constants.js`
- `prompt-lab-extension/src/hooks/useExecutionFlow.js`
- `prompt-lab-extension/src/CreateEditorPane.jsx`
- `prompt-lab-extension/src/PostEnhanceResults.jsx`
- `prompt-lab-extension/src/lib/enhancementResult.js`
- `prompt-lab-extension/src/lib/evalSchema.js`
- `prompt-lab-extension/src/RunTimelinePanel.jsx`
- `prompt-lab-extension/src/lib/platform.js`
- `prompt-lab-extension/src/lib/desktopApi.js`
- `prompt-lab-extension/extension/background.js`
- `prompt-lab-extension/public/background.js`
- export/import normalization and contract tests
- capability and billing state only where needed for truthful availability

### Boundaries not to violate

- Do not place orchestration inside `CreateEditorPane`.
- Do not fork provider request logic from the registry.
- Do not reuse Model Arena's response state as Council state.
- Do not put full member traces into every saved Library entry.
- Do not change the native enhance contract implicitly.
- Do not let hosted UI gating substitute for server-side cost enforcement.

## Test plan

### Pure unit tests

- roster selection prefers provider/model diversity
- one-model roster assigns three distinct lenses
- roster labels match actual topology
- provider/model identities are removed before judgment
- candidate shuffle is deterministic for a run ID
- schema normalizers reject malformed member and judge payloads
- token and latency aggregation handles missing provider usage
- exact no-op is rejected
- low-diff unsupported change triggers correction
- supported light improvement passes
- no-defensible-improvement requires complete rubric evidence
- compact summary drops full proposal bodies and secrets

### Orchestrator integration tests

- three members plus judge complete successfully
- member calls start concurrently
- one failed member produces a partial judged result
- two failed members skip judgment
- judge failure preserves proposals
- one correction pass can recover a no-op
- a second invalid result does not recurse
- cancel aborts every active request
- late member or judge success cannot overwrite canceled state
- PII cancellation causes zero provider calls
- redaction is identical across all calls
- persistence failure keeps the completed editor result

### Contract tests

- Quick result records remain byte-compatible after optional Council fields
- Council summary survives prompt save, versioning, duplicate, and restore
- workspace export/import preserves Council summaries and full run evidence
- pack export/import preserves optional result provenance when included
- legacy prompt and run records normalize with no Council object
- cross-tab merge does not drop Council summary fields

### Component tests

- Quick is the default strategy
- New Prompt resets Council to Quick
- action label discloses call count
- roster topology is truthful
- progress and partial failures are live-announced
- result focus and failure focus are correct
- judge details are collapsed initially
- manual member proposal selection updates the committed candidate
- unavailable capability states show the correct remedy

### Cross-surface E2E

Use mocked providers in credential-free CI.

- extension at 400, 560, 768, and desktop width
- hosted web at the same widths with truthful capability behavior
- desktop at the same widths
- keyboard-only strategy, roster, cancel, results, and recovery flow
- dark and light contrast checks
- no horizontal overflow
- cancellation during member execution and during judgment
- partial failure followed by successful save and Library reload

Live paid-provider smoke remains opt-in and requires explicit authorization.

## Acceptance criteria

Council v1 is complete only when all of the following are true:

1. Quick remains unchanged and default.
2. Council strategy and enhancement mode are independent controls.
3. Exactly three members receive the same source and mode policy independently.
4. The displayed topology matches actual provider/model diversity.
5. The judge cannot see provider/model identities.
6. Three valid proposals produce a judged or synthesized canonical result.
7. Two valid proposals produce an acknowledged partial result.
8. Fewer than two valid proposals do not create a false judged result.
9. Exact no-ops cannot be reported as successful enhancements.
10. One bounded correction pass is the maximum.
11. The final result remains compatible with Improved, Tighter, and Strict JSON.
12. The source draft and previous complete result survive every failure path.
13. Cancel aborts all active requests and blocks late result adoption.
14. Cost, calls, usage, latency, and partial failure are disclosed truthfully.
15. Detailed traces remain in run history while saved prompts store compact
    provenance.
16. Export/import and cross-tab contracts preserve all new optional fields.
17. Hosted Council cannot bypass shared-key budget controls.
18. Extension, hosted web, and desktop render truthful Council availability.
19. Responsive, keyboard, focus, live-region, contrast, and reduced-motion
    checks pass.
20. Credential-free unit, integration, contract, build, and E2E gates pass under
    the repository's pinned Node 22 runtime.

## Rollout plan

### Phase 0: contracts and fixtures

- Add schemas, prompt builders, no-op policy, and deterministic fixtures.
- Add optional Council summary normalization without changing Quick behavior.
- Add contract and migration coverage.

Exit gate: pure tests and all existing Quick enhancement tests pass.

### Phase 1: orchestration behind a disabled flag

- Implement independent fan-out, blind judgment, correction, cancellation, and
  parent-run persistence.
- Use mocked providers only.

Exit gate: orchestration and failure matrix pass with no UI exposure.

### Phase 2: extension and desktop BYOK experience

- Add strategy control, roster, progress, result evidence, and recovery UI.
- Enable only when configured providers and capability policy permit.

Exit gate: cross-width extension and desktop E2E, accessibility checks, and
local export/import round-trip pass.

### Phase 3: hosted cost and entitlement path

- Implement logical Council-operation budget enforcement.
- Decide curated roster, hosted BYOK, or entitled shared-provider strategy.
- Add production-safe observability without prompt-content analytics.

Exit gate: server budget, rate limit, cancellation, timeout, entitlement, and
signed-in hosted behavior are verified separately.

### Phase 4: measured release

- Enable for an explicit cohort.
- Compare adoption, no-op, correction, latency, and save rates against Quick.
- Tune prompt and no-op thresholds through versioned fixtures.

Exit gate: Council improves adoption or output-quality evidence without an
unacceptable failure, latency, or cost increase.

## Release blockers

- No deterministic no-op and response-contract validation.
- No grouped cancellation across member and judge requests.
- No parent-run persistence or portable Council fields.
- Hosted enablement without a logical-operation budget.
- UI describing repeated same-model calls as multiple models.
- Judge payload containing provider or model identity.
- Hidden Council persistence that causes accidental multi-call runs.
- Missing partial-failure and judge-failure recovery.
- Missing compact-width or keyboard proof.

## Deferred decisions

The following require implementation or commercial evidence and are not fixed
by this specification:

- exact hosted entitlement and pricing
- curated hosted provider/model roster
- whether users can choose the judge model
- whether Council becomes available to the native app
- whether a later version supports four or five members
- whether successful member proposals can be promoted into reusable named
  Council presets

These decisions must not block the contract-first extension and desktop work,
but hosted Council must remain disabled until its cost path is resolved.

## Verification commands

Documentation-only verification for this specification:

```bash
cd prompt-lab-source
npm run docs:lint
```

Implementation verification must use the repository's pinned Node 22 runtime
and the package-level unit, build, and Playwright commands documented by the
affected workstream.
