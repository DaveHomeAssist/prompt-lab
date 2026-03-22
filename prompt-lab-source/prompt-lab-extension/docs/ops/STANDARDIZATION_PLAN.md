# Extension Standardization Plan

Root: `prompt-lab-source/prompt-lab-extension/`

## Goals

- Eliminate duplicate packaging sources.
- Make the shipping extension build predictable.
- Separate source, generated output, and operational docs.
- Reduce ambiguity around test ownership and build entrypoints.

## Source Of Truth

- `src/` is the source of truth for the React app and shared runtime code.
- `public/` is the source of truth for MV3 packaging assets and static files.
- `dist/` and `dist-cws/` are generated output only.

## Immediate Standardization

1. Build the side panel with Vite from `panel.html`.
2. Let Vite copy `public/` into the output directory.
3. Copy only the shared runtime modules needed by `background.js` and `options.js` into `dist/lib/`.
4. Remove the duplicate `extension/` source tree.
5. Ignore generated output with a package-local `.gitignore`.
6. Keep package docs under `docs/` by function instead of mixing them into the package root.

## Target Layout

```text
prompt-lab-extension/
  docs/
    audits/
    inventory/
    ops/
    releases/
    store/
  e2e/
  public/
    background.js
    manifest.json
    options.html
    options.js
    icons/
    fonts/
  scripts/
    assemble.js
  src/
    hooks/
    lib/
    runs/
    schemas/
    theme/
    tests/
    __tests__/
  panel.html
  package.json
  README.md
```

## Follow-Up Refactors

### Packaging

- Move `background.js` and `options.js` into first-class `src/` build entries when the extension runtime is ready for bundling.
- Replace manual runtime-lib copying with an explicit multi-entry Vite build when that migration happens.

### Tests

- Consolidate `src/tests/` and `src/__tests__/` into one clear convention.
- Migrate or delete `tests/*.mjs` so the package has one place for legacy-free automated coverage.
- Keep Playwright coverage isolated to `e2e/`.

### Shared Code Boundaries

- Keep extension runtime-safe modules in `src/lib/`.
- Keep React-only code out of modules imported by `public/background.js` and `public/options.js`.
- Document any future worker/options runtime dependencies next to `scripts/assemble.js`.

### Docs

- Keep only `README.md` and legally required package docs at the package root.
- Treat release notes as archival material under `docs/releases/`.
- Treat Chrome Web Store submission material as operational docs under `docs/store/`.

## Verification Checklist

- `npm run build` creates a loadable `dist/` without any dependency on a checked-in `extension/` directory.
- `dist/manifest.json`, `dist/background.js`, `dist/options.html`, and `dist/options.js` come from `public/`.
- `dist/lib/providerRegistry.js`, `dist/lib/providers.js`, and `dist/lib/errorTaxonomy.js` come from `src/lib/`.
- Runtime imports in the worker and options page resolve under `dist/`.
