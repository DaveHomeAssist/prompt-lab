import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    copyPublicDir: false,
    rollupOptions: {
      input: {
        panel: resolve(__dirname, 'panel.html'),
      },
    },
    // Inline everything for a clean single-folder extension
    assetsInlineLimit: 0,
  },
  // Base path: extension loads from root of its own origin
  base: './',
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.js'],
    include: ['src/__tests__/**/*.test.{js,jsx}', 'src/tests/**/*.test.{js,jsx}'],
    // Smoke tests run via `npm run test:desktop` — keep them out of the unit pool
    exclude: ['tests/desktop-smoke.test.mjs', 'node_modules/**'],
    // jsdom is stable under threads on Node 22; the forked pool hit repeated
    // bootstrap failures in cssstyle/jsdom before test collection completed.
    pool: 'threads',
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
  },
});
