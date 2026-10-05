import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';

import {
  aggregateAuditResults,
  aggregateAuditSummaries,
  AUDIT_EXCEPTIONS,
  AUDIT_WORKSPACES,
  auditWorkspace,
  formatAuditLine,
  listAdvisories,
  runWorkspaceAudits,
  SOURCE_DIR,
  summarizeAuditReport,
} from '../scripts/audit-workspaces.mjs';

const cleanReport = {
  metadata: {
    vulnerabilities: { info: 0, low: 1, moderate: 2, high: 0, critical: 0 },
  },
};

test('the audit gate selects exactly the four package roots', () => {
  assert.deepEqual(AUDIT_WORKSPACES, [
    { name: 'root', relativePath: '.' },
    { name: 'extension', relativePath: 'prompt-lab-extension' },
    { name: 'web', relativePath: 'prompt-lab-web' },
    { name: 'desktop', relativePath: 'prompt-lab-desktop' },
  ]);
});

test('audit summaries validate and aggregate every severity', () => {
  const first = summarizeAuditReport(cleanReport);
  const second = summarizeAuditReport({
    metadata: {
      vulnerabilities: { info: 1, low: 2, moderate: 3, high: 4, critical: 5 },
    },
  });

  assert.deepEqual(first, { info: 0, low: 1, moderate: 2, high: 0, critical: 0 });
  assert.deepEqual(aggregateAuditSummaries([first, second]), {
    info: 1,
    low: 3,
    moderate: 5,
    high: 4,
    critical: 5,
  });
  assert.throws(() => summarizeAuditReport({}), /metadata\.vulnerabilities/);
});

test('workspace execution uses parameterized npm audit arguments and applies the high gate', () => {
  const calls = [];
  const result = auditWorkspace(AUDIT_WORKSPACES[0], {
    spawn(command, args, options) {
      calls.push({ command, args, options });
      return { status: 0, stdout: JSON.stringify(cleanReport), stderr: '' };
    },
  });

  assert.equal(result.cwd, SOURCE_DIR);
  assert.equal(result.gatePassed, true);
  assert.equal(result.outcome, 'passed');
  assert.deepEqual(calls, [{
    command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    args: ['audit', '--json', '--audit-level=high'],
    options: { cwd: SOURCE_DIR, encoding: 'utf8' },
  }]);
  assert.match(formatAuditLine(result), /^✓ root: 0 critical, 0 high/);
});

test('workspace execution reports high findings without hiding npm status 1', () => {
  const vulnerableReport = {
    metadata: {
      vulnerabilities: { info: 0, low: 0, moderate: 0, high: 2, critical: 0 },
    },
  };
  const result = auditWorkspace(AUDIT_WORKSPACES[1], {
    spawn() {
      return { status: 1, stdout: JSON.stringify(vulnerableReport), stderr: '' };
    },
  });

  assert.equal(result.cwd, join(SOURCE_DIR, 'prompt-lab-extension'));
  assert.equal(result.gatePassed, false);
  assert.equal(result.outcome, 'vulnerable');
  assert.match(formatAuditLine(result), /^✗ extension: 0 critical, 2 high/);
});

test('workspace aggregation reports every root when one invocation is malformed', () => {
  let callCount = 0;
  const vulnerableReport = {
    metadata: {
      vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0 },
    },
  };
  const results = runWorkspaceAudits({
    spawn() {
      callCount += 1;
      if (callCount === 2) return { status: 1, stdout: '{invalid', stderr: 'parse failure' };
      if (callCount === 3) return { status: 1, stdout: JSON.stringify(vulnerableReport), stderr: '' };
      return { status: 0, stdout: JSON.stringify(cleanReport), stderr: '' };
    },
  });

  assert.equal(callCount, AUDIT_WORKSPACES.length);
  assert.deepEqual(results.map((result) => result.outcome), [
    'passed',
    'error',
    'vulnerable',
    'passed',
  ]);
  assert.match(formatAuditLine(results[1]), /^✗ extension: invocation error/);
  assert.deepEqual(aggregateAuditResults(results), {
    totals: { info: 0, low: 2, moderate: 4, high: 1, critical: 0 },
    outcomes: { passed: 2, vulnerable: 1, error: 1 },
  });
});

const bracesAdvisory = {
  source: 1240992,
  name: 'braces',
  dependency: 'braces',
  title: 'braces vulnerable to stack-exhaustion denial of service',
  url: 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm',
  severity: 'high',
  range: '<=3.0.3',
};
const otherHighAdvisory = {
  source: 1,
  name: 'undici',
  dependency: 'undici',
  url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc',
  severity: 'high',
};
const testExceptions = [
  { id: 'GHSA-vfj7-8cjw-p6xm', package: 'braces', expires: '2026-11-05', reason: 'test fixture' },
];

