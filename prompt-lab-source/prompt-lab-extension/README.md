# Prompt Lab Extension

Prompt Lab Extension is the MV3 side-panel shell for Prompt Lab. It shares its React frontend with:

- the hosted web app at `https://promptlab.tools/app/`
- the Tauri desktop shell in `prompt-lab-desktop/`

The extension remains the browser-native workflow for users who want Prompt Lab docked beside the page they are already using.

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

- `../ARCHITECTURE.md` — shared architecture across extension, web, and desktop
- `../ROADMAP.md` — current product and release priorities
- `../prompt-lab-web/README.md` — hosted web deployment notes
