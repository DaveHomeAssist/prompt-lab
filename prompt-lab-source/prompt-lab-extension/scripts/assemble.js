import { mkdirSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
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

function copyFile(source, target) {
  writeFileSync(target, readFileSync(source));
}

function copyDir(source, target) {
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source)) {
    if (/(^| )2(\.|$)/.test(entry)) continue;

    const from = join(source, entry);
    const to = join(target, entry);
    if (statSync(from).isDirectory()) {
      copyDir(from, to);
    } else {
      copyFile(from, to);
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
  const source = firstExistingPath(join(publicDir, f), join(ext, f));
  if (!source) continue;
  copyFile(source, join(dist, f));
  console.log(`  ✓ ${f}`);
}

// Copy fonts
const fontsDir = firstExistingPath(join(publicDir, 'fonts'), join(ext, 'fonts'));
if (existsSync(fontsDir)) {
  copyDir(fontsDir, join(dist, 'fonts'));
}

// Copy icons
const iconsDir = firstExistingPath(join(publicDir, 'icons'), join(ext, 'icons'));
if (existsSync(iconsDir)) {
  copyDir(iconsDir, join(dist, 'icons'));
}

const libDir = firstExistingPath(join(publicDir, 'lib'), join(ext, 'lib'));
if (libDir && existsSync(libDir)) {
  copyDir(libDir, join(dist, 'lib'));
}

console.log(`\n✅ Extension assembled in ${outName}/`);
console.log(`   Load unpacked from ${outName}/ in vivaldi://extensions`);
