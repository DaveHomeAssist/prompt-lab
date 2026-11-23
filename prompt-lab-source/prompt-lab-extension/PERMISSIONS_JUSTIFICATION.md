# Permissions Justification

Reviewer text for the Chrome Web Store Privacy practices tab. Every entry
matches `extension/manifest.json` (the packaged manifest; `public/manifest.json`
is identical). The extension declares no `optional_permissions`,
`optional_host_permissions`, or manifest `content_scripts`, and does not request
`<all_urls>` or `tabs`.

## Single purpose

Prompt Lab is a browser side-panel workspace for writing, refining, testing,
and saving AI prompts with the AI provider the user chooses.

## Permissions

| Permission | Justification | Used in |
|---|---|---|
| `storage` | Saves the user's provider choice, API keys, model settings, and session state locally with `chrome.storage.local` / `chrome.storage.session` so the workspace persists. Nothing is synced to a server. | `extension/background.js` (`chrome.storage.local.get`), `extension/options.js` (`get`/`set`), `src/lib/platform.js` (`chrome.storage.session`) |
| `sidePanel` | Prompt Lab's UI is the side panel (`side_panel.default_path: panel.html`); the service worker sets it to open when the toolbar icon is clicked. | `extension/background.js` (`chrome.sidePanel.setPanelBehavior`), manifest `side_panel` |
| `activeTab` | When the user clicks Capture Page, or a Prompt Lab context-menu item, Prompt Lab reads the selected text on that tab. `activeTab` limits this to the tab the user just invoked the extension on. | `extension/background.js` (`CAPTURE_CONTEXT`), `extension/highlight-menus.js` (context-menu click) |
| `scripting` | Runs the one-shot Capture Page read, and injects `highlight-content.js` into the isolated world after the user chooses Enhance or Send. The injected script edits the selection only after Accept, or copies the result if the edit cannot be verified. It has no API keys. | `extension/background.js`, `extension/highlight-menus.js` |
| `contextMenus` | Adds "Enhance with Prompt Lab" and "Send to Prompt Lab" to the menu that appears when text is selected. The items are removed when the user turns the right-click menu off in Settings. | `extension/highlight-menus.js`, `extension/options.js` |

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
- The manifest declares no `content_scripts` and no `web_accessible_resources`. Page access is the user-initiated Capture Page read, plus `highlight-content.js` injected into the isolated world only after a context-menu click. Page scripts cannot read the extension's storage or keys. The card is a closed shadow tree and assigns selection text with `textContent` only.
- Network access is limited to the hosts listed above.
- Test path without paid keys: install Ollama, run `ollama pull llama3.2:3b`, choose Ollama in Settings, keep `http://localhost:11434`, then type a prompt in the side panel and click Refine Prompt.
