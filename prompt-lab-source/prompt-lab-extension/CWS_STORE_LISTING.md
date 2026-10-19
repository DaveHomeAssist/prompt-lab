# Chrome Web Store Listing Draft

Copy for the Chrome Web Store dashboard. Field-by-field values for a
submission live in the release's `SUBMISSION.md`; this file is the source copy.

## 1. Summary

The store summary is the manifest `description` (CWS limit: 132 characters).
Keep this line identical to `extension/manifest.json` and `public/manifest.json`:

AI prompt enhancer, library, composer, A/B tester, and notepad. Supports Anthropic, OpenAI, Gemini, OpenRouter, and Ollama.

(123 characters.)

## 2. Full Description

Prompt Lab is a prompt engineering workspace that lives in your browser side panel. Write a prompt, refine it, compare versions across AI models, and save the ones that work, without leaving the page you are on.

Prompt Lab works with Anthropic, OpenAI, Google Gemini, OpenRouter, and Ollama. Hosted providers use your own API key. If you prefer local models, point it at Ollama running on your machine.

### What you can do

- Enhance and rewrite prompts with better structure, specificity, and clarity
- Compare prompt variants side by side with A/B testing and keep the run history
- Save prompts to a reusable library with tags, collections, and JSON import/export
- Build larger prompts from reusable blocks in the composer
- Keep working notes in the built-in Scratch notepad and promote them to prompts
- Run prompt linting and quality checks while you write
- Scan for potentially sensitive content before a prompt is sent
- Capture the selected text, title, and URL of the current page into your draft with one click

### Who it is for

People who iterate on prompts: AI power users, prompt engineers, researchers, writers, and developers who compare models or reuse prompt workflows.

### How it works

Click the Prompt Lab toolbar icon to open the side panel. Choose a provider in Settings, add your API key or your local Ollama address, and start writing. The side panel stays open while you browse.

### Privacy

Your prompts, library, settings, and API keys are stored locally in your browser. Prompts go directly from your browser to the AI provider you choose. Prompt Lab has no account requirement for the extension. Usage analytics are off until you choose Allow analytics. Page capture runs only when you click Capture Page. Full policy: `https://promptlab.tools/privacy`

Prompt Lab also has a hosted web app at `https://promptlab.tools/app/`.

## 3. Category

`Developer Tools`. The old `Productivity` category was split in 2023 and is
no longer selectable; `Workflow & Planning` is the alternative.

## 4. Key Features

- Multi-provider support for Anthropic, OpenAI, Gemini, OpenRouter, and Ollama
- Side panel workflow that stays open while you browse
- Prompt enhancement with reusable optimization modes
- A/B prompt testing with saved run history
- Prompt library with tags plus JSON import/export
- Prompt composer for building larger prompts from reusable parts
- Prompt linting and sensitive-data scanning before send
- One-click page capture (selection, title, URL) into the draft

## 5. Permissions Explanation

See [PERMISSIONS_JUSTIFICATION.md](./PERMISSIONS_JUSTIFICATION.md) for the
reviewer text for every permission. In short:

- `storage`: settings, provider keys, and app state persist locally.
- `sidePanel`: Prompt Lab runs in Chrome's side panel.
- `activeTab` + `scripting`: the Capture Page button reads the current tab's selection, title, and URL, only when the user clicks it.
- Provider host access: requests go only to the AI provider the user selects, plus local Ollama.
- `promptlab.tools`: opt-in usage analytics and Prompt Lab Pro license checks.

## 6. Pricing and in-app purchases

All extension features are available without payment today
(`FEATURE_GATES_ENABLED = false` in `src/lib/billing.js`). The extension still
shows an Upgrade button and a Prompt Lab Pro dialog ($9/month, $99/year via
Stripe), but the extension has no sign-in, so checkout stops at "Sign in to
Prompt Lab before syncing billing." Do not advertise Pro in the listing until
the extension can complete a purchase. Decide the dashboard's Free / Contains
in-app purchases setting together with that UI.
