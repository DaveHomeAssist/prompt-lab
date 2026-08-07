#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const sourceDir = resolve(scriptDir, '..');
const defaultPackages = [
  'prompt-lab-web',
  'prompt-lab-extension',
  'prompt-lab-desktop',
];

const routerException = {
  advisoryUrl: 'https://github.com/advisories/GHSA-qwww-vcr4-c8h2',
  upstreamFixUrl: 'https://github.com/remix-run/react-router/pull/15353',
  packages: new Set(['react-router', 'react-router-dom']),
  minimumPatchedVersion: [7, 18, 2],
  expiresAt: new Date('2026-10-01T00:00:00Z'),
};

function parseVersion(version) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version || '');
  return match ? match.slice(1).map(Number) : undefined;
}

function isPatchedRouterV7(version) {
  const parsed = parseVersion(version);
  if (!parsed || parsed[0] !== 7) return false;

  for (let index = 0; index < parsed.length; index += 1) {
    if (parsed[index] > routerException.minimumPatchedVersion[index]) return true;
    if (parsed[index] < routerException.minimumPatchedVersion[index]) return false;
  }
  return true;
}

function inspectAdvisoryGraph(vulnerabilities, packageName, path = new Set()) {
  const failures = [];
  const urls = [];
  if (path.has(packageName)) {
    return { urls, failures: [`npm audit contains a cyclic via reference at ${packageName}`] };
  }
  const vulnerability = vulnerabilities[packageName];
  if (!vulnerability || !Array.isArray(vulnerability.via) || vulnerability.via.length === 0) {
    return { urls, failures: [`npm audit has no valid via entries for ${packageName}`] };
  }

  const nextPath = new Set(path).add(packageName);
  for (const entry of vulnerability.via) {
    if (typeof entry === 'string') {
      if (!Object.hasOwn(vulnerabilities, entry)) {
        failures.push(`npm audit has an unresolved via reference from ${packageName} to ${entry}`);
        continue;
      }
      const nested = inspectAdvisoryGraph(vulnerabilities, entry, nextPath);
      urls.push(...nested.urls);
      failures.push(...nested.failures);
      continue;
    }

    if (!entry || typeof entry !== 'object' || typeof entry.url !== 'string' || entry.url.length === 0) {
      failures.push(`npm audit has a malformed via entry for ${packageName}`);
      continue;
    }
    urls.push(entry.url);
  }

  return { urls, failures };
}

export function validateAuditExit(result, report) {
  if (result.signal || ![0, 1].includes(result.status)) {
    return `npm audit exited unexpectedly (status ${String(result.status)}, signal ${String(result.signal)})`;
  }

  const hasVulnerabilities = Object.keys(report?.vulnerabilities || {}).length > 0;
  const expectedStatus = hasVulnerabilities ? 1 : 0;
  return result.status === expectedStatus
    ? undefined
    : `npm audit status ${result.status} does not match the report contents`;
}

export function evaluateAuditReport(report, lockfile, now = new Date()) {
  const failures = [];
  const exceptions = [];
  const vulnerabilities = report?.vulnerabilities;

  if (
    report?.auditReportVersion !== 2
    || !vulnerabilities
    || typeof vulnerabilities !== 'object'
    || Array.isArray(vulnerabilities)
  ) {
    return { ok: false, failures: ['npm returned a malformed audit report'], exceptions };
  }

  const names = Object.keys(vulnerabilities);
  const reportedTotal = report?.metadata?.vulnerabilities?.total;
  if (!Number.isInteger(reportedTotal) || reportedTotal !== names.length) {
    return { ok: false, failures: ['npm audit vulnerability totals are missing or inconsistent'], exceptions };
  }
  if (names.length === 0) return { ok: true, failures, exceptions };

  const unexpectedPackages = names.filter((name) => !routerException.packages.has(name));
  if (unexpectedPackages.length > 0) {
    failures.push(`unexpected vulnerable packages: ${unexpectedPackages.join(', ')}`);
  }

  const routerFindings = names.filter((name) => routerException.packages.has(name));
  if (routerFindings.length > 0) {
    if (now >= routerException.expiresAt) {
      failures.push('React Router audit exception expired on 2026-10-01');
    }

    for (const packageName of routerException.packages) {
      const version = lockfile?.packages?.[`node_modules/${packageName}`]?.version;
      if (!isPatchedRouterV7(version)) {
        failures.push(`${packageName} must resolve to patched v7.18.2 or newer within v7 (found ${version || 'missing'})`);
      }
    }

    const advisoryGraphs = routerFindings.map((name) => (
      inspectAdvisoryGraph(vulnerabilities, name)
    ));
    failures.push(...advisoryGraphs.flatMap((graph) => graph.failures));
    const urls = new Set(advisoryGraphs.flatMap((graph) => graph.urls));
    if (urls.size !== 1 || !urls.has(routerException.advisoryUrl)) {
      failures.push(`React Router findings are not limited to ${routerException.advisoryUrl}`);
    }

    if (failures.length === 0) {
      exceptions.push(
        `GHSA-qwww-vcr4-c8h2 is patched by the upstream v7.18.2 backport ${routerException.upstreamFixUrl}; npm advisory metadata still flags v7`,
      );
    }
  }

  return { ok: failures.length === 0, failures, exceptions };
}

function auditPackage(packageName) {
  const packageDir = join(sourceDir, packageName);
  const lockfilePath = join(packageDir, 'package-lock.json');
  let lockfile;

  try {
    lockfile = JSON.parse(readFileSync(lockfilePath, 'utf8'));
  } catch (error) {
    return { ok: false, failures: [`could not read ${lockfilePath}: ${error.message}`], exceptions: [] };
  }

  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npmCommand, ['audit', '--json', '--package-lock-only'], {
    cwd: packageDir,
    encoding: 'utf8',
    timeout: 120_000,
  });

  if (result.error) {
    return { ok: false, failures: [`npm audit failed to run: ${result.error.message}`], exceptions: [] };
  }

  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    const detail = (result.stderr || result.stdout || 'no output').trim().slice(-500);
    return { ok: false, failures: [`npm audit did not return JSON: ${detail}`], exceptions: [] };
  }

  const exitFailure = validateAuditExit(result, report);
  if (exitFailure) {
    return { ok: false, failures: [exitFailure], exceptions: [] };
  }

  return evaluateAuditReport(report, lockfile);
}

function main() {
  const packageNames = process.argv.slice(2);
  const targets = packageNames.length > 0 ? packageNames : defaultPackages;
  let failed = false;

  for (const packageName of targets) {
    const result = auditPackage(packageName);
    if (result.ok) {
      console.log(`PASS ${packageName}: dependency audit accepted`);
      for (const exception of result.exceptions) console.log(`  EXCEPTION ${exception}`);
      continue;
    }

    failed = true;
    console.error(`FAIL ${packageName}:`);
    for (const failure of result.failures) console.error(`  ${failure}`);
  }

  if (failed) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
