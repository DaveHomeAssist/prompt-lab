#!/usr/bin/env node
/**
 * Codex Preflight Check — run before push/deploy.
 *
 * Usage:
 *   node scripts/preflight.mjs          # full check
 *   node scripts/preflight.mjs --quick  # skip tests (build + validate only)
 */
import { execSync } from 'node:child_process';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const sourceDir = resolve(scriptDir, '..');
const repoDir   = resolve(sourceDir, '..');
const extDir    = join(sourceDir, 'prompt-lab-extension');
const webDir    = join(sourceDir, 'prompt-lab-web');
const desktopDir = join(sourceDir, 'prompt-lab-desktop');
const cargoTomlPath = join(desktopDir, 'src-tauri', 'Cargo.toml');
const docsDir   = join(repoDir, 'docs');
const quick     = process.argv.includes('--quick');

const results = [];
let failed = false;

function pass(label, detail) {
  results.push({ status: 'PASS', label, detail });
}
function fail(label, detail) {
  results.push({ status: 'FAIL', label, detail });
  failed = true;
}
function skip(label, detail) {
  results.push({ status: 'SKIP', label, detail });
}
function warn(label, detail) {
  results.push({ status: 'WARN', label, detail });
}

function run(cmd, cwd) {
  try {
    const stdout = execSync(cmd, { cwd, stdio: 'pipe', timeout: 120_000 });
    return { ok: true, stdout: stdout?.toString?.() || '' };
  } catch (err) {
    return {
      ok: false,
      stdout: err.stdout?.toString?.() || '',
      stderr: err.stderr?.toString().slice(-500) || '',
    };
  }
}

// ── 1. GIT STATUS ──
function checkGitStatus() {
  const { ok } = run('git diff --quiet HEAD', repoDir);
  if (!ok) {
    warn('Git working tree', 'Uncommitted changes detected — commit before pushing');
  } else {
    pass('Git working tree', 'Clean');
  }
}

// ── 2. TESTS ──
function checkTests() {
  if (quick) { skip('Unit tests', '--quick flag, skipped'); return; }
  console.log('  Running tests...');
  const result = run('npm test', extDir);
  if (result.ok) {
    pass('Unit tests', 'All passed');
  } else {
    fail('Unit tests', result.stderr.split('\n').slice(-5).join('\n'));
  }
}

// ── 3. EXTENSION BUILD ──
function checkExtensionBuild() {
  console.log('  Building extension...');
  const result = run('npm run build', extDir);
  if (result.ok) {
    pass('Extension build', 'Success');
  } else {
    fail('Extension build', result.stderr.split('\n').slice(-5).join('\n'));
  }
}

// ── 4. WEB BUILD ──
function checkWebBuild() {
  console.log('  Building web app...');
  const result = run('npm run build', webDir);
  if (result.ok) {
    pass('Web build', 'Success');
  } else {
    fail('Web build', result.stderr.split('\n').slice(-5).join('\n'));
  }
}

// ── 5. LANDING PUBLISH ──
function checkLandingPublish() {
  console.log('  Publishing landing page...');
  const result = run('npm run build:landing', sourceDir);
  if (result.ok) {
    pass('Landing publish', 'Success');
  } else {
    fail('Landing publish', result.stderr.split('\n').slice(-5).join('\n'));
  }
}

// ── 6. DIST ARTIFACTS ──
async function checkDistArtifacts() {
  const checks = [
    { path: join(extDir, 'dist', 'panel.html'),  label: 'Extension panel.html' },
    { path: join(webDir, 'dist', 'index.html'),   label: 'Web index.html' },
    { path: join(docsDir, 'index.html'),           label: 'Landing docs/index.html' },
  ];

  for (const check of checks) {
    try {
      const s = await stat(check.path);
      if (s.size < 100) {
        fail(check.label, `File exists but suspiciously small (${s.size} bytes)`);
      } else {
        pass(check.label, `${(s.size / 1024).toFixed(1)} KB`);
      }
    } catch {
      fail(check.label, 'File not found');
    }
  }
}

// ── 7. BUNDLE SIZE ──
async function checkBundleSize() {
  const distDir = join(extDir, 'dist', 'assets');
  try {
    const files = await readdir(distDir);
    const jsFiles = files.filter(f => f.endsWith('.js'));
    let totalSize = 0;
    for (const file of jsFiles) {
      const s = await stat(join(distDir, file));
      totalSize += s.size;
    }
    const sizeKB = (totalSize / 1024).toFixed(0);
    if (totalSize > 500_000) {
      warn('Extension JS bundle', `${sizeKB} KB — over 500 KB, consider investigating`);
    } else {
      pass('Extension JS bundle', `${sizeKB} KB total`);
    }
  } catch {
    warn('Extension JS bundle', 'Could not read dist/assets');
  }
}

