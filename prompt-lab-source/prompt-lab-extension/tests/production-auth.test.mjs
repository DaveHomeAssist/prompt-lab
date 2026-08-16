import assert from 'node:assert/strict';
import test from 'node:test';

import {
  forbiddenRequestCategory,
  isProductionLicenseResponse,
  readProductionFreeSmokeConfig,
} from '../e2e/production-auth.mjs';

test('production Free smoke accepts only the dedicated production account configuration', () => {
  const config = readProductionFreeSmokeConfig({
    CLERK_SECRET_KEY: 'sk_test_redacted',
    PROMPTLAB_QA_FREE_USER_ID: 'user_qa123',
  });

  assert.equal(config.appUrl.href, 'https://promptlab.tools/app/');
  assert.equal(config.clerkUserId, 'user_qa123');
  assert.equal(config.clerkSecretKey, 'sk_test_redacted');
});

test('production Free smoke rejects missing credentials and non-production targets', () => {
  assert.throws(
    () => readProductionFreeSmokeConfig({ PROMPTLAB_QA_FREE_USER_ID: 'user_qa123' }),
    /CLERK_SECRET_KEY must be configured/,
  );
  assert.throws(
    () => readProductionFreeSmokeConfig({
      CLERK_SECRET_KEY: 'sk_test_redacted',
      PROMPTLAB_QA_FREE_USER_ID: 'owner@example.com',
    }),
    /must be a Clerk user ID/,
  );
  assert.throws(
    () => readProductionFreeSmokeConfig({
      CLERK_SECRET_KEY: 'sk_test_redacted',
      PROMPTLAB_QA_FREE_USER_ID: 'user_qa123',
      PROMPT_LAB_PRODUCTION_URL: 'https://preview.example.com/app/',
    }),
    /must be exactly https:\/\/promptlab\.tools\/app\//,
  );
});

test('production Free smoke blocks only side effects outside the read-only license check', () => {
  assert.equal(forbiddenRequestCategory('https://promptlab.tools/api/billing/license'), null);
  assert.equal(forbiddenRequestCategory('https://promptlab.tools/api/billing/checkout'), 'billing');
  assert.equal(forbiddenRequestCategory('https://promptlab.tools/api/billing/portal'), 'billing');
  assert.equal(forbiddenRequestCategory('https://api.stripe.com/v1/checkout/sessions'), 'Stripe');
  assert.equal(forbiddenRequestCategory('https://api.anthropic.com/v1/messages'), 'provider');
  assert.equal(forbiddenRequestCategory('https://promptlab.tools/api/telemetry'), 'telemetry');
});

test('production Free smoke recognizes only the live billing license endpoint', () => {
  assert.equal(isProductionLicenseResponse('https://promptlab.tools/api/billing/license', 'https://promptlab.tools'), true);
  assert.equal(isProductionLicenseResponse('https://promptlab.tools/api/billing/checkout', 'https://promptlab.tools'), false);
  assert.equal(isProductionLicenseResponse('https://preview.promptlab.tools/api/billing/license', 'https://promptlab.tools'), false);
});
