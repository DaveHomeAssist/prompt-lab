import { checkVersions } from '../scripts/check-version-consistency.mjs';
import { buildIdentity } from '../scripts/build-identity.mjs';
import { diagnosticSourceMaps } from '../scripts/diagnostic-sourcemaps.mjs';
import { previewClerkCsp } from '../scripts/preview-clerk-csp.mjs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

const versionErrors = checkVersions().errors;
if (versionErrors.length) throw new Error(versionErrors.join('\n'));

export default defineConfig({
  appType: 'mpa',
  plugins: [react(), diagnosticSourceMaps('web'), previewClerkCsp()],
  define: {
    ...buildIdentity(),
    'import.meta.env.VITE_WEB_MODE': JSON.stringify('true'),
    // Pro feature gates are on for the hosted web app (the only surface with
    // sign-in and checkout). Build with VITE_PROMPTLAB_PRO_GATES=off to reopen.
    'import.meta.env.VITE_PROMPTLAB_PRO_GATES': JSON.stringify(
      process.env.VITE_PROMPTLAB_PRO_GATES === 'off' ? 'off' : 'on',
    ),
  },
  resolve: {
    alias: {
      // The web app imports source files from ../prompt-lab-extension/src.
      // Alias runtime deps used by that sibling source to the web package's
      // installed copy so isolated Vercel builds resolve them consistently.
      'diff-match-patch': resolve(__dirname, 'node_modules/diff-match-patch/index.js'),
      react: resolve(__dirname, 'node_modules/react'),
      'react-dom': resolve(__dirname, 'node_modules/react-dom'),
      'react-router-dom': resolve(__dirname, 'node_modules/react-router-dom'),
      '@clerk/clerk-react': resolve(__dirname, 'node_modules/@clerk/clerk-react'),
    },
  },
  build: {
    sourcemap: 'hidden',
    outDir: 'dist',
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        app: resolve(__dirname, 'app/index.html'),
        mobile: resolve(__dirname, 'mobile/index.html'),
      },
    },
  },
  server: {
    port: 5174,
    strictPort: true,
  },
});
