import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(new URL('../prompt-lab-web/scripts/check-production-env.mjs', import.meta.url));
const cleanEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => ![
    'NODE_ENV',
    'VERCEL_ENV',
    'VITE_CLERK_PUBLISHABLE_KEY',
  ].includes(key)),
);

function runCheck(overrides = {}) {
  return spawnSync(process.execPath, [scriptPath], {
    encoding: 'utf8',
    env: { ...cleanEnvironment, ...overrides },
  });
}

test('web auth environment check allows local development without Clerk', () => {
  const result = runCheck();
  assert.equal(result.status, 0, result.stderr);
});

for (const environment of [
  { NODE_ENV: 'production' },
  { VERCEL_ENV: 'preview' },
  { VERCEL_ENV: 'production' },
]) {
  test(`web auth environment check rejects a keyless ${JSON.stringify(environment)} release`, () => {
    const result = runCheck(environment);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /VITE_CLERK_PUBLISHABLE_KEY is required/);
  });
}

test('web auth environment check accepts Clerk-configured Vercel releases', () => {
  const result = runCheck({
    VERCEL_ENV: 'preview',
    VITE_CLERK_PUBLISHABLE_KEY: 'pk_test_example',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /pk_test_example/);
});
