#!/usr/bin/env node
// Confirms the hosted /app build, with account sync left off, does not ship a
// Supabase reference. Follows the app page and the chunks it loads.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ASSET_REF = /["']([^"']+\.(?:js|mjs|css))(?:\?[^"']*)?["']/g;

export function isBundleRef(ref) {
  return ref.startsWith('./') || ref.startsWith('../') || ref.startsWith('/assets/') || ref.startsWith('/app/') || ref.includes('/assets/');
}

export function collectAppBundle(distDir) {
  const root = resolve(distDir);
  const htmlPath = join(root, 'app', 'index.html');
  if (!existsSync(htmlPath)) throw new Error(`app bundle html is missing at ${htmlPath}`);
  const seen = new Set();
  const queue = [htmlPath];
  const files = [];
  const addRef = (fromFile, ref) => {
    if (!ref || ref.startsWith('data:') || /^https?:/i.test(ref) || !isBundleRef(ref)) return;
    const clean = ref.split('?')[0].split('#')[0];
    const path = resolve(clean.startsWith('/') ? join(root, clean.slice(1)) : dirname(fromFile), clean.startsWith('/') ? '.' : clean);
    if (path !== root && !path.startsWith(root + sep)) throw new Error('app bundle reference escaped the build output');
    if (path.endsWith('.map')) return;
    if (!existsSync(path) || !statSync(path).isFile()) {
      if (fromFile.endsWith('.html')) throw new Error(`app bundle is missing ${clean}`);
      return;
    }
    if (!seen.has(path)) queue.push(path);
  };
  while (queue.length) {
    const path = queue.shift();
    if (seen.has(path)) continue;
    seen.add(path);
    files.push(path);
    const text = readFileSync(path, 'utf8');
    if (path.endsWith('.html')) {
      for (const match of text.matchAll(/\b(?:src|href)="([^"]+)"/g)) addRef(path, match[1]);
    }
    if (/\.(?:js|mjs|css)$/.test(path)) {
      for (const match of text.matchAll(ASSET_REF)) addRef(path, match[1]);
    }
  }
  if (!files.some((path) => path.endsWith('.js') || path.endsWith('.mjs'))) throw new Error('app bundle has no script');
  return files;
}

export function supabaseReferences(distDir) {
  const hits = [];
  for (const path of collectAppBundle(distDir)) {
    if (/supabase/i.test(readFileSync(path, 'utf8'))) hits.push(path);
  }
  return hits;
}

function main() {
  const distDir = resolve(process.argv[2] || 'prompt-lab-web/dist');
  const hits = supabaseReferences(distDir);
  if (hits.length) {
    console.error(`FAIL  /app bundle mentions Supabase while account sync is off:\n${hits.join('\n')}`);
    process.exitCode = 1;
    return;
  }
  console.log('PASS  /app bundle has no Supabase reference');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
