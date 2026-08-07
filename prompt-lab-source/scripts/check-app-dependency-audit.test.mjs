import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateAuditReport, validateAuditExit } from './check-app-dependency-audit.mjs';

const patchedLockfile = {
  packages: {
    'node_modules/react-router': { version: '7.18.2' },
    'node_modules/react-router-dom': { version: '7.18.2' },
  },
};

const staleRouterReport = {
  auditReportVersion: 2,
  metadata: { vulnerabilities: { total: 2 } },
  vulnerabilities: {
    'react-router': {
      via: [{ url: 'https://github.com/advisories/GHSA-qwww-vcr4-c8h2' }],
    },
    'react-router-dom': {
      via: ['react-router'],
    },
  },
};

test('passes a clean npm audit report', () => {
  const result = evaluateAuditReport({
    auditReportVersion: 2,
    metadata: { vulnerabilities: { total: 0 } },
    vulnerabilities: {},
  }, {});
  assert.equal(result.ok, true);
  assert.deepEqual(result.exceptions, []);
});

test('accepts only the stale Router advisory when patched v7 is installed', () => {
  const result = evaluateAuditReport(
    staleRouterReport,
    patchedLockfile,
    new Date('2026-08-06T00:00:00Z'),
  );
  assert.equal(result.ok, true);
  assert.equal(result.exceptions.length, 1);
});

test('rejects the Router advisory when either package is below the patched floor', () => {
  const result = evaluateAuditReport(staleRouterReport, {
    packages: {
      'node_modules/react-router': { version: '7.18.1' },
      'node_modules/react-router-dom': { version: '7.18.2' },
    },
  }, new Date('2026-08-06T00:00:00Z'));
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /react-router must resolve/);
});

test('rejects prerelease and malformed Router version strings', () => {
  for (const version of ['7.18.2-pre.0', '7.18.2garbage', '7.018.002']) {
    const result = evaluateAuditReport(staleRouterReport, {
      packages: {
        'node_modules/react-router': { version },
        'node_modules/react-router-dom': { version: '7.18.2' },
      },
    }, new Date('2026-08-06T00:00:00Z'));
    assert.equal(result.ok, false);
    assert.match(result.failures.join('\n'), /react-router must resolve/);
  }
});

test('rejects every additional advisory', () => {
  const result = evaluateAuditReport({
    ...staleRouterReport,
    metadata: { vulnerabilities: { total: 3 } },
    vulnerabilities: {
      ...staleRouterReport.vulnerabilities,
      vite: { via: [{ url: 'https://example.test/unexpected' }] },
    },
  }, patchedLockfile, new Date('2026-08-06T00:00:00Z'));
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /unexpected vulnerable packages: vite/);
});

test('expires the narrow Router exception', () => {
  const result = evaluateAuditReport(
    staleRouterReport,
    patchedLockfile,
    new Date('2026-10-01T00:00:00Z'),
  );
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /exception expired/);
});

test('fails closed on malformed npm output', () => {
  const result = evaluateAuditReport({}, patchedLockfile);
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /malformed audit report/);
});

test('fails closed when npm vulnerability totals are inconsistent', () => {
  const result = evaluateAuditReport({
    ...staleRouterReport,
    metadata: { vulnerabilities: { total: 1 } },
  }, patchedLockfile);
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /totals are missing or inconsistent/);
});

test('fails closed on malformed or unresolved audit graph entries', () => {
  for (const via of [
    [{ url: 'https://github.com/advisories/GHSA-qwww-vcr4-c8h2' }, {}],
    [{ url: 'https://github.com/advisories/GHSA-qwww-vcr4-c8h2' }, 'missing-package'],
  ]) {
    const result = evaluateAuditReport({
      ...staleRouterReport,
      vulnerabilities: {
        ...staleRouterReport.vulnerabilities,
        'react-router': { via },
      },
    }, patchedLockfile, new Date('2026-08-06T00:00:00Z'));
    assert.equal(result.ok, false);
    assert.match(result.failures.join('\n'), /malformed via entry|unresolved via reference/);
  }
});

test('requires npm audit status to match a clean or vulnerable report', () => {
  const cleanReport = {
    auditReportVersion: 2,
    metadata: { vulnerabilities: { total: 0 } },
    vulnerabilities: {},
  };
  assert.equal(validateAuditExit({ status: 0, signal: null }, cleanReport), undefined);
  assert.equal(validateAuditExit({ status: 1, signal: null }, staleRouterReport), undefined);
  assert.match(validateAuditExit({ status: 2, signal: null }, cleanReport), /exited unexpectedly/);
  assert.match(validateAuditExit({ status: 0, signal: 'SIGTERM' }, cleanReport), /exited unexpectedly/);
  assert.match(validateAuditExit({ status: 1, signal: null }, cleanReport), /does not match/);
});
