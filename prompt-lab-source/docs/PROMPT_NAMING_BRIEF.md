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

## Delivery gate follow-up

Initial candidate Landing CI40262436714 failed the dependency audit on GHSA-xjj6-f33q-929c. The extension's development path is jsdom28.1.0 to undici7.30.0 (range ^7.21.0). GitHub identifies7.30.1 as patched; its Node>=20.18.1 requirement fits the project Node22 runtime. No overlapping update PR exists at inspection. The lockfile repair changes only undici version, URL and integrity to7.30.1, preserving cross-platform optional entries and all manifests. Clean installation,119 targeted tests, extension build and all4 audit roots pass on Dominic. No audit policy change.

The first full hosted run passed49, skipped1 credential-dependent case, and failed4 responsive cases solely because their expected preview title was the former role title. Those checks now assert the actual task title; rerun and exact-head CI are tracked separately. All9 lifecycle scenarios passed on final application source.

## Production receipt

[PR212](https://github.com/DaveHomeAssist/prompt-lab/pull/212) merged as `4006ab38916818d12bc8b876db223dbc20b9f814`. Vercel `dpl_FjVQ1VaGsQuMdfLbVyAykhsecaSN` is READY at the exact merge. [Production40263126391](https://github.com/DaveHomeAssist/prompt-lab/actions/runs/40263126391) passed both signed-in synthetic scenarios in13.7seconds, including custom-title Save close/reopen and acknowledged Save. Both disposable sessions were revoked and verified. No real model inference or purchases were performed. Naming remains entirely local.

Exact-main [Landing40263077636](https://github.com/DaveHomeAssist/prompt-lab/actions/runs/40263077636) passes1270shared tests, landing browser25/25 and hosted53/54 with one credential-dependent skip. This supersedes the earlier role-title expectation failures. Dominic corrected responsive5/5 and119 helper/hook/contract checks pass, with clean patched install and extension build. Existing titles remain unchanged; new suggestions identify the task with local rules.

Broader physical/human, macOS installed interaction/signing, prior-version upgrade/snapshot restore and tagged-release gates remain separate. This slice introduces no AI naming calls.

Final main closure: all11 workflows passed. [Desktop40263077663](https://github.com/DaveHomeAssist/prompt-lab/actions/runs/40263077663) passed all6jobs, including MSI/NSIS and DEB/AppImage acceptance plus macOS packaging. [iOS40263077593](https://github.com/DaveHomeAssist/prompt-lab/actions/runs/40263077593) passed iPhone/iPad automated checks. [Naming issue](https://app.notion.com/p/402255fc8f4481249cb0e9dd7aa1b4ac) is Done with readback; the full59-row snapshot and original14plan identities are preserved. Next: retain this bounded release; further AI naming remains unapproved.
