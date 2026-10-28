import { checkVersions } from '../scripts/check-version-consistency.mjs';
import { buildIdentity } from '../scripts/build-identity.mjs';
import { diagnosticSourceMaps } from '../scripts/diagnostic-sourcemaps.mjs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// Desktop Vite config — resolves shared source from the extension project.
// No symlinks needed; works on Windows, macOS, and Linux.
const versionErrors = checkVersions().errors;
if (versionErrors.length) throw new Error(versionErrors.join('\n'));

export default defineConfig({
  // Product call 7: marks the desktop surface so billing screens that cannot
  // complete a purchase here are replaced by a link to promptlab.tools.
  define: { ...buildIdentity(), 'import.meta.env.VITE_PROMPTLAB_SURFACE': JSON.stringify('desktop') },
  plugins: [react(), diagnosticSourceMaps('desktop')],
  resolve: {
    alias: {
      // Force shared extension source to resolve deps from desktop node_modules
      // (in CI, only prompt-lab-desktop/node_modules is installed)
      'diff-match-patch': resolve(__dirname, 'node_modules/diff-match-patch/index.js'),
      react: resolve(__dirname, 'node_modules/react'),
      'react-dom': resolve(__dirname, 'node_modules/react-dom'),
      'react-router-dom': resolve(__dirname, 'node_modules/react-router-dom'),
    },
  },
  build: {
    sourcemap: 'hidden',
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
