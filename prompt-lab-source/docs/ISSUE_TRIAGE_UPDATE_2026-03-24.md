# Issue Triage Update — 2026-03-24

This note captures the latest triage decisions for the current import/library/search issue set.

| # | Issue | Applies to | Status | Action |
|---|---|---|---|---|
| 1 | Newest sort wrong (`packLoadedAt`) | Web only | Open | Keep, add `Web` tag |
| 2 | Collection deletion orphans entries | Both | Open | Keep — issue also exists in `usePromptLibrary.js` |
| 3 | Manual reorder vs filtered subset | Both | Open | Keep |
| 4 | Search inconsistency (Library vs Composer) | Web only | Open | Keep, add `Web` tag (extension `ComposerTab` has no search) |
| 5 | No test coverage for sort/filter | Both | Open | Keep |
| 6 | Import Library has no content dedup | Both | Partially fixed | Update notes: B-005 added ID dedup; content-level dedup still missing |
| 7 | Import Pack near-duplicates | Web only | Open | Keep, add `Web` tag |
| 8 | Starter Libraries `packLoadedAt` | Web only | Open | Keep, add `Web` tag |
| 9 | Legacy Recover weak dedupe | Web only | Open | Keep, add `Web` tag |
| 10 | No test coverage for preset-pack import | Web only | Open | Keep, add `Web` tag |
| 11 | Layout triple-wide inconsistency | Web only | Done | Mark done — fixed by Codex in same session |
| 12 | Duplicate header files | Web only | Open | Keep, add `Web` tag |

## Notes

- `Web only` means the issue is scoped to the web surface and should be explicitly tagged to avoid extension/desktop confusion.
- `Both` means shared logic should be treated as cross-surface technical debt unless proven otherwise.
