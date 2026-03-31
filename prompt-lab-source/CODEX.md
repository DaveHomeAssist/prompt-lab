# Codex — PromptLab

## Codex branch conventions

- Branch naming: `sprint-N-[description]` branched from task branch
- Pre-sprint: create sub-branches manually before launching parallel agents
- Worktree note: Project is in git root `/prompt-lab-source/` — standard worktree isolation available
- Active repo base path: `/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab-main-clean/prompt-lab-source/`
- Open blocker: D-001 (nav strategy) must be resolved before Phase 2 UI work begins

## Dave OS — Architecture (2026-03-28)

### Agent roster

| Agent | Role | Trigger | Scope |
|-------|------|---------|-------|
| Jerri | Personal OS operator | Chat | Notion, Dev, Home, Work, Creative |
| Claude Code | Repo-level execution | Claude Code session | Git, files, builds, deploys |
| Codex | Multi-file scans, parallel sprints | Codex session | Codebase, branches |
| Daily Prophet | Daily briefing | 6 AM / 10 PM ET | Notion, Web |
| DBX Keeper | Database of Databases index | Manual / audit | Notion |
| Prompt Keeper (KEEPER) | Prompt library maintenance | Weekly Mon / new prompt | Notion |
| ARIA | Research orchestrator | On demand | Notion, Web, Research |

### Reference DBs

| Name | ID | Purpose |
|------|----|---------|
| DB \| Projects | 1f2255fc8f448128994df83b59539ded | Active project tracking |
| DB \| Decisions | 67f9dabd1e824f938fb3c7dce81e0da6 | Live decision tracking |
| DB \| Technical Decisions Log | c9512134df8141fe8f3403536a7fdc4e | ADR layer (post-decision) |
| DB \| Code Dashboard | 42d255fc8f44830d8e7a81f940ebb474 | Work items, blockers, risks |
| DB \| LLM Conversation Notes | 31aae099cd24465bbb9b969bf9a936b5 | Cross-LLM capture |
| DB \| Agents | 969ea997069d4e4c9c78e98e25248ccf | Agent registry |
| DB \| AI Workflows | 252255fc8f4480adb30cceff254ad140 | Workflow catalog |
| DB \| Prompts | 255255fc8f4480f2a90ec15b81f80f93 | Prompt library |

### Project directives

- Query before writing — always fetch current state before modifying any Notion page or DB
- Do not create new databases or pages without checking if one already exists
- No destructive actions (deletes, overwrites) without explicit user confirmation
- Log any decision surfaced during work to DB \| Decisions
- If scope > 1 hour, create a DB \| Projects task instead of executing inline
- All agent pages must follow GOV \| Agent Page Nomenclature
- `| LIVE` pages are protected — every edit is a deployment, no working notes on `| LIVE` pages

### Agent page naming

- `AGT PRF | [Name]` — top-level folder, identity, status
- `AGENT | [Name] | LIVE` — live config, protected, deployment on every edit
- `RPT | [Name] — Report Card` — scoring history
- `REF | [Name] — Edit Log` — instruction change history
- Version tags: Major (behavior change) / Minor (new capability) / Patch (clarification)
- Patches go direct to LIVE. Minor/major: draft in REF first, then apply to LIVE in one pass.

### Open decisions (as of 2026-03-28)

- D-001: PromptLab nav strategy — RECOMMENDATION: hash mode — PENDING
- D-003: DaveLLM LAN IPs (GP66, Katana x2, Duncan) — PENDING
- D-006: Trailkeeper store schema — DEFERRED
- D-010: PromptLab feature gating (free / $9 / $100) — PENDING
- ShieldBox URL + brand spelling — PENDING

### Workflows

- WF-01 New Agent Onboarding: AGT PRF → AGENT \| LIVE → RPT → REF → DB \| Agents row
- WF-02 Decision Capture: log to DB \| Decisions (Pending) → when made, write ADR to DB \| Technical Decisions Log
- WF-04 Session Close: update Daily Notes, reset Code Dashboard LIVE Do Now, log new decisions and tasks

### Governance references

- GOV \| Agent Page Nomenclature: https://www.notion.so/331255fc8f4481068c7ee8c10d0affc6
- REF \| Workflows — Dave OS: https://www.notion.so/331255fc8f4481eeb9f0f3d4d3e86390
- Code Dashboard — LIVE: https://www.notion.so/331255fc8f44819d9d88c8ef21105082
- REF \| Agent Update — Capture Metadata Split: https://www.notion.so/331255fc8f4481d48b1df5a50c1284da
