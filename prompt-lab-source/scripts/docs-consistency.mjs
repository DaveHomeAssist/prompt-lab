#!/usr/bin/env node
/**
 * Documentation consistency checks (DHA-18).
 *
 * Markdown lint catches formatting and lychee catches dead links, but neither
 * notices when a document states something the code no longer does. These
 * checks pin a small number of high-risk documentation contracts — facts that
 * are stated in prose and are expensive to get wrong — against the modules that
 * define them.
 *
 * Design rule: every expectation is read from current source at run time. There
 * are no hardcoded expected values to fall out of date, so the check cannot
 * pass against a stale snapshot of its own.
 *
 * Adding a check: see the "Maintaining these checks" section of
 * `docs/docs-style-guide.md`.
 */

import { readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const failures = [];
const checked = [];

function fail(contract, detail) {
  failures.push({ contract, detail });
}

function pass(contract, detail) {
  checked.push({ contract, detail });
}

const read = (relPath) => readFile(join(repoDir, relPath), 'utf8');

// ── Contract 1: hash routes ────────────────────────────────────────────────
// ROUTE_TO_STATE in navigationRegistry.js is the source of truth for routing.
// Two documents restate it, and both have drifted before.
async function checkRoutes() {
  const contract = 'routes';
  const registryPath = 'prompt-lab-extension/src/lib/navigationRegistry.js';
  const source = await read(registryPath);

  const block = /const ROUTE_TO_STATE = Object\.freeze\(\{([\s\S]*?)\}\);/.exec(source);
  if (!block) {
    fail(contract, `could not locate ROUTE_TO_STATE in ${registryPath}`);
    return;
  }

  const shipped = [...block[1].matchAll(/^\s*'([^']+)':/gm)].map((m) => m[1]);
  if (shipped.length === 0) {
    fail(contract, `parsed ROUTE_TO_STATE but found no routes in ${registryPath}`);
    return;
  }

  // Executable proof that each parsed route really resolves, so a parsing
  // mistake cannot silently weaken the check.
  const { resolveRouteState } = await import(
    `file://${join(repoDir, registryPath)}`
  );
  for (const route of shipped) {
    if (!resolveRouteState(route)) {
      fail(contract, `${route} was parsed from ROUTE_TO_STATE but does not resolve`);
    }
  }

  const documents = [
    'docs/DECISIONS.md',
    'prompt-lab-extension/src/hooks/useRouteSync.js',
  ];

  for (const docPath of documents) {
    const text = await read(docPath);
    const missing = shipped.filter((route) => !text.includes(`\`${route}\``) && !text.includes(` ${route} `) && !text.includes(`${route}\n`));
    if (missing.length > 0) {
      fail(contract, `${docPath} does not mention shipped route(s): ${missing.join(', ')}`);
    }
  }

  // The reverse direction: a document must not promise a route that does not
  // exist. Only routes written as `/path` inside the As-shipped table are
  // considered claims, so prose elsewhere is not policed.
  const decisions = await read('docs/DECISIONS.md');
  const asShipped = /As shipped:([\s\S]*?)\n---/.exec(decisions);
  if (!asShipped) {
    fail(contract, 'docs/DECISIONS.md no longer contains an "As shipped:" routing block');
  } else {
    const claimed = [...asShipped[1].matchAll(/`(\/[a-z/]*)`/g)].map((m) => m[1]);
    const unknown = [...new Set(claimed)].filter((route) => !shipped.includes(route));
    if (unknown.length > 0) {
      fail(contract, `docs/DECISIONS.md claims route(s) that do not ship: ${unknown.join(', ')}`);
    }
  }

  pass(contract, `${shipped.length} routes agree across registry, DECISIONS.md, and useRouteSync.js`);
}

// ── Contract 2: hosted proxy boundary ──────────────────────────────────────
// ARCHITECTURE.md states what the hosted proxy will forward. Getting this
// wrong misleads about which providers hosted users can actually reach.
async function checkProxyBoundary() {
  const contract = 'proxy-boundary';
  const proxy = await read('api/proxy.js');
  const architecture = await read('ARCHITECTURE.md');

  const literal = (name) => {
    const match = new RegExp(`const ${name} = '([^']+)'`).exec(proxy);
    return match?.[1] ?? null;
  };

  const facts = {
    SUPPORTED_HOST: literal('SUPPORTED_HOST'),
    SUPPORTED_PATH: literal('SUPPORTED_PATH'),
    SHARED_KEY_PLACEHOLDER: literal('SHARED_KEY_PLACEHOLDER'),
  };

  const models = /const DEFAULT_ALLOWED_MODELS = \[([^\]]*)\]/.exec(proxy);
  if (models) {
    facts.DEFAULT_ALLOWED_MODELS = [...models[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).join(', ');
  }

  for (const [name, value] of Object.entries(facts)) {
    if (!value) {
      fail(contract, `could not read ${name} from api/proxy.js`);
      continue;
    }
    if (!architecture.includes(value)) {
      fail(contract, `ARCHITECTURE.md does not state the current ${name} (${value})`);
    }
  }

  pass(contract, `ARCHITECTURE.md matches ${Object.keys(facts).length} proxy constants`);
}

// ── Contract 3: golden regression threshold ────────────────────────────────
// The documented threshold and its justification must track the constant the
// product actually compares against.
async function checkGoldenThreshold() {
  const contract = 'golden-threshold';
  const { DEFAULT_GOLDEN_THRESHOLD } = await import(
    `file://${join(repoDir, 'prompt-lab-extension/src/constants.js')}`
  );

  if (typeof DEFAULT_GOLDEN_THRESHOLD !== 'number') {
    fail(contract, 'DEFAULT_GOLDEN_THRESHOLD is not exported as a number');
    return;
  }

  const doc = await read('prompt-lab-extension/GOLDEN_RESPONSE_THRESHOLD.md');
  if (!doc.includes(String(DEFAULT_GOLDEN_THRESHOLD))) {
    fail(contract, `GOLDEN_RESPONSE_THRESHOLD.md does not state the current threshold (${DEFAULT_GOLDEN_THRESHOLD})`);
  }

  pass(contract, `documented threshold matches DEFAULT_GOLDEN_THRESHOLD (${DEFAULT_GOLDEN_THRESHOLD})`);
}

async function main() {
  await checkRoutes();
  await checkProxyBoundary();
  await checkGoldenThreshold();

  for (const entry of checked) {
    console.log(`  ok    ${entry.contract} — ${entry.detail}`);
  }
  for (const entry of failures) {
    console.error(`  FAIL  ${entry.contract} — ${entry.detail}`);
  }

  const total = checked.length + failures.length;
  console.log(`\n${checked.length}/${total} documentation contracts consistent`);

  if (failures.length > 0) {
    console.error(
      '\nA document states something the code no longer does. Update the document to '
      + 'match current behavior, or fix the code if the document is the intended contract. '
      + `See ${relative(process.cwd(), join(repoDir, 'docs/docs-style-guide.md'))} for how these checks work.`,
    );
    process.exitCode = 1;
  }
}

await main();
