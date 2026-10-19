# Chrome Web Store Submission Checklist

- [ ] Store listing copy is final: name, short description, and detailed description all match `manifest.json` and [README.md](./README.md).
- [x] Screenshots are prepared at `1280x800` or `640x400` with at least 1 image and no more than 5.
- [x] Small promo tile `440x280` is ready. The optional marquee `1400x560` is not made.
- [x] Privacy policy URL is published and reachable on `promptlab.tools` or another stable public URL using [PRIVACY_POLICY.md](./PRIVACY_POLICY.md) as the source document.
- [x] Permission justifications cover every permission and host permission in the manifest: [PERMISSIONS_JUSTIFICATION.md](./PERMISSIONS_JUSTIFICATION.md) (updated 2026-10-18 for `activeTab`, `scripting`, `promptlab.tools`).
- [ ] Category is selected. Recommended: `Developer Tools`.
- [ ] Single-purpose description for reviewer is written in one sentence: Prompt Lab is a side-panel prompt engineering workbench for testing and refining prompts across supported AI providers.
- [ ] Unminified review build is generated with `npm run build:cws` and verified in `dist-cws/`.
- [ ] Reviewer test instructions are documented:
  - Load unpacked from `dist-cws/`
  - Open the side panel
  - Configure a provider
  - Recommended free/local path: run Ollama locally, choose `Ollama`, keep `http://localhost:11434`, pick an installed model, run `Enhance`
- [ ] Ollama localhost permission strategy is decided. Recommended review path: consider submitting without localhost first to reduce review friction, then add it in a later update if needed.

---

## Status 2026-07-03 (engineering pass)

- Screenshots + promo tile generated → `store-assets/cws/` (see its README). ✅
- Privacy policy now resolves at both `https://promptlab.tools/privacy` and `/privacy.html` (publish-landing writes the pretty-route redirect). ✅
- Reviewer build: `npm run build:cws` → `dist-cws/` (regenerate before upload; gitignored).
- Remaining are Chrome Web Store console + policy decisions for the owner: upload assets, select `Developer Tools`, finalize listing copy, permission review, single-purpose sentence (drafted above), Ollama-localhost decision.

## Status 2026-10-18 (v1.8.0 listing pass)

- Release-identity build: `PROMPTLAB_RELEASE_TAG=v1.8.0 npm run build:cws` at `0a5fdd8`; header shows `v1.8.0 (0a5fdd8)`. A plain `build:cws` shows `-dev`.
- Screenshots regenerated from that build in the Free state; screenshot 5 caption no longer says "no telemetry" (opt-in analytics exists).
- Listing copy, category (`Developer Tools`; `Productivity` is no longer selectable) and permission text updated.
- Privacy policy source now discloses Capture Page; the live page changes only after the landing deploy.
- Open before submit: the localhost Ollama decision above.

## Status 2026-10-18, later (billing UI hidden)

- Extension production builds hide all billing UI (`VITE_PROMPTLAB_BILLING_UI=off`, `scripts/billing-ui-define.mjs`); Distribution → Payments: **Free**.
- The options page probes Ollama only when Ollama is the selected provider, so a fresh install shows no Ollama error.
- Rebuilt with `PROMPTLAB_RELEASE_TAG=v1.8.0 npm run build:cws`; all five screenshots regenerated from that build (no plan badge or Upgrade; screenshot 5 shows the default Anthropic settings with no key and no local provider configured, nothing mocked).
