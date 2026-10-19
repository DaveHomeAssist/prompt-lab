# Permissions Justification

Reviewer text for the Chrome Web Store Privacy practices tab. Every entry
matches `extension/manifest.json` (the packaged manifest; `public/manifest.json`
is identical). The extension declares no `optional_permissions`,
`optional_host_permissions`, or `content_scripts`, and does not request
`<all_urls>` or `tabs`.

## Single purpose

Prompt Lab is a browser side-panel workspace for writing, refining, testing,
and saving AI prompts with the AI provider the user chooses.

## Permissions

| Permission | Justification | Used in |
|---|---|---|
| `storage` | Saves the user's provider choice, API keys, model settings, and session state locally with `chrome.storage.local` / `chrome.storage.session` so the workspace persists. Nothing is synced to a server. | `extension/background.js` (`chrome.storage.local.get`), `extension/options.js` (`get`/`set`), `src/lib/platform.js` (`chrome.storage.session`) |
| `sidePanel` | Prompt Lab's UI is the side panel (`side_panel.default_path: panel.html`); the service worker sets it to open when the toolbar icon is clicked. | `extension/background.js` (`chrome.sidePanel.setPanelBehavior`), manifest `side_panel` |
| `activeTab` | When the user clicks Capture Page, Prompt Lab reads the selected text, title, and URL of the tab the user is viewing and inserts them into the draft. `activeTab` limits this to the tab the user invoked the extension on, with no install warning and no background access. | `extension/background.js` (`CAPTURE_CONTEXT`: `chrome.tabs.query` + `chrome.scripting.executeScript`), triggered by the Capture Page button (`src/EditorActions.jsx`) through `src/lib/platform.js` (`extCaptureContext`) |
| `scripting` | Required for `chrome.scripting.executeScript` in the Capture Page action above. The injected function only returns `window.getSelection()`, `document.title`, and `location.href`; it does not modify the page. Runs only on user click, only on `http(s)` pages. | `extension/background.js` (`CAPTURE_CONTEXT`) |

## Host Permissions

| Host | Justification | Used in |
|---|---|---|
| `https://promptlab.tools/*` | Prompt Lab's own API. Receives usage analytics events only after the user chooses Allow analytics. The extension build has no billing UI and sends no billing requests. Never receives prompt text, responses, or API keys. | `src/hooks/useTelemetryState.js` (`/api/telemetry`), base URL in `src/lib/telemetry.js` |
| `https://api.anthropic.com/*` | Sends the user's prompt to the Anthropic Messages API (`/v1/messages`) with the user's own key when Anthropic is the selected provider. | `extension/lib/providers.js` |
| `https://api.openai.com/*` | Sends the user's prompt to the OpenAI Chat Completions API (`/v1/chat/completions`) when OpenAI is selected. | `extension/lib/providers.js` |
| `https://generativelanguage.googleapis.com/*` | Sends the user's prompt to the Google Gemini `generateContent` endpoint when Gemini is selected. | `extension/lib/providers.js` |
| `https://openrouter.ai/*` | Sends the user's prompt to the OpenRouter Chat Completions API (`/api/v1/chat/completions`) when OpenRouter is selected. | `extension/lib/providers.js` |
| `http://localhost:11434/*` | Reaches a locally running Ollama server on its default port (model list and generation) when Ollama is selected. | `extension/lib/providers.js` (`listOllamaModels`, generation), `extension/options.js` |
| `http://127.0.0.1:11434/*` | Same local Ollama server via the loopback IP, for systems where `localhost` does not resolve to it. | same as above |

## Notes for reviewers

- No remote code: all JavaScript ships in the package; the extension uses the default MV3 content security policy.
- The extension does not inject content scripts into pages. The only page access is the user-initiated Capture Page action above.
- Network access is limited to the hosts listed above.
- Test path without paid keys: install Ollama, run `ollama pull llama3.2:3b`, choose Ollama in Settings, keep `http://localhost:11434`, then type a prompt in the side panel and click Refine Prompt.
