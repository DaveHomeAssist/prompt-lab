#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const SOURCE_DIR = resolve(scriptDir, '..');
export const AUDIT_WORKSPACES = Object.freeze([
  Object.freeze({ name: 'root', relativePath: '.' }),
  Object.freeze({ name: 'extension', relativePath: 'prompt-lab-extension' }),
  Object.freeze({ name: 'web', relativePath: 'prompt-lab-web' }),
  Object.freeze({ name: 'desktop', relativePath: 'prompt-lab-desktop' }),
]);

const VULNERABILITY_LEVELS = ['info', 'low', 'moderate', 'high', 'critical'];
const GATED_SEVERITIES = new Set(['high', 'critical']);

// High/critical advisories accepted for a bounded time. An exception holds only
// while the advisory stays out of the production (--omit=dev) audit, and only
// through its `expires` date (UTC). Add one only when no fixed release exists.
export const AUDIT_EXCEPTIONS = Object.freeze([
  Object.freeze({
    id: 'GHSA-vfj7-8cjw-p6xm',
    package: 'braces',
    expires: '2026-11-05',
    reason: 'No fixed braces release exists (3.0.3 is the latest and is affected). It reaches '
      + 'only dev tooling: markdownlint-cli2 in root and Tailwind 3 in extension, web and desktop.',
  }),
]);

/** Distinct advisories behind a report's vulnerable packages, keyed by GHSA ID. */
export function listAdvisories(report) {
  const advisories = new Map();
  for (const vulnerability of Object.values(report?.vulnerabilities ?? {})) {
    for (const via of vulnerability?.via ?? []) {
      if (!via || typeof via !== 'object') continue;
      const id = String(via.url ?? '').match(/GHSA-[\w-]+$/)?.[0] ?? `npm-${via.source}`;
      advisories.set(id, { id, package: via.name, severity: via.severity });
    }
  }
  return [...advisories.values()];
}

function findException(advisory, exceptions) {
  return exceptions.find((exception) => exception.id === advisory.id && exception.package === advisory.package);
}

export function summarizeAuditReport(report) {
  const vulnerabilities = report?.metadata?.vulnerabilities;
  if (!vulnerabilities || typeof vulnerabilities !== 'object') {
    throw new TypeError('npm audit output did not include metadata.vulnerabilities.');
  }

  return Object.fromEntries(VULNERABILITY_LEVELS.map((level) => {
    const count = Number(vulnerabilities[level] ?? 0);
    if (!Number.isInteger(count) || count < 0) {
      throw new TypeError(`npm audit returned an invalid ${level} count.`);
    }
    return [level, count];
  }));
}

export function aggregateAuditSummaries(summaries) {
  const totals = Object.fromEntries(VULNERABILITY_LEVELS.map((level) => [level, 0]));
  for (const summary of summaries) {
    for (const level of VULNERABILITY_LEVELS) {
      totals[level] += summary[level];
    }
  }
  return totals;
}

function runNpmAudit(workspace, cwd, args, { npmCommand, spawn }) {
  const result = spawn(npmCommand, args, { cwd, encoding: 'utf8' });
  if (result.error) {
    throw new Error(`${workspace.name}: npm audit could not start: ${result.error.message}`);
  }

  let report;
  try {
    report = JSON.parse(result.stdout || '');
  } catch {
    const detail = String(result.stderr || result.stdout || 'no output').trim().slice(-500);
    throw new Error(`${workspace.name}: npm audit returned invalid JSON: ${detail}`);
  }

  const summary = summarizeAuditReport(report);
  if (result.status !== 0 && summary.high === 0 && summary.critical === 0) {
    const detail = String(result.stderr || report?.error?.summary || 'unknown npm audit failure').trim().slice(-500);
    throw new Error(`${workspace.name}: npm audit failed without a high/critical finding: ${detail}`);
  }
  return { report, summary };
}

