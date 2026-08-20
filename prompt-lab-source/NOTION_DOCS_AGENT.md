# Notion Docs Agent

This repo includes a Notion documentation report generator at `scripts/notion-docs-agent.mjs` and a manual-only workflow at `.github/workflows/notion-docs-agent.yml`.

The workflow is deliberately not triggered by pushes or other workflows. An earlier automatic workflow was removed because it ran on broad markdown changes and failed when the complete Notion configuration was unavailable. The restored workflow defaults to a credential-free dry run; a live Notion write requires an explicit manual choice on `main`.

It is designed to:

- read the current GitHub Actions event payload
- inspect tracked markdown docs in the repo
- summarize docs changes deterministically or with an optional LLM
- upsert a Notion child page under a configured parent page

## Files

- `.github/workflows/notion-docs-agent.yml`
- `scripts/notion-docs-agent.mjs`
- `scripts/notion-docs-agent.test.mjs`

## Required secrets

These are required only for a live write. The default dry run does not use them.

- `NOTION_TOKEN`
  - Internal integration token with access to the target workspace page.
- `NOTION_PARENT_PAGE_ID`
  - The Notion page ID that should receive the generated child pages.

## Optional secrets

- `OPENAI_API_KEY`
  - Required only when `DOCS_AGENT_PROVIDER=openai`.
- `ANTHROPIC_API_KEY`
  - Required only when `DOCS_AGENT_PROVIDER=anthropic`.

## Optional repository variables

- `NOTION_DOCS_PAGE_TITLE`
  - Default: `Prompt Lab GitHub Docs Sync`
- `DOCS_AGENT_MAX_DOCS`
  - Default: `6`
- `DOCS_AGENT_MAX_CHARS_PER_DOC`
  - Default: `5000`

The GitHub workflow deliberately pins `DOCS_AGENT_PROVIDER=none`. Local runs may set `DOCS_AGENT_PROVIDER` to `openai` or `anthropic` and optionally set `DOCS_AGENT_MODEL`; those modes require the matching API-key environment variable.

## Trigger behavior

The workflow runs only through `workflow_dispatch`.

- `write_to_notion=false` (default) runs tests and prints the generated report without credentials or external writes.
- `write_to_notion=true` is allowed only from `main`, verifies that `NOTION_TOKEN` can retrieve `NOTION_PARENT_PAGE_ID`, and then uses those values to upsert the report page.

There are intentionally no `push` or `workflow_run` triggers. Add broader triggers only after both required secrets are configured, a manual live sync has been read back in Notion, and repeated-write behavior is verified.

## GitHub dry run

From the Actions tab, choose **Notion Docs Agent**, leave **Write the report to Notion** disabled, and run the workflow on `main`. This verifies checkout, Node 22, the agent test, and report generation without touching Notion.

## GitHub live sync

Before enabling **Write the report to Notion**:

1. Configure both required repository secrets.
2. Confirm the integration can access the intended parent page.
3. Select the `main` branch.
4. Confirm the read-only parent access step succeeds before the sync step runs.
5. Read the resulting page back in Notion before considering any automatic trigger.

## Local dry run

```bash
cd prompt-lab-source
DOCS_AGENT_DRY_RUN=1 npm run notion:docs-agent
```

Dry-run mode prints the generated report JSON instead of calling Notion.

## Local test

```bash
cd prompt-lab-source
npm run test:notion-agent
```

## Notes

- The agent is dependency-free and uses the Node 22 runtime declared in `.nvmrc`.
- When `DOCS_AGENT_PROVIDER=none`, summaries are deterministic and do not require an external model API key.
- Notion pages are created or updated as direct children of `NOTION_PARENT_PAGE_ID`.
- The page title is scoped by workflow name and branch so repeated runs update the same logical page instead of creating a new page for every run.
- Live sync replaces the target page's child blocks. Keep the workflow manual until the target and readback behavior are verified.
