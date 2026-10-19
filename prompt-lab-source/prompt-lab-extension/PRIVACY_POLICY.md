# Privacy Policy — Prompt Lab

**Effective date:** 2026-03-12

## Scope

This policy applies to the Prompt Lab Chrome extension. Prompt Lab also has hosted web and desktop shells that reuse the same shared frontend, but this document is the privacy disclosure used for the extension distribution flow.

## Data Storage

Prompt Lab stores prompts, saved runs, settings, and provider keys locally on the user's device. For the extension, provider settings are stored in browser-managed local extension storage, and app state stays local to the browser environment.

## Data Transmission

The extension transmits data to:

- the AI provider explicitly selected and configured by the user for prompt execution
- Prompt Lab's analytics endpoint (`https://promptlab.tools/api/telemetry`), only if you choose Allow analytics

Supported providers are Anthropic, OpenAI, Google Gemini, OpenRouter, and Ollama (local). Prompt and response content is not sent to Prompt Lab endpoints.

## Page Capture

The extension's Capture Page button reads the selected text, title, and URL of the active tab only when you click it, using the `activeTab` and `scripting` permissions. The captured values are inserted into your draft locally. They leave the device only if you run a prompt that includes them, and then only to the AI provider you selected. The extension does not read pages in the background, keep browsing history, or send captured page content to Prompt Lab endpoints.

## Telemetry and Tracking

Prompt Lab can send limited product telemetry to developer-controlled endpoints, only after you choose Allow analytics (it is off by default). This includes event names, app surface, plan, anonymous device/session identifiers, and an optional contact email if you provide one in Settings. Prompt text, model responses, and provider API keys are not included in telemetry payloads.

## Billing

The Chrome extension is free. It has no billing UI, offers no purchases, and sends no billing requests to Prompt Lab or Stripe. Prompt Lab Pro is sold only in the hosted web app at promptlab.tools, which is covered by the privacy policy at <https://promptlab.tools/privacy>.

## Contact

If you have questions about this policy, please open an issue on the project's GitHub repository.
