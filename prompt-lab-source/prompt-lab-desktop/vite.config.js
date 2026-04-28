import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// Desktop Vite config — resolves shared source from the extension project.
// No symlinks needed; works on Windows, macOS, and Linux.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Force shared extension source to resolve deps from desktop node_modules
      // (in CI, only prompt-lab-desktop/node_modules is installed)
      react: resolve(__dirname, 'node_modules/react'),
      'react-dom': resolve(__dirname, 'node_modules/react-dom'),
      'react-router-dom': resolve(__dirname, 'node_modules/react-router-dom'),
    },
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
