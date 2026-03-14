import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
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
    include: ['src/__tests__/**/*.test.{js,jsx}', 'tests/desktop-smoke.test.mjs'],
  },
});
