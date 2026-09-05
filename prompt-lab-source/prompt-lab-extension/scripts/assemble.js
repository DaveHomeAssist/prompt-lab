import { copyFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// Packaging roots in precedence order — the first root that holds a file wins,
// and the rest are ignored. `extension/` therefore shadows any same-named file
// under `public/`.
export const EXTENSION_SOURCE_ROOTS = [join(root, 'extension'), join(root, 'public')];

// Loose files copied verbatim into the assembled extension.
export const PACKAGED_FILES = [
  'manifest.json',
  'background.js',
  'options.html',
  'options.js',
];

// Directories copied wholesale into the assembled extension.
export const PACKAGED_DIRS = ['fonts', 'icons', 'lib'];

/**
 * Resolve which source file assemble.js would actually package for `name`.
 * Exported so tests can bind to the bytes that ship instead of guessing a path
 * (M-3: the options guard suite used to read a file that never shipped).
 *
 * @returns {string|null} absolute path, or null when no root provides the file
 */
export function resolveExtensionSource(name, roots = EXTENSION_SOURCE_ROOTS) {
  return roots.map((candidateRoot) => join(candidateRoot, name))
    .find((candidate) => existsSync(candidate)) || null;
}

function copyDir(source, target, dist) {
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source)) {
    const from = join(source, entry);
    const to = join(target, entry);
    if (statSync(from).isDirectory()) {
      copyDir(from, to, dist);
    } else {
      copyFileSync(from, to);
      console.log(`  ✓ ${to.replace(`${dist}/`, '')}`);
    }
  }
}

export function assemble(outName = 'dist') {
  const dist = join(root, outName);

  mkdirSync(join(dist, 'icons'), { recursive: true });

  for (const f of PACKAGED_FILES) {
    const source = resolveExtensionSource(f);
    if (!source) continue;
    copyFileSync(source, join(dist, f));
    console.log(`  ✓ ${f}`);
  }

  for (const d of PACKAGED_DIRS) {
    const source = resolveExtensionSource(d);
    if (source && existsSync(source)) {
      copyDir(source, join(dist, d), dist);
    }
  }

  console.log(`\n✅ Extension assembled in ${outName}/`);
  console.log(`   Load unpacked from ${outName}/ in vivaldi://extensions`);

  return dist;
}

// Only assemble when run as a script — importing this module (from tests, for
// example) must not write to the working tree.
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  assemble(process.argv[2] || 'dist');
}
