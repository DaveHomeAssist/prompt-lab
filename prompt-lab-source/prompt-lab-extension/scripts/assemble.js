import { copyFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const outName = process.argv[2] || 'dist';
const dist = join(root, outName);
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

// Copy fonts
const fontsDir = join(ext, 'fonts');
if (existsSync(fontsDir)) {
  mkdirSync(join(dist, 'fonts'), { recursive: true });
  for (const f of readdirSync(fontsDir)) {
    copyFileSync(join(fontsDir, f), join(dist, 'fonts', f));
    console.log(`  ✓ fonts/${f}`);
  }
}

// Copy icons
const iconsDir = join(ext, 'icons');
if (existsSync(iconsDir)) {
  for (const f of readdirSync(iconsDir)) {
    copyFileSync(join(iconsDir, f), join(dist, 'icons', f));
    console.log(`  ✓ icons/${f}`);
  }
}

console.log(`\n✅ Extension assembled in ${outName}/`);
console.log(`   Load unpacked from ${outName}/ in vivaldi://extensions`);
