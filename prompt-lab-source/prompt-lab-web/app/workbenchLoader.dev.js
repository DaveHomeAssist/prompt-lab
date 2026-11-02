// Dev server only (vite.config.js aliases this file in for `vite serve`).
// The workbench is part of the entry's static module graph here, so it is
// ready before the page's load event. Local runs and the browser tests see the
// app as soon as the page has loaded, as they did before AUD-007. Builds use
// workbenchLoader.js, which keeps the workbench in its own chunk.
import * as workbench from '../../prompt-lab-extension/src/App';

export const loadApp = () => Promise.resolve(workbench);
