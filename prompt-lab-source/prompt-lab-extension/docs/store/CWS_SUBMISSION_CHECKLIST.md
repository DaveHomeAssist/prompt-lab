# Chrome Web Store Submission Checklist

- [ ] Store listing copy is final: name, short description, and detailed description all match `manifest.json` and [README.md](./README.md).
- [ ] Screenshots are prepared at `1280x800` or `640x400` with at least 1 image and no more than 5.
- [ ] Promo images are ready: small promo tile `440x280` and optional marquee `1400x560`.
- [ ] Privacy policy URL is published and reachable on `promptlab.tools` or another stable public URL using [PRIVACY_POLICY.md](./PRIVACY_POLICY.md) as the source document.
- [ ] Permission justifications are reviewed for every host permission against [PERMISSIONS_JUSTIFICATION.md](./PERMISSIONS_JUSTIFICATION.md).
- [ ] Category is selected. Recommended: `Developer Tools`.
- [ ] Single-purpose description for reviewer is written in one sentence: Prompt Lab is a side-panel prompt engineering workbench for testing and refining prompts across supported AI providers.
- [ ] Unminified review build is generated with `npm run build:cws` and verified in `dist-cws/`.
- [ ] Reviewer test instructions are documented:
  - Load unpacked from `dist-cws/`
  - Open the side panel
  - Configure a provider
  - Recommended free/local path: run Ollama locally, choose `Ollama`, keep `http://localhost:11434`, pick an installed model, run `Enhance`
- [ ] Ollama localhost permission strategy is decided. Recommended review path: consider submitting without localhost first to reduce review friction, then add it in a later update if needed.
