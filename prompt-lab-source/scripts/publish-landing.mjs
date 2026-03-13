import { cp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const sourceDir = resolve(scriptDir, '..');
const repoDir = resolve(sourceDir, '..');
const publicDir = join(sourceDir, 'public');
const docsDir = join(repoDir, 'docs');

const copyTargets = [
  ['prompt-lab-landing.html', 'index.html'],
  ['hero-logo.png', 'hero-logo.png'],
  ['og-image.png', 'og-image.png'],
  ['robots.txt', 'robots.txt'],
  ['sitemap.xml', 'sitemap.xml'],
];

async function resetDocsDir() {
  await rm(docsDir, { recursive: true, force: true });
  await mkdir(docsDir, { recursive: true });
}

async function copyTarget(fromName, toName) {
  await cp(join(publicDir, fromName), join(docsDir, toName));
}

async function copyFontsDir() {
  const sourceFontsDir = join(publicDir, 'fonts');
  const targetFontsDir = join(docsDir, 'fonts');
  const sourceStats = await stat(sourceFontsDir);

  if (!sourceStats.isDirectory()) {
    throw new Error(`Expected fonts directory at ${sourceFontsDir}`);
  }

  await cp(sourceFontsDir, targetFontsDir, { recursive: true });
}

async function writeNoJekyll() {
  await writeFile(join(docsDir, '.nojekyll'), '', 'utf8');
}

async function validatePublicInputs() {
  for (const [fromName] of copyTargets) {
    await stat(join(publicDir, fromName));
  }

  const entries = await readdir(publicDir);
  if (!entries.includes('prompt-lab-landing.html')) {
    throw new Error('Landing source file is missing from public/');
  }
}

async function main() {
  await validatePublicInputs();
  await resetDocsDir();

  for (const [fromName, toName] of copyTargets) {
    await copyTarget(fromName, toName);
  }

  await copyFontsDir();
  await writeNoJekyll();

  console.log(`Landing site published to ${docsDir}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
