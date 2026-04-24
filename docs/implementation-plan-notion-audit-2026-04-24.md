1. PROJECT SUMMARY

Objective
- Execute the remaining 2026-04-23 Notion ops audit remediation across task, project, and log databases, using the completed PromptLab cleanup as wave 1 and the broader audit artifacts as the authoritative work queue.

Key outcomes
- High-confidence stale or completed rows in `DB | Action Items` are closed, deferred, or rewritten with concrete next actions.
- Mis-routed development work is moved or mirrored into canonical developer tracking (`DB | Development Tasks (Tier 2) (CANON)` or `DB | Software Development`) without losing priority or context.
- Stale project rows in `DB | Projects` gain owners, next actions, and hub links, or are explicitly archived/deferred.
- Duplicate clusters and unresolved PromptLab/CueForge items are normalized against a single canonical row.
- Every mutation is logged in an execution artifact, while the original audit files remain read-only.

Assumptions
- The primary scope is Notion operations work, not code implementation, unless a row closure explicitly requires a short verification against the local repo or production state.
- `report.md` and `action-table.csv` in `/Users/daverobertson/Desktop/Code/90-governance/audits/2026-04-23-notion-ops/` are the authoritative audit inputs.
- `execution-status.csv` in the same directory is the write-ahead log for completed mutations and should be appended as work is executed.
- The PromptLab mutations already completed on 2026-04-23 are done and should not be repeated unless verification shows drift.
- Low-confidence “Done-uncaptured” and “Decide” items require owner confirmation before closure if evidence is incomplete.

2. PHASED IMPLEMENTATION PLAN

Phase Name
- Phase 1: Baseline Lock And Work Queue Segmentation

Goal
- Freeze the audit baseline, isolate the actionable rows, and define the execution batches so work proceeds without corrupting the original audit record.

Key Milestones
- Treat `action-table.csv` and `report.md` as read-only source artifacts.
- Split the action table into four batches: `Close`, `Update`, `Route`, and `Decide`.
- Mark PromptLab rows already executed by cross-checking against `execution-status.csv`.
- Tag each remaining row with confidence and required evidence source before mutation.
- Create a working checklist for unresolved high-confidence rows first.

Dependencies
- Access to the audit directory and Notion write permissions.
- Confirmed availability of the target Notion databases.

Required Resources
- Notion connector/tools
- Audit files: `report.md`, `action-table.csv`, `execution-status.csv`
- Operator with workspace context

Estimated Timeline
- 0.5 day

Owner / Responsible Party
- Primary: Notion operator
- Approver for ambiguous closures: Dave

Risks / Failure Points
- Editing directly from the audit table without a working batch can cause missed rows or duplicate changes.
- Re-executing already-completed PromptLab changes can create noisy history and false churn.

Phase Name
- Phase 2: High-Confidence Closures And Fast Hygiene Fixes

Goal
- Remove obvious dead weight first so the active queue reflects reality before heavier rerouting and project normalization starts.

Key Milestones
- Close/archive explicitly temporary rows such as the Notion smoke-test entry.
- Mark already-captured preference or note rows as done when evidence is explicit.
- Apply sub-5-minute fixes called out in the audit, such as mirroring known values or completing obvious UI-only tasks.
- Rewrite verb-only or empty-status rows only when the missing next step can be derived confidently from the evidence.
- Log every mutation into `execution-status.csv` immediately after verification.

Dependencies
- Phase 1 working batch complete.
- Supporting evidence available in audit notes, recent logs, or existing Notion pages.

Required Resources
- Notion write access
- Audit evidence
- Local repo or notes for quick validation where needed

Estimated Timeline
- 0.5 to 1 day

Owner / Responsible Party
- Primary: Notion operator
- Validation support: Dave for any closure that is not self-evident

Risks / Failure Points
- Closing a “Done-uncaptured” row without sufficient evidence can delete a still-open commitment.
- Small hygiene tasks can sprawl if they are allowed to become ad hoc cleanup outside the audit queue.

Phase Name
- Phase 3: Developer Task Routing And Canonicalization

Goal
- Move software work out of mixed personal/admin queues and into the correct developer tracking systems so engineering work is visible and operable.

Key Milestones
- Route mis-routed development rows from `DB | Action Items` into `DB | Software Development` or `DB | Development Tasks (Tier 2) (CANON)` based on the audit recommendation.
- Preserve original priority, project association, and blocking context during rerouting.
- Unblock CueForge “CANON blocked” tasks now that the project option exists, and retire superseded deferred copies.
- Reconcile PromptLab residual items that were identified in the broader audit but not yet executed, including preview-to-production and library recovery decisions.
- Verify that the destination DB now contains the live developer queue and the source row is marked superseded, archived, or linked forward.

Dependencies
- Phase 2 completed for high-confidence closures.
- Destination schemas confirmed for project, status, owner, and priority fields.

