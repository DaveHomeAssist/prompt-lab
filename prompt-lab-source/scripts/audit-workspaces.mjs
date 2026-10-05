#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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

// Time-boxed exceptions to the gate live in scripts/audit-allowlist.json. An entry silences
// exactly one GitHub advisory, for one package, until its expiry date. A vulnerability is
// left out of the counts only when every advisory behind it (directly, or through the
// packages it depends on) is covered, so any other advisory in the same chain still fails.
export const ALLOWLIST_PATH = join(scriptDir, 'audit-allowlist.json');
export const MAX_EXCEPTION_DAYS = 90;

const ADVISORY_ID = /^GHSA(?:-[a-z0-9]{4}){3}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function utcToday() {
  return new Date().toISOString().slice(0, 10);
}

function isCalendarDate(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

export function parseAuditAllowlist(data) {
  if (!Array.isArray(data?.advisories)) {
    throw new TypeError('the exception list must contain an "advisories" array.');
  }

  const seen = new Set();
  return data.advisories.map((entry, index) => {
    const where = `advisories[${index}]`;
    if (!entry || typeof entry !== 'object') throw new TypeError(`${where} must be an object.`);
    const { id, package: packageName, reason, removeWhen, added, expires } = entry;
    if (typeof id !== 'string' || !ADVISORY_ID.test(id)) {
      throw new TypeError(`${where}.id must be a GitHub advisory id such as GHSA-xxxx-xxxx-xxxx.`);
    }
    if (seen.has(id)) throw new TypeError(`${where}.id ${id} is listed twice.`);
    seen.add(id);
    if (typeof packageName !== 'string' || !packageName.trim()) {
      throw new TypeError(`${where}.package must name the vulnerable package.`);
    }
    for (const [field, value] of [['reason', reason], ['removeWhen', removeWhen]]) {
      if (typeof value !== 'string' || value.trim().length < 20) {
        throw new TypeError(`${where}.${field} must explain the exception in a sentence.`);
      }
    }
    if (!isCalendarDate(added) || !isCalendarDate(expires)) {
      throw new TypeError(`${where}.added and ${where}.expires must be YYYY-MM-DD dates.`);
    }
    const days = daysBetween(added, expires);
    if (days < 0) throw new TypeError(`${where}.expires is before ${where}.added.`);
    if (days > MAX_EXCEPTION_DAYS) {
      throw new TypeError(`${where} must expire within ${MAX_EXCEPTION_DAYS} days of being added.`);
    }
    return Object.freeze({
      id,
      package: packageName,
      reason: reason.trim(),
      removeWhen: removeWhen.trim(),
      added,
      expires,
    });
  });
}

export function loadAuditAllowlist(path = ALLOWLIST_PATH) {
  let data;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`could not read ${path}: ${error instanceof Error ? error.message : error}`);
  }
  return parseAuditAllowlist(data);
}

export function advisoryIdFromUrl(url) {
  const match = /(GHSA(?:-[a-z0-9]{4}){3})\/?$/.exec(String(url ?? ''));
  return match ? match[1] : null;
}

// Counts for one npm audit report with the active exceptions applied. Without an active
// exception, or without per-vulnerability detail to match against, the raw counts stand.
export function applyAuditAllowlist(report, allowlist = [], { today = utcToday() } = {}) {
  const raw = summarizeAuditReport(report);
  const active = allowlist.filter((entry) => entry.expires >= today);
  const expired = allowlist.filter((entry) => entry.expires < today);
  const unchanged = { raw, summary: raw, excluded: [], matched: [], active, expired };

  const vulnerabilities = report.vulnerabilities;
  if (active.length === 0 || !vulnerabilities || typeof vulnerabilities !== 'object') return unchanged;

  const byId = new Map(active.map((entry) => [entry.id, entry]));
  const entries = Object.entries(vulnerabilities);
  const uncovered = new Set();
  for (let changed = true; changed;) {
    changed = false;
    for (const [name, vulnerability] of entries) {
      if (uncovered.has(name)) continue;
      const via = Array.isArray(vulnerability?.via) ? vulnerability.via : [];
      const covered = via.length > 0 && via.every((item) => {
        if (typeof item === 'string') return Object.hasOwn(vulnerabilities, item) && !uncovered.has(item);
        const entry = byId.get(advisoryIdFromUrl(item?.url));
        return Boolean(entry) && entry.package === item?.name;
      });
      if (!covered) {
        uncovered.add(name);
        changed = true;
      }
    }
  }

  // A covered vulnerability must also trace back to an exempt advisory, so a group of
  // packages that only point at each other is never excluded.
  const covered = entries.filter(([name]) => !uncovered.has(name));
  const grounded = new Set();
  for (let changed = true; changed;) {
    changed = false;
    for (const [name, vulnerability] of covered) {
      if (grounded.has(name)) continue;
      if (vulnerability.via.some((item) => typeof item === 'object' || grounded.has(item))) {
        grounded.add(name);
        changed = true;
      }
    }
  }
  const excluded = covered
    .filter(([name]) => grounded.has(name))
    .map(([name, vulnerability]) => ({ name, severity: vulnerability.severity, via: vulnerability.via }));
  if (excluded.length === 0) return unchanged;

  // Subtract from npm's own totals rather than recounting, so a mismatch between the summary
  // and the detail can only make the gate stricter.
  const summary = { ...raw };
  for (const { severity } of excluded) {
    if (Object.hasOwn(summary, severity)) summary[severity] = Math.max(0, summary[severity] - 1);
  }
  const matched = [...new Set(excluded.flatMap(({ via }) => via
    .filter((item) => typeof item === 'object')
    .map((item) => advisoryIdFromUrl(item.url))
    .filter(Boolean)))];
  return {
    raw,
    summary,
    excluded: excluded.map(({ name, severity }) => ({ name, severity })),
    matched,
    active,
    expired,
  };
}

