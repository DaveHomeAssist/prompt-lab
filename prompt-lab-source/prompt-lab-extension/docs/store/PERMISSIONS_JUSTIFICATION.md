# Permissions Justification

## Permissions

| Permission | Justification |
|---|---|
| `storage` | Required to persist API keys, provider selection, prompt library, and application settings via `chrome.storage.local`. |
| `sidePanel` | Required because Prompt Lab is delivered as an MV3 side panel and `panel.html` is opened through the `side_panel.default_path` manifest entry. |

## Non-permissions notes

- The extension does not request `<all_urls>`.
- The extension does not inject content scripts into arbitrary pages.
- Network access is limited to the configured provider APIs and local Ollama loopback endpoints.

## Host Permissions

| Domain | Justification |
|---|---|
| `https://api.anthropic.com/*` | The background service worker sends user-composed prompts to the Anthropic Messages API (`/v1/messages`) when Anthropic is the selected provider. |
| `https://api.openai.com/*` | The background service worker sends user-composed prompts to the OpenAI Chat Completions API (`/v1/chat/completions`) when OpenAI is the selected provider. |
| `https://generativelanguage.googleapis.com/*` | The background service worker sends user-composed prompts to the Google Gemini `generateContent` endpoint when Gemini is the selected provider. |
| `https://openrouter.ai/*` | The background service worker sends user-composed prompts to the OpenRouter Chat Completions API (`/api/v1/chat/completions`) when OpenRouter is the selected provider. |
| `http://localhost:11434/*` | Required to reach a locally running Ollama instance on its default port when Ollama is the selected provider. |
| `http://127.0.0.1:11434/*` | Alternate loopback address for locally running Ollama, ensuring connectivity regardless of how the user's system resolves localhost. |
