import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  define: {
    'import.meta.env.VITE_WEB_MODE': JSON.stringify('true'),
  },
  resolve: {
    alias: [
      // The web app imports source files from ../prompt-lab-extension/src.
      // Force shared runtime deps to resolve from the web package.
      { find: /^diff-match-patch$/, replacement: resolve(__dirname, 'node_modules/diff-match-patch/index.js') },
      { find: /^react$/, replacement: resolve(__dirname, 'node_modules/react/index.js') },
      { find: /^react\/jsx-runtime$/, replacement: resolve(__dirname, 'node_modules/react/jsx-runtime.js') },
      { find: /^react\/jsx-dev-runtime$/, replacement: resolve(__dirname, 'node_modules/react/jsx-dev-runtime.js') },
      { find: /^react-dom$/, replacement: resolve(__dirname, 'node_modules/react-dom/index.js') },
      { find: /^react-dom\/client$/, replacement: resolve(__dirname, 'node_modules/react-dom/client.js') },
      { find: /^react-router-dom$/, replacement: resolve(__dirname, 'node_modules/react-router-dom/dist/index.mjs') },
      { find: /^react-router$/, replacement: resolve(__dirname, 'node_modules/react-router/dist/development/index.mjs') },
      { find: /^react-router\/dom$/, replacement: resolve(__dirname, 'node_modules/react-router/dist/development/dom-export.mjs') },
      { find: /^@clerk\/clerk-react$/, replacement: resolve(__dirname, 'node_modules/@clerk/clerk-react/dist/index.mjs') },
    ],
  },
  build: {
    outDir: 'dist',
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        app: resolve(__dirname, 'app/index.html'),
      },
    },
  },
  server: {
    port: 5174,
    strictPort: true,
  },
});
