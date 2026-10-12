import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertIsolated, runLifecycle, testCredentials } from '../scripts/stripe-test-lifecycle.mjs';

const env = { PROMPTLAB_STRIPE_TEST_RUN: 'true', STRIPE_TEST_ACCOUNT_ID: 'acct_test', STRIPE_TEST_SECRET_KEY: 'rk_test_fixture' };

test('lifecycle refuses live credentials and missing opt-in before contacting Stripe', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('Unexpected network request'); };
  try {
    for (const key of ['sk_live_fixture', 'rk_live_fixture', '', 'sk_test_']) {
      await assert.rejects(runLifecycle({ ...env, STRIPE_TEST_SECRET_KEY: key }), /test key/);
    }
    await assert.rejects(runLifecycle({ ...env, PROMPTLAB_STRIPE_TEST_RUN: '' }), /opt-in/);
    assert.deepEqual(testCredentials(env), { key: 'rk_test_fixture', accountId: 'acct_test' });
  } finally { globalThis.fetch = originalFetch; }
});

test('lifecycle refuses wrong account, live mode, unknown or enabled webhook destinations', () => {
  const account = { id: 'acct_test' };
  const balance = { livemode: false };
  const empty = { data: [], has_more: false };
  assert.doesNotThrow(() => assertIsolated(account, balance, empty, 'acct_test'));
  assert.throws(() => assertIsolated(account, balance, empty, 'acct_other'), /Wrong Stripe account/);
  assert.throws(() => assertIsolated(account, { livemode: true }, empty, 'acct_test'), /test mode/);
  assert.throws(() => assertIsolated(account, balance, { ...empty, has_more: true }, 'acct_test'), /Incomplete/);
  assert.throws(() => assertIsolated(account, balance, { ...empty, data: [{}] }, 'acct_test'), /destinations/);
  assert.throws(() => assertIsolated(account, balance, { ...empty, data: [{ status: 'enabled' }] }, 'acct_test'), /destinations/);
});
