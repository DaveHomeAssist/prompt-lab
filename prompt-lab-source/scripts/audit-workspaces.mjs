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

export function auditWorkspace(workspace, {
  sourceDir = SOURCE_DIR,
  npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm',
  spawn = spawnSync,
} = {}) {
  const cwd = resolve(sourceDir, workspace.relativePath);
  for (const requiredFile of ['package.json', 'package-lock.json']) {
    if (!existsSync(join(cwd, requiredFile))) {
      throw new Error(`${workspace.name}: missing ${requiredFile} in ${cwd}.`);
    }
  }

  const result = spawn(npmCommand, ['audit', '--json', '--audit-level=high'], {
    cwd,
    encoding: 'utf8',
  });
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
  const gatePassed = summary.high === 0 && summary.critical === 0;
  if (result.status !== 0 && gatePassed) {
    const detail = String(result.stderr || report?.error?.summary || 'unknown npm audit failure').trim().slice(-500);
    throw new Error(`${workspace.name}: npm audit failed without a high/critical finding: ${detail}`);
  }

  return {
    ...workspace,
    cwd,
    summary,
    gatePassed,
    outcome: gatePassed ? 'passed' : 'vulnerable',
  };
}

export function formatAuditLine(result) {
  if (result.outcome === 'error') {
    return `✗ ${result.name}: invocation error — ${result.errorMessage}`;
  }
  const icon = result.gatePassed ? '✓' : '✗';
  return `${icon} ${result.name}: ${result.summary.critical} critical, ${result.summary.high} high, `
    + `${result.summary.moderate} moderate, ${result.summary.low} low`;
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

  if (outcomes.error > 0 || totals.high > 0 || totals.critical > 0) {
    console.error('\nDependency audit failed: invocation errors or high/critical advisories remain.');
    process.exitCode = 1;
  } else {
    console.log('\nDependency audit passed: all workspaces ran with zero high and zero critical advisories.');
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  main();
}
