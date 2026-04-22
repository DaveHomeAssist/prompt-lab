import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const sourceDir = path.resolve(testDir, '..');
const moduleUrl = pathToFileURL(path.join(sourceDir, 'api', '_lib', 'clerkBillingAuth.js')).href;
const ENV_KEYS = [
  'CLERK_SECRET_KEY',
  'PROMPTLAB_BILLING_TIMEOUT_MS',
];
const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

async function loadModule() {
  return import(`${moduleUrl}?t=${Date.now()}-${Math.random()}`);
}

function resetEnv() {
  for (const key of ENV_KEYS) {
    if (typeof ORIGINAL_ENV[key] === 'undefined') {
      delete process.env[key];
    } else {
      process.env[key] = ORIGINAL_ENV[key];
    }
  }
}

test.afterEach(() => {
  resetEnv();
});

test('resolveClerkBillingIdentity returns signed-out state without a bearer token', async () => {
  const { resolveClerkBillingIdentity } = await loadModule();
  const result = await resolveClerkBillingIdentity(new Request('https://promptlab.tools/api/billing/license', {
    method: 'POST',
  }));

  assert.equal(result.hasBearerToken, false);
  assert.equal(result.isAuthenticated, false);
  assert.equal(result.userId, '');
  assert.equal(result.customerEmail, '');
});

test('resolveClerkBillingIdentity verifies the Clerk token and loads the primary email', async () => {
  const { buildAuthorizedParties, resolveClerkBillingIdentity } = await loadModule();
  process.env.CLERK_SECRET_KEY = 'sk_test_123';

  const request = new Request('https://promptlab.tools/api/billing/checkout', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer token_123',
      Origin: 'https://promptlab.tools',
    },
  });

  let verifiedOptions = null;
  const result = await resolveClerkBillingIdentity(request, {
    verifyTokenFn: async (_token, options) => {
      verifiedOptions = options;
      return { sub: 'user_123' };
    },
    fetchUserFn: async (userId) => ({
      id: userId,
      primaryEmailAddressId: 'email_primary',
      emailAddresses: [
        { id: 'email_primary', emailAddress: 'user@example.com' },
      ],
    }),
  });

  assert.equal(result.hasBearerToken, true);
  assert.equal(result.isAuthenticated, true);
  assert.equal(result.userId, 'user_123');
  assert.equal(result.customerEmail, 'user@example.com');
  assert.ok(Array.isArray(verifiedOptions.authorizedParties));
  assert.ok(verifiedOptions.authorizedParties.includes('https://promptlab.tools'));
  assert.deepEqual(buildAuthorizedParties(request).sort(), verifiedOptions.authorizedParties.sort());
});

test('buildAuthorizedParties ignores caller supplied origins and keeps an explicit allowlist', async () => {
  const { buildAuthorizedParties } = await loadModule();

  const request = new Request('https://promptlab.tools/api/billing/checkout', {
    method: 'POST',
    headers: {
      Origin: 'https://evil.promptlab.tools',
      Referer: 'https://evil.promptlab.tools/app/',
    },
  });

  assert.deepEqual(buildAuthorizedParties(request, {
    authorizedParties: ['https://staging.promptlab.tools'],
  }).sort(), [
    'https://promptlab.tools',
    'https://staging.promptlab.tools',
  ].sort());
});

test('resolveClerkBillingIdentity reports invalid bearer tokens cleanly', async () => {
  const { resolveClerkBillingIdentity } = await loadModule();
  process.env.CLERK_SECRET_KEY = 'sk_test_123';

  const result = await resolveClerkBillingIdentity(new Request('https://promptlab.tools/api/billing/checkout', {
    method: 'POST',
    headers: { Authorization: 'Bearer invalid' },
  }), {
    verifyTokenFn: async () => {
      throw new Error('Token not verified.');
    },
  });

  assert.equal(result.hasBearerToken, true);
  assert.equal(result.isAuthenticated, false);
  assert.match(result.error.message, /Token not verified/i);
});

test('resolveClerkBillingIdentity times out slow Clerk verification', async () => {
  const { resolveClerkBillingIdentity } = await loadModule();
  process.env.CLERK_SECRET_KEY = 'sk_test_123';
  process.env.PROMPTLAB_BILLING_TIMEOUT_MS = '25';

  const result = await resolveClerkBillingIdentity(new Request('https://promptlab.tools/api/billing/checkout', {
    method: 'POST',
    headers: { Authorization: 'Bearer slow-token' },
  }), {
    verifyTokenFn: async () => new Promise(() => {}),
  });

  assert.equal(result.hasBearerToken, true);
  assert.equal(result.isAuthenticated, false);
  assert.match(result.error.message, /timed out/i);
});
