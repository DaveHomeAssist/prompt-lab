# Prompt Lab Extension

Prompt Lab is a Chrome MV3 side-panel extension for writing, testing, and refining prompts across Anthropic, OpenAI, Gemini, OpenRouter, and Ollama. The extension shares its React frontend with the desktop app and remains the main browser-native distribution target.

## Install From Source

```bash
cd prompt-lab-source/prompt-lab-extension
npm install
npm run build
```

Then open `chrome://extensions`, enable Developer Mode, choose **Load unpacked**, and select `dist/`.

## Run Tests

```bash
cd prompt-lab-source/prompt-lab-extension
npm test
```

## More Docs

See the [root README](../../README.md) for the overall project layout, desktop app notes, and CI/development workflow.
