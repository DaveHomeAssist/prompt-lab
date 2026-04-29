# PromptLab Release Gate Classification

Date: 2026 04 24

Historical status: this report captured the release gate state on 2026 04 24. It is not the current release gate.

Supersession note: on 2026 04 29, the Home Assistant content was preserved in the Home OS workspace, Prompt Lab `implementation_plan.txt` was restored to its tracked Prompt Lab plan, the dated implementation plans were confirmed as exact date correction renames, Node 22 verification was restored for Prompt Lab build work, and the Vercel billing incident was documented in `docs/incidents/prompt-lab-vercel-billing-incident-2026-04-29.md`.

## Status

Release status: blocked

Reason: the current worktree contains mixed documentation changes and the active local Node runtime is unsupported for PromptLab verification.

## Verified Facts

| Area | Finding | Evidence |
|------|---------|----------|
| Branch | Current branch is `canonical-tools-restore` | `git branch --show-current` |
| Latest commit | `94a8ca0 docs: keep README.md and AGENTS.md at repo root` | `git log -1 --oneline` |
| Remote | GitHub remote is `DaveHomeAssist/prompt-lab` | `git remote -v` |
| Open PRs | PR 6 is open, test suite only branch `claude/fix-prompt-library-bugs-TSJK8` | `gh pr list` |
| Runtime | Active local Node is `v25.8.1` | `node --version` |
| Runtime contract | Repo requires Node `^20.19.0 || >=22.12.0` | `prompt-lab-source/package.json` |
| Dirty tree | Worktree has deletes, untracked dated docs, one staged doc edit, and an unrelated plan in `implementation_plan.txt` | `git status --short` and source inspection |

## Dirty Tree Classification

| Path | State | Classification | Release Impact |
|------|-------|----------------|----------------|
| `docs/implementation-plan-billing-containment-2026-04-24.md` | Deleted | likely rename or date correction candidate | block until ownership is confirmed |
| `docs/implementation-plan-notion-audit-2026-04-24.md` | Deleted | likely rename or date correction candidate | block until ownership is confirmed |
| `docs/implementation-plan-billing-containment-2026-04-12.md` | Untracked | likely replacement for deleted 2026 04 24 file | block until paired with deleted file intentionally |
| `docs/implementation-plan-notion-audit-2026-04-23.md` | Untracked | likely replacement for deleted 2026 04 24 file | block until paired with deleted file intentionally |
| `prompt-lab-source/docs/create-evaluate-restructure-plan.md` | Staged modified | scoped doc edit | can ship only after review |
| `implementation_plan.txt` | Modified | unrelated Home Assistant implementation plan appears inside PromptLab | hard block for release |

## Release Gate Decision

Do not promote PromptLab until all items below are complete:

1. Move or remove the Home Assistant plan content from `implementation_plan.txt` without losing it.
2. Decide whether the two dated implementation plan pairs are intentional renames.
3. Review the staged `create-evaluate-restructure-plan.md` edit and either commit it with the matching doc batch or unstage it.
4. Switch to supported Node `20.19+` or `22.12+`.
5. Run PromptLab quick preflight from `prompt-lab-source`.
6. Recheck PR 6, which remains open and was previously classified as blocked by desktop workflow scope.
7. Only after the above, rerun hosted QA for the bug report path before production promotion.

## Suggested Command Sequence

```bash
cd /Users/daverobertson/Desktop/Code/10-projects/active/prompt-lab
git status --short
git diff -- implementation_plan.txt
git diff --cached -- prompt-lab-source/docs/create-evaluate-restructure-plan.md
cd prompt-lab-source
npm run preflight:quick
```

Use a supported Node runtime before running the preflight.
