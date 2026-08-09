import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';

import {
  aggregateAuditResults,
  aggregateAuditSummaries,
  AUDIT_WORKSPACES,
  auditWorkspace,
  formatAuditLine,
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
