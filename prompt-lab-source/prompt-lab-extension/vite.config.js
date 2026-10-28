import { checkVersions } from '../scripts/check-version-consistency.mjs';
import { buildIdentity } from '../scripts/build-identity.mjs';
import { diagnosticSourceMaps } from '../scripts/diagnostic-sourcemaps.mjs';
import { billingUiDefine } from './scripts/billing-ui-define.mjs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

const versionErrors = checkVersions().errors;
if (versionErrors.length) throw new Error(versionErrors.join('\n'));

// Extension production builds hide billing UI; see scripts/billing-ui-define.mjs.
export default defineConfig(({ command }) => ({
  define: { ...buildIdentity(), ...billingUiDefine(command) },
  plugins: [react(), diagnosticSourceMaps('extension')],
  build: {
    sourcemap: 'hidden',
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
    include: [
      'src/__tests__/**/*.test.{js,jsx}',
      'src/tests/**/*.test.{js,jsx}',
      'tests/**/*.vitest.mjs',
    ],
    exclude: ['node_modules/**'],
    // jsdom is stable under threads on Node 22; the forked pool hit repeated
    // bootstrap failures in cssstyle/jsdom before test collection completed.
    pool: 'threads',
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
  },
}));
