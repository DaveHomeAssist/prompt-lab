import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_WEB_MODE': JSON.stringify('true'),
    'import.meta.env.VITE_PROXY_URL': JSON.stringify('https://prompt-lab-tawny.vercel.app/api/proxy'),
  },
  resolve: {
    alias: {
      'diff-match-patch': resolve(__dirname, 'node_modules/diff-match-patch/index.js'),
      react: resolve(__dirname, 'node_modules/react'),
      'react-dom': resolve(__dirname, 'node_modules/react-dom'),
    },
  },
  build: {
    outDir: 'dist',
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
