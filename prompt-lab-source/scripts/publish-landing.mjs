import { cp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const sourceDir = resolve(scriptDir, '..');
const repoDir = resolve(sourceDir, '..');
const publicDir = join(sourceDir, 'public');
const webDir = join(sourceDir, 'prompt-lab-web');
const webPublicDir = join(webDir, 'public');
const docsDir = join(repoDir, 'docs');

const fileTargets = [
  [join(webDir, 'index.html'), 'index.html'],
  [join(webPublicDir, 'guide.html'), 'guide.html'],
  [join(webPublicDir, 'guide-preset-import.html'), 'guide-preset-import.html'],
  [join(webPublicDir, 'setup.html'), 'setup.html'],
  [join(webPublicDir, 'privacy.html'), 'privacy.html'],
  [join(webPublicDir, 'prompt-embed.html'), 'prompt-embed.html'],
  [join(webPublicDir, 'hero-logo.png'), 'hero-logo.png'],
  [join(webPublicDir, 'og-image.png'), 'og-image.png'],
  [join(webPublicDir, 'robots.txt'), 'robots.txt'],
  [join(webPublicDir, 'sitemap.xml'), 'sitemap.xml'],
];

const dirTargets = [
  [join(webPublicDir, 'fonts'), 'fonts'],
  [join(webPublicDir, 'tools'), 'tools'],
];

// Legacy mirror targets retained for compatibility.
// The canonical web-brand art lives in prompt-lab-web/public/.
const legacyMirrorTargets = [
  [join(webDir, 'index.html'), join(publicDir, 'prompt-lab-landing.html')],
  [join(webPublicDir, 'hero-logo.png'), join(publicDir, 'hero-logo.png')],
  [join(webPublicDir, 'og-image.png'), join(publicDir, 'og-image.png')],
  [join(webPublicDir, 'robots.txt'), join(publicDir, 'robots.txt')],
  [join(webPublicDir, 'sitemap.xml'), join(publicDir, 'sitemap.xml')],
];

const obsoleteTargets = [
  'script-agent.html',
  'scriptagent.html',
  'script-agent 2.html',
  'scriptagent 2.html',
];

async function ensureDocsDir() {
  await mkdir(docsDir, { recursive: true });
  await mkdir(publicDir, { recursive: true });
}

async function copyTarget(fromPath, toName) {
  await cp(fromPath, join(docsDir, toName), { force: true });
}

async function syncDir(fromPath, toName) {
  const targetPath = join(docsDir, toName);
  const sourceStats = await stat(fromPath);
  if (!sourceStats.isDirectory()) {
    throw new Error(`Expected directory at ${fromPath}`);
  }
  await rm(targetPath, { recursive: true, force: true });
  await cp(fromPath, targetPath, { recursive: true, force: true });
}

async function writeNoJekyll() {
  await writeFile(join(docsDir, '.nojekyll'), '', 'utf8');
}

async function writeCname() {
  await writeFile(join(docsDir, 'CNAME'), 'promptlab.tools\n', 'utf8');
}

async function validatePublicInputs() {
  for (const [fromPath] of fileTargets) {
    await stat(fromPath);
  }
  for (const [fromPath] of dirTargets) {
    const sourceStats = await stat(fromPath);
    if (!sourceStats.isDirectory()) {
      throw new Error(`Expected directory at ${fromPath}`);
    }
  }
}

async function cleanupObsoleteTargets() {
  for (const target of obsoleteTargets) {
    await rm(join(docsDir, target), { recursive: true, force: true });
  }
}

async function syncLegacyMirrors() {
  for (const [fromPath, toPath] of legacyMirrorTargets) {
    await cp(fromPath, toPath, { force: true });
  }
}

async function main() {
  await validatePublicInputs();
  await ensureDocsDir();
  await cleanupObsoleteTargets();

  for (const [fromPath, toName] of fileTargets) {
    await copyTarget(fromPath, toName);
  }

  for (const [fromPath, toName] of dirTargets) {
    try {
      await syncDir(fromPath, toName);
    } catch (error) {
      console.warn(`  Optional directory ${toName} not found, skipping`);
      if (!(error instanceof Error && error.message.includes('no such file'))) {
        throw error;
      }
    }
  }

  await syncLegacyMirrors();
  await writeNoJekyll();
  await writeCname();

  console.log(`Landing site published to ${docsDir}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
