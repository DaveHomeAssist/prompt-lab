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
 * Adding a check: see the "Documentation consistency checks" and "Adding a
 * check" sections of `docs/docs-style-guide.md`.
 */

import { readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const failures = [];
const checked = [];

function fail(contract, detail) {
  failures.push({ contract, detail });
}

// A contract that already failed must not also report ok. Without this the
// summary printed both lines for the same contract and counted it as passing.
function pass(contract, detail) {
  if (failures.some((entry) => entry.contract === contract)) return;
  checked.push({ contract, detail });
}

const read = (relPath) => readFile(join(repoDir, relPath), 'utf8');

// `file://${join(...)}` produces an invalid URL for Windows drive and
// backslash paths, so `docs:consistency` failed to import anything on the
// Windows environments this repo supports. pathToFileURL handles both.
const moduleUrl = (relPath) => pathToFileURL(join(repoDir, relPath)).href;

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
  const { resolveRouteState } = await import(moduleUrl(registryPath));
  const states = new Map();
  for (const route of shipped) {
    const state = resolveRouteState(route);
    if (!state) {
      fail(contract, `${route} was parsed from ROUTE_TO_STATE but does not resolve`);
      continue;
    }
    states.set(route, state);
  }

  // A mention is the route as a whole token, so `/split` does not satisfy
  // `/split/write`, and punctuation between two routes in one table cell (as
  // in `` `/split/write`, `/split/library` ``) hides neither of them.
  const mentions = (text, route) => {
    const pattern = new RegExp(`(^|[^\\w/])${route.replace(/\//g, '\\/')}([^\\w/]|$)`);
    return text.split('\n').filter((line) => pattern.test(line));
  };

  // useRouteSync.js carries a prose route map in a docblock. It is checked for
  // coverage only — the state column there is written for humans ("dual pane"),
  // not as machine-comparable values.
  const commentDoc = 'prompt-lab-extension/src/hooks/useRouteSync.js';
  const commentText = await read(commentDoc);
  const missingFromComment = shipped.filter((route) => mentions(commentText, route).length === 0);
  if (missingFromComment.length > 0) {
    fail(contract, `${commentDoc} does not mention shipped route(s): ${missingFromComment.join(', ')}`);
  }

  // DECISIONS.md presents its As-shipped block as a route-to-state table and
  // names ROUTE_TO_STATE as the source of truth, so it is held to the pairing.
  // Route names alone are not the contract: checking only that a path appears
  // would let a stale mapping such as `/compare → create · editor` pass. The
  // comparison is scoped to the State cell so a token cannot be satisfied by
  // the route's own name (`/library` "containing" the state `library`).
  const decisionsPath = 'docs/DECISIONS.md';
  const decisionsText = await read(decisionsPath);
  const stateCells = new Map();
  for (const line of decisionsText.split('\n')) {
    const cells = line.split('|').map((cell) => cell.trim());
    if (cells.length < 4) continue;
    const [, routeCell, stateCell] = cells;
    for (const [, route] of routeCell.matchAll(/`(\/[a-z/]*)`/g)) {
      stateCells.set(route, stateCell);
    }
  }

  for (const route of shipped) {
    const stateCell = stateCells.get(route);
    if (stateCell === undefined) {
      fail(contract, `${decisionsPath} As-shipped table has no row for shipped route ${route}`);
      continue;
    }
    const expected = [...new Set(
      Object.values(states.get(route) ?? {}).filter((value) => typeof value === 'string' && value),
    )];
    const absent = expected.filter((token) => !new RegExp(`\\b${token}\\b`).test(stateCell));
    if (absent.length > 0) {
      fail(
        contract,
        `${decisionsPath} states "${stateCell}" for ${route}, missing: ${absent.join(', ')}`,
      );
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

  // A missing match must fail, not quietly drop the fact. Guarding this with
  // `if (models)` meant renaming or reformatting DEFAULT_ALLOWED_MODELS removed
  // the model-boundary check while the contract still reported as satisfied.
  const models = /const DEFAULT_ALLOWED_MODELS = \[([^\]]*)\]/.exec(proxy);
  facts.DEFAULT_ALLOWED_MODELS = models
    ? [...models[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).join(', ')
    : null;

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
    moduleUrl('prompt-lab-extension/src/constants.js')
  );

  if (typeof DEFAULT_GOLDEN_THRESHOLD !== 'number') {
    fail(contract, 'DEFAULT_GOLDEN_THRESHOLD is not exported as a number');
    return;
  }

  const doc = await read('prompt-lab-extension/GOLDEN_RESPONSE_THRESHOLD.md');

  // A bare substring search was too weak: the document lists measured scores,
  // so changing the default to 0.875 would have "matched" the acceptable-floor
  // row while the whole "Why 0.7" rationale silently went stale. Require a
  // labelled statement of the current default instead.
  const declared = /^Default threshold:\s*`([0-9.]+)`\s*$/m.exec(doc);
  if (!declared) {
    fail(contract, 'GOLDEN_RESPONSE_THRESHOLD.md has no "Default threshold: `<value>`" line to check');
  } else if (Number(declared[1]) !== DEFAULT_GOLDEN_THRESHOLD) {
    fail(
      contract,
      `GOLDEN_RESPONSE_THRESHOLD.md declares ${declared[1]} but DEFAULT_GOLDEN_THRESHOLD is ${DEFAULT_GOLDEN_THRESHOLD}`,
    );
  }

  // The rationale section is titled after the value, so it goes stale silently
  // when the default moves. Pin the heading to the constant too.
  const heading = new RegExp(`^## Why ${String(DEFAULT_GOLDEN_THRESHOLD).replace('.', '\\.')}\\s*$`, 'm');
  if (!heading.test(doc)) {
    fail(
      contract,
      `GOLDEN_RESPONSE_THRESHOLD.md has no "## Why ${DEFAULT_GOLDEN_THRESHOLD}" section justifying the current default`,
    );
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