function reportWith(advisories) {
  const vulnerabilities = {};
  for (const advisory of advisories) {
    vulnerabilities[advisory.name] = { severity: advisory.severity, via: [advisory] };
  }
  // A package that is vulnerable only through another one carries a string `via`.
  if (advisories.includes(bracesAdvisory)) {
    vulnerabilities.micromatch = { severity: 'high', via: ['braces'] };
  }
  return {
    metadata: {
      vulnerabilities: { info: 0, low: 0, moderate: 0, high: Object.keys(vulnerabilities).length, critical: 0 },
    },
    vulnerabilities,
  };
}

function auditWith({ full, production = cleanReport, now }) {
  const calls = [];
  const result = auditWorkspace(AUDIT_WORKSPACES[0], {
    exceptions: testExceptions,
    now: new Date(now),
    spawn(_command, args) {
      calls.push(args);
      const report = args.includes('--omit=dev') ? production : full;
      return { status: report.metadata.vulnerabilities.high > 0 ? 1 : 0, stdout: JSON.stringify(report), stderr: '' };
    },
  });
  return { result, calls };
}

test('every audit exception names one advisory and package, a reason, and an ISO expiry date', () => {
  for (const exception of AUDIT_EXCEPTIONS) {
    assert.match(exception.id, /^GHSA-[\w-]+$/);
    assert.ok(exception.package);
    assert.ok(exception.reason);
    assert.match(exception.expires, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(new Date(`${exception.expires}T00:00:00Z`).toISOString().slice(0, 10), exception.expires);
  }
});

test('advisories are listed once by GHSA ID, ignoring packages that are only vulnerable through others', () => {
  const report = reportWith([bracesAdvisory]);
  report.vulnerabilities.globby = { severity: 'high', via: [bracesAdvisory, 'micromatch'] };

  assert.deepEqual(listAdvisories(report), [
    { id: 'GHSA-vfj7-8cjw-p6xm', package: 'braces', severity: 'high' },
  ]);
  assert.deepEqual(listAdvisories(cleanReport), []);
});

test('an unexpired exception passes the gate when the advisory stays out of production dependencies', () => {
  const { result, calls } = auditWith({ full: reportWith([bracesAdvisory]), now: '2026-11-05T23:59:59Z' });

  assert.equal(result.gatePassed, true);
  assert.equal(result.outcome, 'passed');
  assert.deepEqual(result.accepted, ['GHSA-vfj7-8cjw-p6xm']);
  assert.deepEqual(result.blocking, []);
  assert.deepEqual(calls, [
    ['audit', '--json', '--audit-level=high'],
    ['audit', '--json', '--audit-level=high', '--omit=dev'],
  ]);
  assert.match(formatAuditLine(result), /^✓ root: 0 critical, 2 high, .*accepted: GHSA-vfj7-8cjw-p6xm/);
});

test('an exception stops applying the day after it expires', () => {
  const { result, calls } = auditWith({ full: reportWith([bracesAdvisory]), now: '2026-11-06T00:00:00Z' });

  assert.equal(result.gatePassed, false);
  assert.deepEqual(result.accepted, []);
  assert.deepEqual(result.blocking, ['GHSA-vfj7-8cjw-p6xm']);
  assert.deepEqual(result.notes, ['GHSA-vfj7-8cjw-p6xm exception expired 2026-11-05']);
  assert.equal(calls.length, 1);
  assert.match(formatAuditLine(result), /^✗ root: .*blocking: GHSA-vfj7-8cjw-p6xm; GHSA-vfj7-8cjw-p6xm exception expired/);
});

test('an exception does not apply once the advisory reaches production dependencies', () => {
  const full = reportWith([bracesAdvisory]);
  const { result } = auditWith({ full, production: full, now: '2026-10-05T12:00:00Z' });

  assert.equal(result.gatePassed, false);
  assert.deepEqual(result.blocking, ['GHSA-vfj7-8cjw-p6xm']);
  assert.deepEqual(result.notes, ['GHSA-vfj7-8cjw-p6xm reaches production dependencies']);
});

test('an exception never covers a different high advisory', () => {
  const { result } = auditWith({ full: reportWith([bracesAdvisory, otherHighAdvisory]), now: '2026-10-05T12:00:00Z' });

  assert.equal(result.gatePassed, false);
  assert.deepEqual(result.accepted, ['GHSA-vfj7-8cjw-p6xm']);
  assert.deepEqual(result.blocking, ['GHSA-aaaa-bbbb-cccc']);
});

test('an exception for the same GHSA ID under another package name does not apply', () => {
  const renamed = { ...bracesAdvisory, name: 'braces-fork', dependency: 'braces-fork' };
  const { result, calls } = auditWith({ full: reportWith([renamed]), now: '2026-10-05T12:00:00Z' });

  assert.equal(result.gatePassed, false);
  assert.deepEqual(result.blocking, ['GHSA-vfj7-8cjw-p6xm']);
  assert.equal(calls.length, 1);
});
