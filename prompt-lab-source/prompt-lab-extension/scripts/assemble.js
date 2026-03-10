import { copyFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const dist = join(root, 'dist');
const ext = join(root, 'extension');

// Ensure dist/icons exists
mkdirSync(join(dist, 'icons'), { recursive: true });

// Copy extension files into dist
const files = [
  'manifest.json',
  'background.js',
  'options.html',
  'options.js',
];
for (const f of files) {
  copyFileSync(join(ext, f), join(dist, f));
  console.log(`  ✓ ${f}`);
}

// Copy icons
const iconsDir = join(ext, 'icons');
if (existsSync(iconsDir)) {
  for (const f of readdirSync(iconsDir)) {
    copyFileSync(join(iconsDir, f), join(dist, 'icons', f));
    console.log(`  ✓ icons/${f}`);
  }
}

console.log('\n✅ Extension assembled in dist/');
console.log('   Load unpacked from dist/ in vivaldi://extensions');
