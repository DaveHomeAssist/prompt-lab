import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';

import {
  aggregateAuditResults,
  aggregateAuditSummaries,
  applyAuditAllowlist,
  AUDIT_WORKSPACES,
  auditWorkspace,
  formatAuditLine,
  loadAuditAllowlist,
  parseAuditAllowlist,
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

// ── time-boxed advisory exceptions ──────────────────────────────────────────

const BRACES_ID = 'GHSA-vfj7-8cjw-p6xm';
const TODAY = '2026-10-05';

const exceptionEntry = (overrides = {}) => ({
  id: BRACES_ID,
  package: 'braces',
  reason: 'No patched release exists and the package is only reached through dev tooling.',
  removeWhen: 'braces publishes a patched release or the dependency chain is removed.',
  added: '2026-10-05',
  expires: '2026-12-01',
  ...overrides,
});

const allowlistOf = (...entries) => parseAuditAllowlist({ advisories: entries });

const advisory = (id, name, severity = 'high') => ({
  source: 1,
  name,
  dependency: name,
  title: `${name} advisory`,
  url: `https://github.com/advisories/${id}`,
  severity,
  range: '*',
});

// The shape npm audit --json (auditReportVersion 2) reports for the real braces chain.
const bracesChain = () => ({
  braces: { name: 'braces', severity: 'high', isDirect: false, via: [advisory(BRACES_ID, 'braces')] },
  micromatch: { name: 'micromatch', severity: 'high', isDirect: false, via: ['braces'] },
  'fast-glob': { name: 'fast-glob', severity: 'high', isDirect: false, via: ['micromatch'] },
  tailwindcss: { name: 'tailwindcss', severity: 'high', isDirect: true, via: ['micromatch', 'fast-glob'] },
});

const reportOf = (vulnerabilities) => {
  const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };
  for (const { severity } of Object.values(vulnerabilities)) counts[severity] += 1;
  return { auditReportVersion: 2, vulnerabilities, metadata: { vulnerabilities: counts } };
};

test('the committed exception list parses and every entry carries a reason and an exit condition', () => {
  const entries = loadAuditAllowlist();

  assert.ok(entries.length >= 1);
  for (const entry of entries) {
    assert.match(entry.id, /^GHSA(-[a-z0-9]{4}){3}$/);
    assert.ok(entry.package && entry.reason && entry.removeWhen);
    assert.ok(entry.expires >= entry.added);
  }
});

test('the exception list rejects entries that are not narrow, explained and time-boxed', () => {
  const rejects = (entry, pattern) => assert.throws(() => allowlistOf(entry), pattern);

  assert.throws(() => parseAuditAllowlist({}), /advisories/);
  assert.throws(() => parseAuditAllowlist({ advisories: 'braces' }), /advisories/);
  rejects(exceptionEntry({ id: 'CVE-2026-93687' }), /GitHub advisory id/);
  rejects(exceptionEntry({ id: 'ghsa-vfj7-8cjw-p6xm' }), /GitHub advisory id/);
  rejects(exceptionEntry({ package: '' }), /package/);
  rejects(exceptionEntry({ reason: 'too short' }), /reason/);
  rejects(exceptionEntry({ removeWhen: undefined }), /removeWhen/);
  rejects(exceptionEntry({ expires: '2026-02-31' }), /YYYY-MM-DD/);
  rejects(exceptionEntry({ expires: 'soon' }), /YYYY-MM-DD/);
  rejects(exceptionEntry({ added: '2026-10-05', expires: '2026-10-04' }), /before/);
  rejects(exceptionEntry({ added: '2026-10-05', expires: '2027-01-04' }), /within 90 days/);
  assert.equal(allowlistOf(exceptionEntry({ expires: '2027-01-03' })).length, 1);
  assert.throws(() => allowlistOf(exceptionEntry(), exceptionEntry()), /listed twice/);
});

test('an exception removes the vulnerabilities that trace back to its advisory and nothing else', () => {
  const report = reportOf(bracesChain());
  const result = applyAuditAllowlist(report, allowlistOf(exceptionEntry()), { today: TODAY });

  assert.equal(result.raw.high, 4);
  assert.equal(result.summary.high, 0);
  assert.deepEqual(result.excluded.map((item) => item.name).sort(),
    ['braces', 'fast-glob', 'micromatch', 'tailwindcss']);
  assert.deepEqual(result.matched, [BRACES_ID]);
});

test('another advisory in the same chain still fails the gate', () => {
  const chain = bracesChain();
  chain.micromatch.via.push(advisory('GHSA-aaaa-bbbb-cccc', 'micromatch'));
  chain.undici = { name: 'undici', severity: 'high', isDirect: false, via: [advisory('GHSA-dddd-eeee-ffff', 'undici')] };
  const result = applyAuditAllowlist(reportOf(chain), allowlistOf(exceptionEntry()), { today: TODAY });

  // braces stays exempt. micromatch has a second advisory, so it and everything built on it count.
  assert.deepEqual(result.excluded.map((item) => item.name), ['braces']);
  assert.equal(result.summary.high, 4);
});

