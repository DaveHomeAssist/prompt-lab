// AUD-007: production loads the workbench as its own chunk, so a signed-out
// visitor gets the sign-in screen without downloading the whole app.
// The dev server swaps in workbenchLoader.dev.js instead (see vite.config.js).
export const loadApp = () => import('../../prompt-lab-extension/src/App');