// ── 8. LANDING PAGE ASSETS ──
async function checkLandingAssets() {
  const required = ['index.html', 'fonts', 'hero-logo.png', 'landing-product-shot.png', 'og-image.png'];
  const docsPages = ['guide.html', 'setup.html', 'prompt-embed.html', 'privacy.html', 'tools.html'];
  const optional = ['templates'];

  for (const name of required) {
    try {
      await stat(join(docsDir, name));
      pass(`docs/${name}`, 'Present');
    } catch {
      fail(`docs/${name}`, 'Missing from landing deploy');
    }
  }

  for (const name of docsPages) {
    try {
      await stat(join(docsDir, name));
      pass(`docs/${name}`, 'Present');
    } catch {
      fail(`docs/${name}`, 'Missing from landing publish');
    }
  }

  for (const name of optional) {
    try {
      await stat(join(docsDir, name));
      pass(`docs/${name}`, 'Present');
    } catch {
      warn(`docs/${name}`, 'Not in docs/ — add to publish-landing.mjs if needed');
    }
  }
}

// ── 9. VERSION CONSISTENCY ──
async function checkVersions() {
  const pkgs = [
    join(sourceDir, 'package.json'),
    join(extDir, 'package.json'),
    join(webDir, 'package.json'),
  ];
  const versions = [];
  for (const p of pkgs) {
    try {
      const pkg = JSON.parse(await readFile(p, 'utf8'));
      versions.push({ path: relative(repoDir, p), version: pkg.version || '???' });
    } catch {
      versions.push({ path: relative(repoDir, p), version: '???' });
    }
  }
  try {
    const cargoToml = await readFile(cargoTomlPath, 'utf8');
    const match = cargoToml.match(/^version = "([^"]+)"/m);
    versions.push({
      path: relative(repoDir, cargoTomlPath),
      version: match?.[1] || '???',
    });
  } catch {
    versions.push({ path: relative(repoDir, cargoTomlPath), version: '???' });
  }
  const allSame = versions.every(v => v.version === versions[0].version);
  if (allSame) {
    pass('Version consistency', `All packages at v${versions[0].version}`);
  } else {
    const detail = versions.map(v => `${v.path}: ${v.version}`).join(', ');
    warn('Version consistency', `Mismatch — ${detail}`);
  }
}

function checkTrackedIgnoredArtifacts() {
  const result = run("git ls-files 'prompt-lab-source/prompt-lab-web/dist/**'", repoDir);
  if (!result.ok) {
    warn('Tracked ignored artifacts', 'Could not inspect tracked dist files');
    return;
  }

  const trackedEntries = result.stdout.trim().split('\n').filter(Boolean);
  const existingEntries = trackedEntries.filter((entry) => {
    try {
      execSync(`test -e "${entry}"`, { cwd: repoDir, stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  });

  if (existingEntries.length === 0) {
    pass('Tracked ignored artifacts', 'No tracked files under ignored web dist/');
    return;
  }

  warn('Tracked ignored artifacts', `Tracked files remain under ignored web dist/: ${existingEntries.join(', ')}`);
}

// ── REPORT ──
function printReport() {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║       CODEX PREFLIGHT CHECK              ║');
  console.log('╚══════════════════════════════════════════╝\n');

  const icons = { PASS: '\x1b[32m✓\x1b[0m', FAIL: '\x1b[31m✗\x1b[0m', WARN: '\x1b[33m⚠\x1b[0m', SKIP: '\x1b[90m○\x1b[0m' };
  for (const r of results) {
    console.log(`  ${icons[r.status]}  ${r.label}`);
    if (r.detail && r.status !== 'PASS') {
      console.log(`     ${r.detail.split('\n').join('\n     ')}`);
    }
  }

  const counts = { PASS: 0, FAIL: 0, WARN: 0, SKIP: 0 };
  for (const r of results) counts[r.status]++;

  console.log(`\n  ──────────────────────────────────────`);
  console.log(`  ${counts.PASS} passed · ${counts.FAIL} failed · ${counts.WARN} warnings · ${counts.SKIP} skipped`);

  if (failed) {
    console.log('\n  \x1b[31m✗ PREFLIGHT FAILED — fix issues before pushing\x1b[0m\n');
    process.exitCode = 1;
  } else if (counts.WARN > 0) {
    console.log('\n  \x1b[33m⚠ PREFLIGHT PASSED WITH WARNINGS\x1b[0m\n');
  } else {
    console.log('\n  \x1b[32m✓ PREFLIGHT PASSED — clear to push\x1b[0m\n');
  }
}

// ── RUN ──
async function main() {
  console.log('\n  Prompt Lab — Codex Preflight Check');
  console.log(`  Mode: ${quick ? 'quick (skip tests)' : 'full'}\n`);

  checkGitStatus();
  checkTests();
  checkExtensionBuild();
  checkWebBuild();
  checkLandingPublish();
  await checkDistArtifacts();
  await checkBundleSize();
  await checkLandingAssets();
  await checkVersions();
  checkTrackedIgnoredArtifacts();
  printReport();
}

main().catch(err => {
  console.error('Preflight script error:', err);
  process.exitCode = 1;
});
