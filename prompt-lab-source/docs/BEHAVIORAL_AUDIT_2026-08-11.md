# PromptLab Behavioral Path & Failure Audit — 2026-08-11

Status: **Red → remediation in progress**
Release recommendation at audit time: **Hold**
Remediation: all six P1 defects fixed 2026-08-12 on `claude/promptlab-behavioral-audit-5v4eqj` (PR #35)
Release gate: hold remains until PLB-001…006 are **re-audited under the same failure conditions** against the fixed commit and deployed artifact.

This is the repo-local record of the external behavioral audit run on
August 11, 2026 (audited at `main` = `91d86cb`, live app reporting v1.7.1).
The audit drove live production testing, isolated local testing, multi-tab
contention, fault-injection harnesses, and code confirmation across the
Workbench, Library, Evaluate, Notebook, mobile shell, extension, desktop
shell, and native iOS prototype. Paid provider calls, purchases, destructive
production tests, and credential handling were excluded.

## Headline results

| Measure | Verdict |
|---|---|
| Behavioral reliability | 4.2 / 10 |
| Paths tested / passed / failed / blocked | 169 / 112 / 33 / 24 |
| Confirmed P0 / P1 / P2 / P3 | 0 / 6 / 10 / 3 |
| Primary system risk | UI success state not coupled to durable persistence or actual request termination |

Strongest areas: Library search/sort/import round-trips, Unicode/RTL/Markdown
handling, and the hosted proxy safety controls (66/66 API tests).

## Confirmed defect register and remediation status

Severity and IDs are the audit's. "Fixed (PR #35)" = repaired 2026-08-12 with
regression coverage in `prompt-lab-extension/src/__tests__/plbAuditFixes.test.jsx`.

| ID | Sev | Finding | Status |
|---|---|---|---|
| PLB-001 | P1 | Notebook New/Rename used `window.prompt()`, crashing the whole app in embedded browsers | **Fixed (PR #35)** — controlled React naming dialog in `PadTab.jsx` |
| PLB-002 | P1 | Cancel did not terminate hosted/extension provider requests; late success could be silently discarded | **Fixed (PR #35)** — `AbortSignal` through `proxyFetch`; `MODEL_ABORT`/`requestId` contract in extension messaging + background worker; abort-aware retry backoff |
| PLB-003 | P1 | Library save showed "Saved!" after a rejected storage write | **Fixed (PR #35)** — write-then-acknowledge in `usePromptLibrary.doSave`; failure keeps draft and save panel |
| PLB-004 | P1 | Notebook autosave showed Saved on quota failure | **Fixed (PR #35)** — acknowledged `persistPadsState`; visible "Save failed", dirty buffer retries |
| PLB-005 | P1 | Notebook multi-tab last-writer-wins silently destroyed competing edits | **Fixed (PR #35)** — `pl2-pads` revision counter, per-pad read-merge-write, storage-event adoption, same-pad conflict warning |
| PLB-006 | P1 | Production billing disabled while upgrade UI showed live purchase controls with a generic error | **Fixed (PR #35)** — `billingDisabled` propagated into billing state; server message surfaced; maintenance notice replaces checkout controls |
| PLB-007 | P2 | Deleted-while-loaded prompt still reported "Prompt updated!" | **Partially fixed (PR #35)** — update now fails honestly when the target is gone; automatic save-as-new / `editingId` reset still open |
| PLB-008 | P2 | Version restore left the loaded editor on the pre-restore content | Open |
| PLB-009 | P2 | Browser Back never returns to the prior workspace | Open |
| PLB-010 | P2 | Evaluate Pass/Fail/Regressions filters change UI state but not results | Open |
| PLB-011 | P2 | Free deep link to `#/compare` silently renders History with no gate explanation | Open |
| PLB-012 | P2 | Reset Draft / mobile Clear destroy unsaved state without confirmation or undo | Open |
| PLB-013 | P2 | Rapid double-click Refine executes twice | Open (retry backoff is now abort-aware, but no synchronous busy guard yet) |
| PLB-014 | P2 | Extension Options Test dispatches duplicate `MODEL_REQUEST`s on rapid activation | Open |
| PLB-015 | P2 | Native cancellation copy contradicts the stored partial run | Open |
| PLB-016 | P2 | "All modes" history hides non-enhance runs via an implicit filter | Open |
| PLB-017 | P3 | Notebook Copy reports success on a rejected clipboard promise | Open |
| PLB-018 | P3 | Two-run compare helper still asks to select one more | Open |
| PLB-019 | P3 | Unknown routes silently normalize to the default workspace | Open |

## Audit inventory gaps (not counted as defects)

- Dual Pane is implemented but unreachable (no layout control or route)
- Configurable redaction rules have no production UI
- Trace NDJSON/dataset export has no reachable production caller
- Notebook lacks duplicate action and rendered Markdown preview
- Imported template `required` inputs are not enforced by the variable modal
- Privacy copy promises export of experiments/settings; reachable export covers Library only

## Unverified risks carried forward

Highest-value confirming tests the audit could not run safely: cross-account
local data exposure in one browser profile, sub-500 ms draft-loss timing,
corrupt `pl2-pads` recovery, orphaned IndexedDB rows after prompt deletion,
real provider 429/timeout/partial-stream behavior, installed-Tauri
persistence, billing return/webhook flows against staging Stripe, and
extension permission-revoke/upgrade paths. See the full audit for the exact
test recipes.

## Remediation order (audit's, abridged)

1. Acknowledged persistence (done), 2. revisions/conflict detection (done for
Notebook; Library revision scheme still open), 3. controlled dialogs (done),
4. transport-level abort (done), 5. truthful billing gating (done),
6. editor/library state coherence (PLB-007 remainder, PLB-008),
7. evaluation filter correctness, 8. idempotency guards, 9. destructive-action
confirmation/undo, 10. navigation history, 11. clipboard acknowledgement,
12. native cancellation truth, 13. regression coverage for all of the above.

## Verification record (2026-08-12 fix set)

- Extension `npm test`: 566 Vitest + 207 Node tests passing (audit baseline 554 + 207; +12 new regression tests)
- API safety `npm run test:api`: 66/66 passing (server contract unchanged)
- Fix set: PR #35 on `claude/promptlab-behavioral-audit-5v4eqj`
