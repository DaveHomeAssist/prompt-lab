# Prompt Lab Desktop

Tauri 2 desktop wrapper for Prompt Lab. The desktop shell reuses the shared React frontend from `../prompt-lab-extension/src/`.

## Stack

- React 18
- Vite 8
- Tailwind CSS
- Tauri 2

## Shared source model

- `index.html` loads `../prompt-lab-extension/src/main.jsx` directly.
- Desktop-only provider settings live in `src/lib/desktopApi.js` and use localStorage key `pl2-provider-settings`.
- Desktop platform behavior is routed through `src/lib/platform.js`, including the in-app settings modal trigger.

## Commands

```bash
nvm use
npm install
npm run dev
npm run build
npm run tauri:dev
npm run tauri:build
```

## Packaging

- Tauri config: `src-tauri/tauri.conf.json`
- macOS bundle identifier: `com.promptlab.desktop`
- Source app icon: `src-tauri/icons/icon.png` (1024x1024)
- Local verification:

```bash
PATH="$HOME/.cargo/bin:$PATH" npx tauri build --bundles app
PATH="$HOME/.cargo/bin:$PATH" npx tauri build --bundles dmg
```

## CI

- Extension tests run first in `.github/workflows/desktop-build.yml`.
- Desktop build matrix targets `macos-latest`, `ubuntu-22.04`, and `windows-latest`.
- Linux runners install `libwebkit2gtk-4.1-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, and `patchelf`.

## Notes

- The desktop app supports Anthropic, OpenAI, Gemini, OpenRouter, and Ollama.
- Desktop builds depend on the sibling `prompt-lab-extension/` directory being present in the checkout.
