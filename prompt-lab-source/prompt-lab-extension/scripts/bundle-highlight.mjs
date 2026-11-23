// Bundle the highlight content script (classic IIFE, no imports) and the
// service-worker enhance module (one ESM file) into the assembled extension.
import { build } from 'vite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, process.argv[2] || 'dist');

async function bundle(entry, fileName, format, name) {
  await build({
    configFile: false,
    root,
    publicDir: false,
    logLevel: 'warn',
    build: {
      outDir,
      emptyOutDir: false,
      sourcemap: false,
      cssCodeSplit: false,
      lib: {
        entry: resolve(root, entry),
        formats: [format],
        name,
        fileName: () => fileName.replace(/\.js$/, ''),
      },
      rollupOptions: {
        output: {
          entryFileNames: fileName,
          inlineDynamicImports: true,
        },
      },
    },
  });
}

await bundle('src/highlight-content.js', 'highlight-content.js', 'iife', 'PromptLabHighlight');
await bundle('src/highlight-worker.js', 'highlight-worker.js', 'es', 'PromptLabHighlightWorker');
console.log(`Highlight bundles written to ${outDir}`);
