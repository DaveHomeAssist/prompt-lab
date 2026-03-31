import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_WEB_MODE': JSON.stringify('true'),
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
