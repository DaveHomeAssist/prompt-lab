# PromptLab Behavioral Path & Failure Audit — 2026-08-11

Status: **Yellow → P1 gate complete; P2 remediation in progress**
Release recommendation at audit time: **Hold**
Remediation: all six P1 defects fixed 2026-08-12 on `claude/promptlab-behavioral-audit-5v4eqj` (PR #35)
P1 release gate: **Cleared 2026-08-12** after PLB-001…006 were re-audited under the same failure conditions against the fixed deployed artifact.
Follow-on release: PR #36 fixed PLB-009, PLB-011, and PLB-012 and was verified on production. Seven P2 findings remained after that release; this library-coherence release fixes PLB-007 and PLB-008, leaving five open P2 findings.

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

These figures are the 2026-08-11 audit baseline, not a rescored current-state
claim. Current remediation status is recorded in the defect register below.

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
| PLB-007 | P2 | Deleted-while-loaded prompt still reported "Prompt updated!" | **Fixed (library coherence release)** — a missing loaded target is written once as a new prompt after storage acknowledgement; the returned ID replaces stale `editingId` and content plus metadata are preserved |
| PLB-008 | P2 | Version restore left the loaded editor on the pre-restore content | **Fixed (library coherence release)** — restore writes are acknowledged before library/editor state changes; a loaded editor synchronizes content, metadata, active-entry state, and `editingId` without a use-count bump |
| PLB-009 | P2 | Browser Back never returns to the prior workspace | **Fixed (PR #36)** — route history now pushes workspace transitions and handles browser Back/Forward |
| PLB-010 | P2 | Evaluate Pass/Fail/Regressions filters change UI state but not results | Open |
| PLB-011 | P2 | Free deep link to `#/compare` silently renders History with no gate explanation | **Fixed (PR #36)** — free deep links normalize to Evaluate and open the Pro explanation instead of silently rendering History |
| PLB-012 | P2 | Reset Draft / mobile Clear destroy unsaved state without confirmation or undo | **Fixed (PR #36)** — desktop Reset Draft and mobile Clear require confirmation and retain bounded recovery/undo state |
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
6. editor/library state coherence (PLB-007, PLB-008; done in the library coherence release),
7. evaluation filter correctness, 8. idempotency guards, 9. destructive-action
confirmation/undo (done in PR #36), 10. navigation history (done in PR #36), 11. clipboard acknowledgement,
12. native cancellation truth, 13. regression coverage for all of the above.

## Verification record (2026-08-12 fix set)

- Extension `npm test`: 566 Vitest + 207 Node tests passing (audit baseline 554 + 207; +12 new regression tests)
- API safety `npm run test:api`: 66/66 passing (server contract unchanged)
- Fix set: PR #35 on `claude/promptlab-behavioral-audit-5v4eqj`
- Exact deployed P1 re-audit: PLB-001…006 passed under the original failure conditions; release provenance was closed after PR #36 merged and production resolved to protected `main`
- PR #36: PLB-009, PLB-011, and PLB-012 regression paths passed on the public hosted build
- Library coherence focused regression: 34/34 tests passing across `usePromptLibrary`, `usePersistenceFlow`, and `plbAuditFixes`
- Library coherence full verification: 582 Vitest + 207 Node tests, extension and web builds, API safety 66/66, docs lint, and quick preflight all passing under Node 22