Required Resources
- Notion write access
- Schema knowledge for `DB | Software Development` and `DB | Development Tasks (Tier 2) (CANON)`
- Audit evidence and project context

Estimated Timeline
- 1 to 2 days

Owner / Responsible Party
- Primary: Notion operator
- Review for engineering intent: Dave

Risks / Failure Points
- Rerouting without preserving links or priorities can orphan work again under a different database.
- The `DB | Software Development` database currently appears underused; if schema or workflow expectations are unclear, rows may be routed into another dead queue.

Phase Name
- Phase 4: Project Metadata Normalization

Goal
- Repair stale project rows so every ongoing project has a single canonical surface with owner, next action, and hub linkage.

Key Milestones
- Process the stale `DB | Projects` rows identified in the audit, starting with `SFT | SAP`, `SFT | Home Lab`, and `SFT | Freelance`.
- Add or repair `Next Action`, owner, and hub page links for live projects.
- Archive or repurpose placeholder and obviously non-operational project rows.
- Fix project naming defects and metadata drift, including title typos and missing operational hooks.
- Confirm whether archived duplicate PromptLab project rows should remain as history or be explicitly marked superseded.

Dependencies
- Phases 1 through 3 complete enough to know which tasks belong to which projects.
- Access to existing hub pages or decision to create them later.

Required Resources
- Notion write access
- Project pages and linked task views
- Owner/approver input for low-confidence archival decisions

Estimated Timeline
- 1 day

Owner / Responsible Party
- Primary: Notion operator
- Final project-state approval: Dave

Risks / Failure Points
- Adding placeholder next actions just to satisfy the field will make the database look cleaner without improving execution.
- Archiving the wrong project row can break backlinks and historical continuity.

Phase Name
- Phase 5: Duplicate Resolution, Verification, And Final Reporting

Goal
- Resolve remaining duplicate clusters, verify the workspace is internally consistent, and publish a final change record that operators can trust.

Key Milestones
- Resolve the audit’s duplicate clusters, starting with PromptLab preview-to-production and CueForge deferred duplicates.
- Verify no high-confidence stale rows from the audit remain unaddressed without an explicit decision.
- Spot-check that updated tasks appear correctly in their target views and filters.
- Reconcile the final mutation count against `execution-status.csv`.
- Produce a concise completion report summarizing changed rows, deferred decisions, and follow-up items.

Dependencies
- All prior phases complete.
- Remaining low-confidence items either resolved or explicitly left pending decision.

Required Resources
- Notion write/read access
- Audit artifacts
- Execution log

Estimated Timeline
- 0.5 to 1 day

Owner / Responsible Party
- Primary: Notion operator
- Sign-off: Dave

Risks / Failure Points
- Duplicate rows can look resolved in one view while remaining open in another due to filters or archived-state differences.
- Final reporting will be misleading if execution logging was not maintained during earlier phases.

3. EXECUTION NOTES

Critical sequencing constraints
- Keep `report.md` and `action-table.csv` immutable; record actual mutations only in `execution-status.csv` and Notion.
- Execute `Close` and `Update` batches before large-scale rerouting so obvious noise does not pollute destination databases.
- Route developer work before normalizing project metadata; projects need their true active tasks linked first.
- Do not close low-confidence PromptLab deploy items until production state or recent deployment notes confirm the result.
- Do not archive duplicate project rows until the canonical row is verified complete and current.

Parallelizable work
- High-confidence `Close` actions in `DB | Action Items` can run in parallel with `DB | Projects` metadata cleanup if different operators are available.
- LLM-note reconciliation and project-next-action rewriting can run in parallel with developer-task routing when write scopes do not overlap.
- Duplicate-cluster review can run in parallel with final verification once routing is substantially complete.

Quick wins vs long-lead tasks
- Quick wins: temporary smoke-test closure, captured-preference closure, explicit UI-only Notion fixes, known-value mirroring, empty `Status` fixes, verb-only rewrites with clear evidence.
- Medium effort: CueForge rerouting, project next-action normalization, Action Items to Software Development migration.
- Long lead: low-confidence PromptLab deployment closure, project archival decisions with poor evidence, any item requiring owner confirmation or production verification.

4. NEXT ACTIONS

1. Open `action-table.csv` and produce a working batch containing only rows not already represented in `execution-status.csv`.
2. Execute the highest-confidence `Close` items first: the Notion smoke-test row and the “push always” preference row, then log both mutations in `execution-status.csv`.
3. Fetch and process the CueForge “DEFERRED — CANON blocked” cluster, moving each live task into `DB | Development Tasks (Tier 2) (CANON)` and archiving the superseded deferred copies.
4. Verify the current state of `PromptLab: Promote preview to production` and `PromptLab: Deploy library recovery system to promptlab.tools` against recent logs or hosted state before deciding close vs reopen.
5. Update the first three stale project rows in `DB | Projects` (`SFT | SAP`, `SFT | Home Lab`, `SFT | Freelance`) with owner, next action, and hub-page disposition, then log the results.
