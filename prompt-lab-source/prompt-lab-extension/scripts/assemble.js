import { copyFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const outName = process.argv[2] || 'dist';
const dist = join(root, outName);
const ext = join(root, 'extension');

function copyDir(source, target) {
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source)) {
    const from = join(source, entry);
    const to = join(target, entry);
    if (statSync(from).isDirectory()) {
      copyDir(from, to);
    } else {
      copyFileSync(from, to);
      console.log(`  ✓ ${to.replace(`${dist}/`, '')}`);
    }
  }
}

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
  copyDir(fontsDir, join(dist, 'fonts'));
}

// Copy icons
const iconsDir = join(ext, 'icons');
if (existsSync(iconsDir)) {
  copyDir(iconsDir, join(dist, 'icons'));
}

const libDir = join(ext, 'lib');
if (existsSync(libDir)) {
  copyDir(libDir, join(dist, 'lib'));
}

console.log(`\n✅ Extension assembled in ${outName}/`);
console.log(`   Load unpacked from ${outName}/ in vivaldi://extensions`);
