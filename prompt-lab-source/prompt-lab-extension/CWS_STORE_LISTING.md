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
- `promptlab.tools`: opt-in usage analytics only (the extension build has no billing UI).

## 6. Pricing and in-app purchases

The extension is listed as **Free**. Every feature is available without
payment, and extension builds contain no purchase path: production builds
(`npm run build` / `npm run build:cws`) set `VITE_PROMPTLAB_BILLING_UI=off`
(`scripts/billing-ui-define.mjs`), which removes the plan badge, the Upgrade
button, the Settings billing card and the Prompt Lab Pro dialog. The extension
has no sign-in, so it could not complete a checkout anyway. Pro feature gates
never apply to extension builds. Do not mention Pro or paid plans in the
listing. Prompt Lab Pro is sold only in the hosted web app.

The options page has one static line, "Everything in this extension is free.
Prompt Lab Pro is a separate subscription for the hosted web app, sold by
Prompt Lab, not Google", with a "Pro features on the web" link to
`https://promptlab.tools/#pricing`. There is no popup, badge, counter or
repeated prompt (`tests/extension-pro-link.test.mjs`). Checked against the
Program Policies (Accepting Payment From Users, Misleading or Unexpected
Behavior, Quality Guidelines; <https://developer.chrome.com/docs/webstore/program-policies/policies>).
Owner decision: the distribution doc says "If you plan to use a third party
service to offer additional paid features or subscriptions, choose Contains in-app
purchases" (<https://developer.chrome.com/docs/webstore/cws-dashboard-distribution>).
Pro adds nothing to the extension itself, so **Free** remains defensible; choose
**Contains in-app purchases** if you want the conservative reading.