export function auditWorkspace(workspace, {
  sourceDir = SOURCE_DIR,
  npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm',
  spawn = spawnSync,
  allowlist = [],
  today,
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

  const { raw, summary, excluded, matched } = applyAuditAllowlist(report, allowlist, { today });
  const gatePassed = summary.high === 0 && summary.critical === 0;
  // npm failing with no high/critical finding of its own is an invocation problem, whatever
  // the exceptions do to the counts.
  if (result.status !== 0 && raw.high === 0 && raw.critical === 0) {
    const detail = String(result.stderr || report?.error?.summary || 'unknown npm audit failure').trim().slice(-500);
    throw new Error(`${workspace.name}: npm audit failed without a high/critical finding: ${detail}`);
  }

  return {
    ...workspace,
    cwd,
    summary,
    rawSummary: raw,
    excluded,
    matchedAdvisories: matched,
    gatePassed,
    outcome: gatePassed ? 'passed' : 'vulnerable',
  };
}

function describeExcluded(excluded) {
  const counts = {};
  for (const { severity } of excluded) counts[severity] = (counts[severity] ?? 0) + 1;
  return [...VULNERABILITY_LEVELS].reverse()
    .filter((level) => counts[level])
    .map((level) => `${counts[level]} ${level}`)
    .join(', ');
}

export function formatAuditLine(result) {
  if (result.outcome === 'error') {
    return `✗ ${result.name}: invocation error — ${result.errorMessage}`;
  }
  const icon = result.gatePassed ? '✓' : '✗';
  const exception = result.excluded?.length
    ? ` (not counted: ${describeExcluded(result.excluded)} under exception ${result.matchedAdvisories.join(', ')})`
    : '';
  return `${icon} ${result.name}: ${result.summary.critical} critical, ${result.summary.high} high, `
    + `${result.summary.moderate} moderate, ${result.summary.low} low${exception}`;
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

function reportExceptions(allowlist, results, today) {
  const used = new Set(results.flatMap((result) => result.matchedAdvisories ?? []));
  for (const entry of allowlist) {
    const label = `${entry.id} (${entry.package})`;
    if (entry.expires < today) {
      console.error(`✗ Exception ${label} expired on ${entry.expires} and is no longer applied. ${entry.removeWhen}`);
      continue;
    }
    const days = daysBetween(today, entry.expires);
    console.log(`${days <= 14 ? '⚠' : '•'} Exception ${label} until ${entry.expires} (${days} days left): ${entry.reason}`);
    console.log(`  Remove it when: ${entry.removeWhen}`);
    if (!used.has(entry.id)) {
      console.log(`  It matched no advisory in this run; delete it from ${ALLOWLIST_PATH}.`);
    }
  }
}

function main() {
  console.log('PromptLab dependency audit — high/critical release gate\n');
  let allowlist;
  try {
    allowlist = loadAuditAllowlist();
  } catch (error) {
    console.error(`Dependency audit failed: the exception list is invalid: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
    return;
  }

  const today = utcToday();
  const results = runWorkspaceAudits({ allowlist, today });
  for (const result of results) console.log(formatAuditLine(result));

  const { totals, outcomes } = aggregateAuditResults(results);
  console.log(`\nOutcomes: ${outcomes.passed} passed, ${outcomes.vulnerable} vulnerable, `
    + `${outcomes.error} invocation errors`);
  console.log(`Total: ${totals.critical} critical, ${totals.high} high, `
    + `${totals.moderate} moderate, ${totals.low} low`);
  if (allowlist.length > 0) console.log('');
  reportExceptions(allowlist, results, today);

  if (outcomes.error > 0 || totals.high > 0 || totals.critical > 0) {
    console.error('\nDependency audit failed: invocation errors or high/critical advisories remain.');
    process.exitCode = 1;
  } else if (results.some((result) => result.excluded?.length)) {
    console.log('\nDependency audit passed: zero high and zero critical advisories outside the time-boxed exceptions above.');
  } else {
    console.log('\nDependency audit passed: all workspaces ran with zero high and zero critical advisories.');
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  main();
}
