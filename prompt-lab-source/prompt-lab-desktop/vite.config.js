import { defineConfig } from 'vite';
import { resolve } from 'path';

// Desktop Vite config — resolves shared source from the extension project.
// No symlinks needed; works on Windows, macOS, and Linux.
export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    alias: [
      // Force shared extension source to resolve frontend deps from desktop node_modules.
      { find: /^react$/, replacement: resolve(__dirname, 'node_modules/react/index.js') },
      { find: /^react-dom$/, replacement: resolve(__dirname, 'node_modules/react-dom/index.js') },
      { find: /^react-router-dom$/, replacement: resolve(__dirname, 'node_modules/react-router-dom/dist/index.mjs') },
      { find: /^react-router$/, replacement: resolve(__dirname, 'node_modules/react-router/dist/development/index.mjs') },
      { find: /^react-router\/dom$/, replacement: resolve(__dirname, 'node_modules/react-router/dist/development/dom-export.mjs') },
    ],
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