test('an exception covers only the package it names', () => {
  const chain = bracesChain();
  chain.braces.via = [advisory(BRACES_ID, 'some-other-package')];
  const result = applyAuditAllowlist(reportOf(chain), allowlistOf(exceptionEntry()), { today: TODAY });

  assert.equal(result.excluded.length, 0);
  assert.equal(result.summary.high, 4);
});

test('a different advisory on the same package is not covered by the exception', () => {
  const chain = bracesChain();
  chain.braces.via.push(advisory('GHSA-zzzz-yyyy-xxxx', 'braces'));
  const result = applyAuditAllowlist(reportOf(chain), allowlistOf(exceptionEntry()), { today: TODAY });

  assert.equal(result.excluded.length, 0);
  assert.equal(result.summary.high, 4);
});

test('packages that only point at each other are never excluded', () => {
  const report = reportOf({
    one: { name: 'one', severity: 'high', via: ['two'] },
    two: { name: 'two', severity: 'high', via: ['one'] },
  });
  const result = applyAuditAllowlist(report, allowlistOf(exceptionEntry()), { today: TODAY });

  assert.equal(result.excluded.length, 0);
  assert.equal(result.summary.high, 2);
});

test('an exception applies through its last day and stops applying after it', () => {
  const report = reportOf(bracesChain());
  const entries = allowlistOf(exceptionEntry());

  assert.equal(applyAuditAllowlist(report, entries, { today: '2026-12-01' }).summary.high, 0);
  const lapsed = applyAuditAllowlist(report, entries, { today: '2026-12-02' });
  assert.equal(lapsed.summary.high, 4);
  assert.equal(lapsed.excluded.length, 0);
  assert.deepEqual(lapsed.expired.map((entry) => entry.id), [BRACES_ID]);
});

test('without per-vulnerability detail an exception cannot hide anything', () => {
  const summaryOnly = { metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 5, critical: 0 } } };

  assert.equal(applyAuditAllowlist(summaryOnly, allowlistOf(exceptionEntry()), { today: TODAY }).summary.high, 5);
});

test('a summary that disagrees with the detail can only tighten the gate', () => {
  const report = reportOf(bracesChain());
  report.metadata.vulnerabilities.high = 6;
  const result = applyAuditAllowlist(report, allowlistOf(exceptionEntry()), { today: TODAY });

  assert.equal(result.summary.high, 2);
});

test('the gate passes on exempt findings, names the exception, and still gates everything else', () => {
  const run = (report, allowlist) => auditWorkspace(AUDIT_WORKSPACES[1], {
    spawn: () => ({ status: 1, stdout: JSON.stringify(report), stderr: '' }),
    allowlist,
    today: TODAY,
  });

  const passed = run(reportOf(bracesChain()), allowlistOf(exceptionEntry()));
  assert.equal(passed.gatePassed, true);
  assert.equal(passed.outcome, 'passed');
  assert.equal(passed.rawSummary.high, 4);
  assert.equal(passed.summary.high, 0);
  assert.match(formatAuditLine(passed),
    /^✓ extension: 0 critical, 0 high, 0 moderate, 0 low \(not counted: 4 high under exception GHSA-vfj7-8cjw-p6xm\)$/);

  assert.equal(run(reportOf(bracesChain()), []).outcome, 'vulnerable');
  const withOtherHigh = bracesChain();
  withOtherHigh.undici = { name: 'undici', severity: 'high', via: [advisory('GHSA-dddd-eeee-ffff', 'undici')] };
  const blocked = run(reportOf(withOtherHigh), allowlistOf(exceptionEntry()));
  assert.equal(blocked.outcome, 'vulnerable');
  assert.match(formatAuditLine(blocked), /^✗ extension: 0 critical, 1 high/);
});

test('an npm failure with no high or critical finding is still an invocation error under an exception', () => {
  const clean = { metadata: { vulnerabilities: { info: 0, low: 0, moderate: 1, high: 0, critical: 0 } } };

  assert.throws(() => auditWorkspace(AUDIT_WORKSPACES[0], {
    spawn: () => ({ status: 1, stdout: JSON.stringify(clean), stderr: 'registry unreachable' }),
    allowlist: allowlistOf(exceptionEntry()),
    today: TODAY,
  }), /failed without a high\/critical finding/);
});

test('every package root receives the exception list', () => {
  const results = runWorkspaceAudits({
    spawn: () => ({ status: 1, stdout: JSON.stringify(reportOf(bracesChain())), stderr: '' }),
    allowlist: allowlistOf(exceptionEntry()),
    today: TODAY,
  });

  assert.deepEqual(results.map((result) => result.outcome), ['passed', 'passed', 'passed', 'passed']);
  assert.equal(aggregateAuditResults(results).totals.high, 0);
});
