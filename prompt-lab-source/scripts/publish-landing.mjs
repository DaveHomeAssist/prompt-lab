import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const sourceDir = resolve(scriptDir, '..');
const repoDir = resolve(sourceDir, '..');
const legacyLandingFile = join(sourceDir, 'public', 'prompt-lab-landing.html');
const webDir = join(sourceDir, 'prompt-lab-web');
const webIndexHtml = join(webDir, 'index.html');
const webPublicDir = join(sourceDir, 'prompt-lab-web', 'public');
const webTemplatesDir = join(webPublicDir, 'templates');
const webMobileDir = join(webPublicDir, 'mobile');
const docsDir = join(repoDir, 'docs');

const copyTargets = [
  ['favicon.svg', 'favicon.svg'],
  ['hero-logo.png', 'hero-logo.png'],
  ['landing-product-shot.png', 'landing-product-shot.png'],
  ['og-image.png', 'og-image.png'],
  ['robots.txt', 'robots.txt'],
  ['sitemap.xml', 'sitemap.xml'],
];

// Additional pages from prompt-lab-web/public/
const webPageTargets = [
  ['guide.html', 'guide.html'],
  ['setup.html', 'setup.html'],
  ['prompt-embed.html', 'prompt-embed.html'],
  ['privacy.html', 'privacy.html'],
  ['tools.html', 'tools.html'],
];

async function resetDocsDir() {
  await mkdir(docsDir, { recursive: true });
  const generatedTargets = [
    ...copyTargets.map(([, toName]) => join(docsDir, toName)),
    ...webPageTargets.map(([, toName]) => join(docsDir, toName)),
    join(docsDir, 'templates'),
    join(docsDir, 'mobile'),
    join(docsDir, 'privatepolicy.html'),
    join(docsDir, 'fonts'),
    join(docsDir, '.nojekyll'),
    join(docsDir, 'CNAME'),
  ];

  for (const target of generatedTargets) {
    await rm(target, { recursive: true, force: true });
  }
}

async function copyLandingIndex() {
  await cp(webIndexHtml, join(docsDir, 'index.html'));
}

async function copyTarget(fromName, toName) {
  await cp(join(webPublicDir, fromName), join(docsDir, toName));
}

async function copyFontsDir() {
  const sourceFontsDir = join(webPublicDir, 'fonts');
  const targetFontsDir = join(docsDir, 'fonts');
  const sourceStats = await stat(sourceFontsDir);

  if (!sourceStats.isDirectory()) {
    throw new Error(`Expected fonts directory at ${sourceFontsDir}`);
  }

  await cp(sourceFontsDir, targetFontsDir, { recursive: true });
}

async function copyTemplatesDir() {
  try {
    const templateStats = await stat(webTemplatesDir);
    if (!templateStats.isDirectory()) return;
    await cp(webTemplatesDir, join(docsDir, 'templates'), { recursive: true });
  } catch {
    // Templates remain optional; skip when the public directory does not exist.
  }
}

async function copyMobileDir() {
  try {
    const mobileStats = await stat(webMobileDir);
    if (!mobileStats.isDirectory()) return;

    const targetMobileDir = join(docsDir, 'mobile');
    await cp(webMobileDir, targetMobileDir, { recursive: true });
    await rm(join(targetMobileDir, 'standalone.html'), { force: true });
    await writeFile(
      join(targetMobileDir, 'index.html'),
      `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PromptLab Mobile Prototype</title>
  <meta http-equiv="refresh" content="0; url=./prototype.html">
  <link rel="canonical" href="https://promptlab.tools/mobile/prototype.html">
</head>
<body>
  <p><a href="./prototype.html">Open the PromptLab Mobile prototype</a></p>
</body>
</html>
`,
      'utf8',
    );
  } catch {
    // Mobile remains optional; skip when the static fallback directory does not exist.
  }
}

async function writeNoJekyll() {
  await writeFile(join(docsDir, '.nojekyll'), '', 'utf8');
}

async function writeCname() {
  await writeFile(join(docsDir, 'CNAME'), 'promptlab.tools\n', 'utf8');
}

async function writeLegacyPrivacyRedirect() {
  await writeFile(
    join(docsDir, 'privatepolicy.html'),
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Prompt Lab Privacy Policy</title>
  <meta http-equiv="refresh" content="0; url=./privacy.html">
  <link rel="canonical" href="https://promptlab.tools/privacy.html">
</head>
<body>
  <p><a href="./privacy.html">Open the Prompt Lab privacy policy</a></p>
</body>
</html>
`,
    'utf8',
  );
}

async function validatePublicInputs() {
  await stat(webIndexHtml);

  for (const [fromName] of copyTargets) {
    await stat(join(webPublicDir, fromName));
  }

  const entries = await readdir(webPublicDir);
  if (!entries.includes('hero-logo.png')) {
    throw new Error('Expected landing public assets in prompt-lab-web/public/');
  }
}

async function warnOnLegacyLandingDrift() {
  try {
    await stat(legacyLandingFile);
  } catch {
    return;
  }

  const [legacyHtml, webHtml] = await Promise.all([
    readFile(legacyLandingFile, 'utf8'),
    readFile(webIndexHtml, 'utf8'),
  ]);

  if (legacyHtml !== webHtml) {
    console.warn(
      '[publish-landing] prompt-lab-web/index.html is canonical. public/prompt-lab-landing.html differs and is no longer published.',
    );
  }
}

async function main() {
  await validatePublicInputs();
  await warnOnLegacyLandingDrift();
  await resetDocsDir();

  await copyLandingIndex();

  for (const [fromName, toName] of copyTargets) {
    await copyTarget(fromName, toName);
  }

  await copyFontsDir();
  await copyTemplatesDir();
  await copyMobileDir();

  // Copy web pages (guide, setup)
  for (const [fromName, toName] of webPageTargets) {
    const src = join(webPublicDir, fromName);
    try {
      await stat(src);
      await cp(src, join(docsDir, toName));
    } catch {
      console.warn(`  Optional page ${fromName} not found, skipping`);
    }
  }

  await writeNoJekyll();
  await writeCname();
  await writeLegacyPrivacyRedirect();

  console.log(`Landing site published to ${docsDir}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
