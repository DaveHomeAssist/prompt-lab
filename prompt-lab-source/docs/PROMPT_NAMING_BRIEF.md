# Local prompt naming

Dave approved this slice on October 25: preserve custom titles through refinement and reopening Save, and make local suggestions identify the task. No AI naming calls.

## Scope and flow

Keep a nonblank draft title when reopening Save for the current prompt, including a rename not yet saved. Explicitly opening a different prompt still adopts that prompt's title. Refinement must check the latest title when its asynchronous response arrives, so a name entered during the request survives.

For automatic suggestions, prefer an explicit heading or Title field, skip empty formatting fences and generic wrapper labels, and look past role introductions for the task. Retain the role when there is no task. Strip simple polite prefixes and Markdown decoration, retaining the existing fallback and length limit. This is deterministic local extraction, not semantic generation.

No bulk rename, saved-data migration, schema, provider, billing or dependency changes. Existing saved titles remain unchanged. Native Swift naming rules and its versioned contract remain unchanged; the shared React web, extension and desktop source receives this slice.

## Acceptance

- Custom new-draft and existing-prompt titles survive Save close/reopen and refinement, including edits made while refinement is pending.
- An explicitly selected different prompt adopts its own title; New Prompt resets naming state.
- Prompts with the same role introduction and different tasks receive task-based suggestions.
- Fences, generic wrapper labels, explicit Title fields and closing heading hashes do not contaminate suggestions.
- Role-only prompts, empty input, truncation and existing contract cases remain supported.
- Targeted helper/hook tests and hosted browser lifecycle checks pass without real model calls. Verify ordinary build/CI and deployed Save behavior through existing delivery gates.

## Risks and next action

Heuristics cannot infer every task from arbitrary prose. Prefer preserving explicit/user titles over aggressive rewriting. Verify overlapping Save contexts and asynchronous title changes. Next: implement and validate this bounded slice.
