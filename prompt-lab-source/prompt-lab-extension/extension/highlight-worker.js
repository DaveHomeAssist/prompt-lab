// Source-tree entry so the service worker and unit tests can import the
// enhance module. `npm run build` overwrites the packaged copy with a
// self-contained bundle (scripts/bundle-highlight.mjs).
export { enhanceSelection } from '../src/highlight-worker.js';
