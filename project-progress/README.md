# PromptLab progress contract

`index.html` is the canonical local visual issue list and feature sprint. Open it directly in a browser; it is self-contained, uses no network requests, and is not a live Notion client. Keep this directory outside deployment outputs. Publication requires an explicit request.

## Required update triggers

Refresh after meaningful implementation, verification, merge, release, blocker, or scope changes and before reporting the affected work complete. Explicit read-only/no-write instructions override this workflow. Do not generate churn for unchanged polling.

## Update sequence

1. Read the shared workspace contract and project `AGENTS.md`. Preserve dirty checkouts; use an isolated worktree and the serialization claim before edits.
2. Fetch [Issue Backlog](https://app.notion.com/p/46a2b403f9594bbd8b5f0d7642d81d3f) and data source `collection://177c6bc5-3280-40dd-8961-871e040ccfe6`. Fetch each affected page before editing. Reuse its row; do not create duplicates or change the schema.
3. Inspect current Git/PR/CI/artifact/runtime evidence for affected claims. Patch the existing row with its actual status, dated evidence, remaining gap, and one verb-led next action. Use the live schema (currently Issue, Status, Severity, Area, Type, Notes, Refs; Status values Not started, In progress, Done). Preserve prior notes. Done requires the entire acceptance contract, including runtime gates when applicable. Record verification in the existing [implementation RUN](https://app.notion.com/p/3d2255fc8f44810a85d4e3fec5ddc6f2); do not claim release readiness from builds alone.
4. Fetch every write back. If a write or readback fails, report that exact failure and leave synchronization unverified. No secrets, provider payloads, tokens, or private keys belong in these artifacts.
5. Query the complete table, not a filtered view. Follow pagination until exhausted. Capture url, Issue, Status, Severity, Area, Type. SQL is acceptable for these display fields; use faithful rows or page fetches for rich-text evidence and never rewrite Notes from lossy SQL. Reconcile row count and unique IDs.
6. Refresh `status.json`: normalize those display fields, preserve issue IDs and source links, set `snapshotAt` to the actual collection time, record `source.complete`, main SHA, evidence, and outstanding next actions. `inPlan` means membership in the explicitly approved 14-item plan; it is not implied by In progress. Preserve all other active/backlog rows without treating them as a newly authorized sprint. Never overwrite an unavailable source with guessed current facts; retain its last snapshot, label the gap, and retain the old timestamp.
7. Under Node 22 run `node prompt-lab-source/scripts/render-project-progress.mjs`, then the same command with `--check`. The renderer validates source data and emits a deterministic standalone HTML file; it does not fetch Notion or advance timestamps. Update the template for visual changes, not the generated HTML.
8. For presentation/interaction changes, verify desktop and mobile widths, keyboard focus, search/status/scope filters, empty results, view switching, and print layout. Check that there are no network requests or horizontal page overflow. Data-only refreshes require schema/render checks and count/link inspection.
9. Commit the affected JSON/template/renderer/generated HTML and deliver through normal PR/check/merge rules. Read back Notion again after any further correction. In closeout report Notion write/readback, dashboard snapshot time, Git/CI state, and Unknowns separately.

## Files and meanings

- `status.json`: allowlisted issue-table snapshot plus explicit current evidence; source for counts and sprint membership.
- `dashboard.template.html`: semantic layout, responsive styling, and local interactive filters.
- `index.html`: generated, portable visual document; do not hand-edit.
- `../prompt-lab-source/scripts/render-project-progress.mjs`: Node-only renderer and consistency check.

Issue counts describe recorded Notion dispositions. Evidence cards describe inspected verification. Neither is an overall production-readiness percentage. No calendar commitments, owners, or new sprint scope may be inferred from a status alone. This contract requires agent/operator updates; it creates no scheduled automation or external service.
