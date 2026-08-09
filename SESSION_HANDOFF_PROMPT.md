# Session Handoff Prompt

## 1. Workspace Context

- Repo path: `/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab`
- Branch: `main` tracking `origin/main`
- Project type: multi-surface prompt engineering product repo
- Stack:
  - React
  - Vite
  - Chrome / Vivaldi MV3 extension
  - Tauri 2 desktop shell
  - Node 22
  - Vitest
  - hosted web app with Vercel routing and edge proxy
- Live URLs:
  - landing/docs surface: `https://promptlab.tools/`
  - hosted app surface: `https://prompt-lab-tawny.vercel.app/app/`

## 2. Current Objective

- Most likely active task: finish or validate the landing/docs alignment work already in progress in:
  - `docs/index.html`
  - `prompt-lab-source/public/prompt-lab-landing.html`
- Product-level unresolved issues from `AGENTS.md` still point at:
  - Create workflow being too vertically stacked
  - experiments and run history still being split

## 3. Files / Surfaces That Matter

- `/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/AGENTS.md`
- `/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/README.md`
- `/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/IMPLEMENTATION_PLAN.md`
- `/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/PROMPT_LAB_AGENT.md`
- `/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/CURRENT_PROJECT_REPORT.md`
- `/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/docs/index.html`
- `/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/public/prompt-lab-landing.html`
- `/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/ARCHITECTURE.md`
- `/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/package.json`
- `/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/NOTION_DOCS_AGENT.md`

## 4. Known Good Facts

- Prompt Lab is a real product repo, not a single markdown/report workspace.
- The repo supports multiple surfaces from one shared codebase:
  - extension
  - desktop
  - hosted web app
  - public landing/docs
- Hosted web deployment uses a Vercel edge proxy for provider traffic.
- Live landing domain is `https://promptlab.tools/`.
- Live hosted app URL is `https://prompt-lab-tawny.vercel.app/app/`.
- Current git status shows dirty files:
  - modified: `docs/index.html`
  - modified: `prompt-lab-source/public/prompt-lab-landing.html`
  - untracked: `CURRENT_PROJECT_REPORT.md`
  - untracked: `PROMPT_LAB_AGENT.md`
  - untracked: `SESSION_INIT_PROMPT.md`
- Current landing/docs edits are moving metadata and links away from the old `prompt-lab-provider-options` / GitHub Pages identity and toward:
  - `https://promptlab.tools/`
  - `https://github.com/DaveHomeAssist/prompt-lab`
  - `https://prompt-lab-tawny.vercel.app/app/`

## 5. Guardrails

- Treat the current filesystem and git state as canonical.
- Do not assume the repo is only docs or only an app; it is both product code and public-facing marketing/docs.
- Do not overwrite or revert the existing dirty landing/docs edits unless the task explicitly requires changing them.
- Treat these user-owned or already-in-progress files as protected by default:
  - `docs/index.html`
  - `prompt-lab-source/public/prompt-lab-landing.html`
- Do not touch `archives/` unless explicitly asked.
- Do not rename repo surfaces or collapse extension, desktop, web, and docs into one conceptual app.
- Keep the following domain nouns true:
  - Prompt Lab
  - extension
  - desktop
  - hosted web app
  - landing/docs
  - providers: Anthropic, OpenAI, Gemini, OpenRouter, Ollama
- Treat `promptlab.tools` as the authoritative landing/docs URL and `prompt-lab-tawny.vercel.app/app/` as the authoritative hosted app URL unless the repo proves otherwise.
- Personalities only relevant here:
  - repo-local Prompt Lab guidance in `PROMPT_LAB_AGENT.md`
  - current repo report in `CURRENT_PROJECT_REPORT.md`
  - current session bootstrap in `SESSION_INIT_PROMPT.md`

## 6. Output Rules

- Be concise.
- Be execution-first.
- Separate findings, edits, and verification.
- Do not restate the request before acting.
- Do not widen scope speculatively.
- Use exact paths, files, URLs, and commands.
- Mark assumptions explicitly.

## 7. Priority Order

1. Confirm target surface:
   - landing/docs
   - hosted app
   - shared frontend
   - extension
   - desktop
2. Run git status and inspect only the files relevant to the task.
3. If the task is on landing/docs, inspect `docs/index.html` and `prompt-lab-source/public/prompt-lab-landing.html` first.
4. If the task is product/architecture, read `AGENTS.md`, `ARCHITECTURE.md`, and `CURRENT_PROJECT_REPORT.md` first.
5. Make the smallest correct change.
6. Run the narrowest relevant verification.
7. Return a short summary.

## 8. Verification

- `git -C /Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab status --short --branch`
- `git -C /Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab diff --stat -- docs/index.html prompt-lab-source/public/prompt-lab-landing.html`
- `sed -n '1,220p' /Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/AGENTS.md`
- `sed -n '1,260p' /Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/ARCHITECTURE.md`
- `sed -n '1,240p' /Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/CURRENT_PROJECT_REPORT.md`
- `sed -n '1,220p' /Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/PROMPT_LAB_AGENT.md`

## 9. Ready-to-Paste Session Prompt

```text
You are working in:
/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab

Use the current filesystem and git state as ground truth.

Repo context:
- Prompt Lab is a multi-surface prompt engineering product, not a markdown-only workspace.
- Surfaces include:
  - Chrome / Vivaldi MV3 extension
  - Tauri desktop shell
  - hosted web app
  - public landing/docs
- Live URLs:
  - https://promptlab.tools/
  - https://prompt-lab-tawny.vercel.app/app/

Inspect first:
- /Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/AGENTS.md
- /Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/PROMPT_LAB_AGENT.md
- /Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/CURRENT_PROJECT_REPORT.md
- /Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/ARCHITECTURE.md

Current dirty files already exist and should be treated as user-owned/in-progress unless the task explicitly targets them:
- /Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/docs/index.html
- /Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/public/prompt-lab-landing.html

Current likely focus:
- finish or validate landing/docs alignment to promptlab.tools and the current Prompt Lab repo/app URLs
- or address the known unresolved product issues:
  - Create workflow still too vertically stacked
  - experiments and run history still split

Guardrails:
- Do not restate the request before acting.
- Do not overwrite unrelated local edits.
- Do not touch archives/ unless explicitly asked.
- Do not collapse extension, desktop, web app, and docs into one surface.
- Use exact paths, commands, and verification.
- Separate findings, edits, and verification.
- Keep scope tight unless asked to expand it.

First commands to run:
- git -C /Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab status --short --branch
- git -C /Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab diff --stat -- docs/index.html prompt-lab-source/public/prompt-lab-landing.html
- sed -n '1,220p' /Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/AGENTS.md
- sed -n '1,260p' /Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/ARCHITECTURE.md

Then:
1. confirm the target surface
2. inspect only the needed files
3. implement or review
4. verify narrowly
5. return a short summary
```
