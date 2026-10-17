# Prompt options recalibration — 2026-10-09

## Scope and state

Implemented on `codex/expanded-prompt-options`, based on `f03f414b761d047d9a3d12dd356a03f5329608f9`. This is a shared web, desktop-webview, and extension change, not a native iOS update. It is not a production release or a claim that the broader Enhance UX acceptance contract is complete.

Runtime code was verified at `173a0436c03323d6369798165d79017cb9816a79`; an additional legacy regression test was verified at `24574644c90c02e813412dd75523537f520db8a2`. Changed runtime files were compared by Git blob hash against the tested checkout. Later documentation commits do not alter that runtime evidence.

## Implemented

- Expanded is the persisted primary strategy. Refined and Rebuilt are optional alternatives; three candidates are no longer mandatory.
- Task type and intended destination are independent of rewrite strategy and the provider doing the enhancement.
- Shorten source and Format source as JSON are explicit actions. JSON transport does not change the requested downstream answer format.
- New generation instructions preserve facts, exclusions, technical context, scope, and requested answer length. Constraint and format quick fixes no longer inject concision or a fixed Markdown layout.
- Complete semantic diffs retain final edits, exact whitespace, Unicode, and line endings beyond the former 200-word limit.
- Generation budgets account for source length and candidate count. Comparison budgets are configurable and shared across variants; changing a budget invalidates stale comparisons.
- Versioned candidate IDs survive selection, edits, saves, and reloads. Historical Improved/Tighter/Strict JSON records retain their original identities, including old `json` aliases.
- Assumptions and reversible edits are candidate-scoped. Candidate cards no longer imply quality from the five keyword checks; result headers label them Structure checks.
- Modern budgeted run history retains complete input, output, and candidate text. Partial supporting metadata is disclosed rather than presented as complete.

## Verification

Executed under Node 22 in an isolated ephemeral sandbox:

| Check | Result |
| --- | --- |
| Vitest | 104 files, 1,142 tests passed |
| Node legacy tests, including restored explicit 429 guard | 223 tests passed |
| Extension production build and assembly | Passed |
| Hosted web production build | Passed |
| Changed-file blob comparison | Matched the tested branch files |
| Git whitespace check | Passed |

The tests verify implementation behavior, contract assembly, preservation of stored text, and regression cases. They do not guarantee that every live model response preserves intent. Build warnings about bundle size and existing development-test warnings remain.

## Remaining acceptance and boundaries

- Browser viewport, real-device/native packaging, and live-model output-quality acceptance are not established by these unit tests and builds.
- The hosted proxy output cap and account limits are unchanged. The interface explicitly labels a requested allowance; the provider or host may enforce a lower cap.
- Native iOS still uses its existing generation contract. Legacy mode definitions remain for compatibility rather than being relabeled in place.
- The broader input-score/lint heuristic redesign and overall Enhance workflow acceptance remain separate from this bounded result-control improvement.
- No credentials, security settings, hosting environment variables, or quota policy were changed.

Canonical tracking: existing Enhance UX backlog row `59fa88b8-6352-4c9d-ad1d-77de40f4ffee` and implementation RUN `3d2255fc-8f44-810a-85d4-e3fec5ddc6f2`. Keep the parent UX row In progress until its complete acceptance contract passes. This report does not replace or retimestamp the global status snapshot from a partial query.

Next action: review the branch and complete the remaining browser/CI acceptance before merge or release.
