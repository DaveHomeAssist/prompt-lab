# Active Extension App Map

Root: `prompt-lab-source/prompt-lab-extension/`

This inventory describes the active extension app source and excludes generated output such as `dist/`, `dist-cws/`, `node_modules/`, and `test-results/`.

## Build And Package Files

- `package.json` — scripts, engine constraints, package metadata
- `.nvmrc` — Node runtime pin
- `vite.config.js` — Vite build and Vitest config
- `tailwind.config.js` — Tailwind config
- `postcss.config.js` — PostCSS config
- `playwright.config.js` — end-to-end test config
- `panel.html` — Vite entry for the side panel
- `scripts/assemble.js` — copies shared runtime libs into built extension output
- `README.md` — package overview and build notes
- `PRIVACY_POLICY.md` — package-local policy document

## Static Extension Assets

- `public/manifest.json` — MV3 manifest source
- `public/background.js` — background service worker source
- `public/options.html` — options page markup
- `public/options.js` — options page controller
- `public/icons/*` — shipped extension icons
- `public/fonts/*` — shipped local fonts

## React App Entrypoints

- `src/main.jsx` — React bootstrapping
- `src/App.jsx` — top-level composition
- `src/MainWorkspace.jsx` — main panel workspace orchestration
- `src/HeaderNav.jsx` — top navigation
- `src/ModalLayer.jsx` — modal host
- `src/ErrorBoundary.jsx` — top-level runtime fallback
- `src/Toast.jsx` — transient status surface
- `src/index.css` — global styles

## Feature Surface Files

- `src/ABTestTab.jsx` — A/B testing UI
- `src/BugReportModal.jsx` — bug report modal
- `src/ComposerTab.jsx` — prompt composer
- `src/DesktopSettingsModal.jsx` — desktop shell settings
- `src/DiffEngine.js` — diff logic
- `src/DiffPane.jsx` — diff rendering
- `src/DraftBadge.jsx` — draft state indicator
- `src/EditorActions.jsx` — editor action controls
- `src/LibraryPanel.jsx` — saved prompts UI
- `src/MarkdownPreview.jsx` — markdown preview
- `src/PadTab.jsx` — scratchpad UI
- `src/PresetImportPanel.jsx` — preset import UI
- `src/RunTimelinePanel.jsx` — run timeline UI
- `src/TagChip.jsx` — tag display primitive
- `src/TestCasesPanel.jsx` — evaluation test-case UI
- `src/VersionDiffModal.jsx` — version comparison modal

## State And App Helpers

- `src/api.js` — app-to-platform request shim
- `src/constants.js` — shared constants
- `src/experimentStore.js` — experiment persistence
- `src/icons.jsx` — shared icon components
- `src/piiScanner.js` — sensitive data scanning
- `src/promptLint.js` — prompt linting rules
- `src/promptUtils.js` — prompt transformation helpers
- `src/redactionEngine.js` — redaction logic
- `src/usePersistedState.js` — generic persisted state hook

## Hooks

- `src/hooks/useABTest.js`
- `src/hooks/useEditorState.js`
- `src/hooks/useEvalRuns.js`
- `src/hooks/useExecutionFlow.js`
- `src/hooks/useExperiments.js`
- `src/hooks/usePersistenceFlow.js`
- `src/hooks/usePromptLibrary.js`
- `src/hooks/useSessionState.js`
- `src/hooks/useTestCases.js`
- `src/hooks/useUiState.js`

## Shared Runtime Libs

- `src/lib/bugReporter.js`
- `src/lib/desktopApi.js`
- `src/lib/errorTaxonomy.js`
- `src/lib/evalSchema.js`
- `src/lib/logger.js`
- `src/lib/markdownLite.js`
- `src/lib/navigationRegistry.js`
- `src/lib/padShortcuts.js`
- `src/lib/piiEngine.js`
- `src/lib/platform.js`
- `src/lib/presetImport.js`
- `src/lib/promptLabBridge.js`
- `src/lib/promptSchema.js`
- `src/lib/providerRegistry.js`
- `src/lib/providers.js`
- `src/lib/proxyFetch.js`
- `src/lib/runEmitter.js`
- `src/lib/seedTransform.js`
- `src/lib/storage.js`
- `src/lib/utils.js`

`public/background.js` and `public/options.js` currently depend on:

- `src/lib/providerRegistry.js`
- `src/lib/providers.js`
- `src/lib/errorTaxonomy.js`

Those files are copied into `dist/lib/` during assembly.

## Run Data, Schemas, Theme, And Seed Data

- `src/runs/RunSchema.js`
- `src/runs/buildGraphDataset.js`
- `src/runs/exportRuns.js`
- `src/schemas/index.js`
- `src/theme/ThemeProvider.jsx`
- `src/data/promptlab-seed-libraries.json`

## Tests

- `src/tests/*.test.jsx` — component and integration-style Vitest coverage
- `src/__tests__/*.test.{js,jsx}` — unit and support Vitest coverage
- `tests/*.mjs` — legacy tests still outside `src/`
- `e2e/*.spec.js` — Playwright smoke coverage

## Package Docs

- `docs/audits/*` — audits
- `docs/ops/*` — planning and operational material
- `docs/releases/*` — release notes and patch reports
- `docs/store/*` — store submission material

## Cleanup Priorities

1. Keep `public/` as the only static extension packaging source.
2. Keep `src/lib/` as the only shared runtime library source.
3. Migrate legacy root `tests/*.mjs` into the main Vitest or Playwright layout.
4. Treat `dist/`, `dist-cws/`, and test artifacts as generated output only.
