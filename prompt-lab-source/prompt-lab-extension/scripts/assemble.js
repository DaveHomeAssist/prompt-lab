import { copyFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const outName = process.argv[2] || 'dist';
const dist = join(root, outName);
const ext = join(root, 'extension');
const publicDir = join(root, 'public');

function firstExistingPath(...paths) {
  return paths.find((candidate) => existsSync(candidate)) || null;
}

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
  const source = firstExistingPath(join(ext, f), join(publicDir, f));
  if (!source) continue;
  copyFileSync(source, join(dist, f));
  console.log(`  ✓ ${f}`);
}

// Copy fonts
const fontsDir = firstExistingPath(join(ext, 'fonts'), join(publicDir, 'fonts'));
if (existsSync(fontsDir)) {
  copyDir(fontsDir, join(dist, 'fonts'));
}

// Copy icons
const iconsDir = firstExistingPath(join(ext, 'icons'), join(publicDir, 'icons'));
if (existsSync(iconsDir)) {
  copyDir(iconsDir, join(dist, 'icons'));
}

const libDir = firstExistingPath(join(ext, 'lib'), join(publicDir, 'lib'));
if (libDir && existsSync(libDir)) {
  copyDir(libDir, join(dist, 'lib'));
}

console.log(`\n✅ Extension assembled in ${outName}/`);
console.log(`   Load unpacked from ${outName}/ in vivaldi://extensions`);
