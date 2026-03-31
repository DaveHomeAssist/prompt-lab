# Prompt Lab Glossary

## Purpose

This glossary standardizes the main product and documentation terms used across Prompt Lab.

## Core product terms

### Prompt Lab

The overall product and repository. A multi-surface prompt engineering workbench.

### shared frontend

The React application in `prompt-lab-extension/src/` that is reused across extension, desktop, and hosted web app shells.

### extension

The Chrome / Vivaldi MV3 side-panel runtime built from `prompt-lab-extension/`.

### desktop

The Tauri 2 desktop shell in `prompt-lab-desktop/` that loads the shared frontend.

### hosted web app

The deployed web application served publicly at `https://promptlab.tools/app/`.

### public landing page

The static public marketing and onboarding surface at `https://promptlab.tools/`.

### provider

An LLM service Prompt Lab can call, such as Anthropic, OpenAI, Google Gemini, OpenRouter, or Ollama.

### proxy

The Vercel Edge Function at `api/proxy.js` used by the hosted web app to forward browser requests to allowlisted provider APIs.

## UI and workflow terms

### Create

The authoring workspace in the shared frontend. It is a visible top-level product area.

### Library

The prompt library surface shown in the UI. In the current state model, this is not a separate `primaryView`; it is reached through `primaryView=create` plus `workspaceView=library`.

### Experiments

The evaluation and comparison surface for prompt runs and A/B workflows.

### Build

The visible UI label for the composer surface. In state terms, this maps to `workspaceView=composer`.

### Notebook

A visible top-level product area for longer-form notes and scratch work. Unlike `Library`, this is a true `primaryView`.

### command palette

The global action launcher used to jump to views and run high-level actions.

### scratchpad

The pad-based note surface inside the shared frontend. It supports a limited set of safe keyboard shortcuts and intentionally avoids overriding browser-reserved combinations.

## Documentation terms

### canonical doc

The source of truth for a domain. If other docs drift, the canonical doc wins unless the code proves otherwise.

### active doc

A maintained doc that should reflect the live system but is not the canonical top-level source.

### working doc

A session-specific or operational context file used to move work forward quickly. Useful, but not a stable product reference.

### audit

A time-bounded review of a system, flow, or documentation surface. Audits should be dated.

### historical doc

A retained snapshot that provides context but should not drive current implementation decisions.

### generated doc

A derived file or published output that should not be edited first when an authoring source exists elsewhere.

### authoring source

The file that should be edited first. For public HTML docs, this should usually live under `prompt-lab-web/` or `prompt-lab-web/public/`.

### published copy

The deploy-facing or exported version of a doc, typically under `docs/`.

## Documentation location terms

### repo entry point

`README.md`. The first doc a contributor should read.

### architecture reference

`ARCHITECTURE.md`. The canonical description of runtime surfaces, deployment model, and shared code layout.

### docs inventory

`DOCS_INVENTORY.md`. The documentation map plus source-of-truth rules.

### public docs

The user-facing HTML documentation pages such as guide, setup, privacy, and prompt embed docs.

### internal technical docs

Implementation-focused markdown docs under `prompt-lab-source/docs/`, such as audits, system references, and technical behavior notes.

## Preferred naming

Prefer these exact phrases in active docs:

- `extension`
- `desktop`
- `hosted web app`
- `public landing page`
- `shared frontend`

Avoid substituting older labels like `public web deployment` or `GitHub Pages site` unless you are explicitly describing legacy behavior.
