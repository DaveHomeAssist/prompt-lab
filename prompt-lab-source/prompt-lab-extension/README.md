# Prompt Lab

Chrome extension (MV3 side panel) for prompt engineering with A/B testing, eval runs, and PII scanning.

## Tech Stack

- React 18
- Vite 8
- Tailwind CSS
- Vitest + React Testing Library

## Getting Started

```bash
nvm use
npm install
npm run dev
npm run build
```

After `npm run build`, open `chrome://extensions`, enable Developer mode, choose Load unpacked, and select `dist/`.

## Architecture

- `src/hooks/` contains stateful editor, library, eval run, A/B test, and test-case hooks.
- `src/lib/` contains shared utilities, schemas, storage helpers, logging, and the unified PII engine.
- `src/__tests__/` contains Vitest and React Testing Library coverage for hooks, storage, schemas, utilities, and PII flows.
- `extension/` contains MV3 assets such as the manifest, service worker, icons, and extension-specific files copied into `dist/`.

## Testing

```bash
npm test
npm run test:watch
```
