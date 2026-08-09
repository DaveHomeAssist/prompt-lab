# Notion Docs Agent

This repo now includes a GitHub Actions driven Notion sync agent at `scripts/notion-docs-agent.mjs`.

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
- `DOCS_AGENT_PROVIDER`
  - `none`, `openai`, or `anthropic`
  - Default: `none`
- `DOCS_AGENT_MODEL`
  - Default: `gpt-4.1-mini`
- `DOCS_AGENT_MAX_DOCS`
  - Default: `6`
- `DOCS_AGENT_MAX_CHARS_PER_DOC`
  - Default: `5000`

## Trigger behavior

The workflow runs on:

- manual dispatch
- pushes to `main` that touch markdown or workflow files
- completion of selected CI workflows via `workflow_run`

The `workflow_run.workflows` list currently expects:

- `Extension CI`
- `Desktop Build`
- a web deployment workflow if you want hosted-site changes to trigger docs sync

If your actual workflow names differ, update `.github/workflows/notion-docs-agent.yml`. The older `GitHub Pages` example is stale now that the public site is deployed through Vercel.

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