export function auditWorkspace(workspace, {
  sourceDir = SOURCE_DIR,
  npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm',
  spawn = spawnSync,
  exceptions = AUDIT_EXCEPTIONS,
  now = new Date(),
} = {}) {
  const cwd = resolve(sourceDir, workspace.relativePath);
  for (const requiredFile of ['package.json', 'package-lock.json']) {
    if (!existsSync(join(cwd, requiredFile))) {
      throw new Error(`${workspace.name}: missing ${requiredFile} in ${cwd}.`);
    }
  }

  const npm = { npmCommand, spawn };
  const { report, summary } = runNpmAudit(workspace, cwd, ['audit', '--json', '--audit-level=high'], npm);
  const gated = listAdvisories(report).filter((advisory) => GATED_SEVERITIES.has(advisory.severity));
  const today = now.toISOString().slice(0, 10);
  const notes = [];

  let candidates = gated.filter((advisory) => {
    const exception = findException(advisory, exceptions);
    if (!exception) return false;
    if (today > exception.expires) {
      notes.push(`${advisory.id} exception expired ${exception.expires}`);
      return false;
    }
    return true;
  });
  if (candidates.length > 0) {
    const production = runNpmAudit(workspace, cwd, ['audit', '--json', '--audit-level=high', '--omit=dev'], npm);
    const productionIds = new Set(listAdvisories(production.report).map((advisory) => advisory.id));
    candidates = candidates.filter((advisory) => {
      if (!productionIds.has(advisory.id)) return true;
      notes.push(`${advisory.id} reaches production dependencies`);
      return false;
    });
  }

  const accepted = candidates.map((advisory) => advisory.id);
  const blocking = gated.map((advisory) => advisory.id).filter((id) => !accepted.includes(id));
  // High/critical counts with no advisory behind them cannot be matched to an exception.
  const unattributed = gated.length === 0 && (summary.high > 0 || summary.critical > 0);
  const gatePassed = blocking.length === 0 && !unattributed;

  return {
    ...workspace,
    cwd,
    summary,
    accepted,
    blocking,
    notes,
    gatePassed,
    outcome: gatePassed ? 'passed' : 'vulnerable',
  };
}

export function formatAuditLine(result) {
  if (result.outcome === 'error') {
    return `✗ ${result.name}: invocation error — ${result.errorMessage}`;
  }
  const icon = result.gatePassed ? '✓' : '✗';
  const details = [
    ...(result.accepted?.length ? [`accepted: ${result.accepted.join(', ')}`] : []),
    ...(result.blocking?.length ? [`blocking: ${result.blocking.join(', ')}`] : []),
    ...(result.notes ?? []),
  ];
  return `${icon} ${result.name}: ${result.summary.critical} critical, ${result.summary.high} high, `
    + `${result.summary.moderate} moderate, ${result.summary.low} low`
    + (details.length ? ` (${details.join('; ')})` : '');
}

export function runWorkspaceAudits({ workspaces = AUDIT_WORKSPACES, ...options } = {}) {
  return workspaces.map((workspace) => {
    try {
      return auditWorkspace(workspace, options);
    } catch (error) {
      return {
        ...workspace,
        cwd: resolve(options.sourceDir || SOURCE_DIR, workspace.relativePath),
        gatePassed: false,
        outcome: 'error',
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

export function aggregateAuditResults(results) {
  const auditable = results.filter((result) => result.outcome !== 'error');
  return {
    totals: aggregateAuditSummaries(auditable.map((result) => result.summary)),
    outcomes: {
      passed: results.filter((result) => result.outcome === 'passed').length,
      vulnerable: results.filter((result) => result.outcome === 'vulnerable').length,
      error: results.filter((result) => result.outcome === 'error').length,
    },
  };
}

function main() {
  console.log('PromptLab dependency audit — high/critical release gate\n');
  const results = runWorkspaceAudits();
  for (const result of results) console.log(formatAuditLine(result));

  const { totals, outcomes } = aggregateAuditResults(results);
  console.log(`\nOutcomes: ${outcomes.passed} passed, ${outcomes.vulnerable} vulnerable, `
    + `${outcomes.error} invocation errors`);
  console.log(`Total: ${totals.critical} critical, ${totals.high} high, `
    + `${totals.moderate} moderate, ${totals.low} low`);

  const acceptedIds = new Set(results.flatMap((result) => result.accepted ?? []));
  for (const exception of AUDIT_EXCEPTIONS.filter((entry) => acceptedIds.has(entry.id))) {
    console.log(`Accepted until ${exception.expires}: ${exception.id} (${exception.package}) — ${exception.reason}`);
  }

  if (outcomes.error > 0 || outcomes.vulnerable > 0) {
    console.error('\nDependency audit failed: invocation errors or high/critical advisories remain.');
    process.exitCode = 1;
  } else {
    console.log('\nDependency audit passed: no high or critical advisories outside unexpired dev-only exceptions.');
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  main();
}
