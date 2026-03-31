import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const checkoutUrl = pathToFileURL(
  path.resolve(process.cwd(), 'prompt-lab-source/api/billing/checkout.js'),
).href;
const licenseUrl = pathToFileURL(
  path.resolve(process.cwd(), 'prompt-lab-source/api/billing/license.js'),
).href;
const portalUrl = pathToFileURL(
  path.resolve(process.cwd(), 'prompt-lab-source/api/billing/portal.js'),
).href;

const ORIGINAL_FETCH = globalThis.fetch;
const ENV_KEYS = [
  'LEMON_SQUEEZY_API_KEY',
  'LEMON_SQUEEZY_STORE_ID',
  'LEMON_SQUEEZY_MONTHLY_VARIANT_ID',
  'LEMON_SQUEEZY_YEARLY_VARIANT_ID',
  'LEMON_SQUEEZY_REDIRECT_URL',
  'LEMON_SQUEEZY_STORE_URL',
  'LEMON_SQUEEZY_PORTAL_URL',
  'LEMON_SQUEEZY_TEST_MODE',
];
const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function resetEnv() {
  for (const key of ENV_KEYS) {
    if (typeof ORIGINAL_ENV[key] === 'undefined') {
      delete process.env[key];
    } else {
      process.env[key] = ORIGINAL_ENV[key];
    }
  }
}

async function loadHandler(moduleUrl) {
  const mod = await import(`${moduleUrl}?t=${Date.now()}-${Math.random()}`);
  return mod.default;
}

test.afterEach(() => {
  resetEnv();
  globalThis.fetch = ORIGINAL_FETCH;
});

test('billing checkout creates a Lemon checkout for the requested plan', async () => {
  process.env.LEMON_SQUEEZY_API_KEY = 'lsq-key';
  process.env.LEMON_SQUEEZY_STORE_ID = '123';
  process.env.LEMON_SQUEEZY_MONTHLY_VARIANT_ID = '456';
  process.env.LEMON_SQUEEZY_YEARLY_VARIANT_ID = '789';
  process.env.LEMON_SQUEEZY_REDIRECT_URL = 'https://promptlab.tools/app/';

  const captured = [];
  globalThis.fetch = async (_url, init) => {
    captured.push(JSON.parse(init.body));
    return new Response(JSON.stringify({
      data: {
        attributes: {
          url: 'https://checkout.example/monthly',
        },
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const handler = await loadHandler(checkoutUrl);
  const response = await handler(new Request('https://promptlab.tools/api/billing/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      period: 'monthly',
      email: 'user@example.com',
      source: 'upgrade-modal',
    }),
  }));

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.url, 'https://checkout.example/monthly');
  assert.equal(captured[0].data.relationships.variant.data.id, '456');
  assert.equal(captured[0].data.attributes.checkout_data.email, 'user@example.com');
  assert.equal(captured[0].data.attributes.checkout_data.custom.plan, 'monthly');
});

test('billing license validates only configured Prompt Lab variants', async () => {
  process.env.LEMON_SQUEEZY_MONTHLY_VARIANT_ID = '456';
  process.env.LEMON_SQUEEZY_YEARLY_VARIANT_ID = '789';
  process.env.LEMON_SQUEEZY_STORE_URL = 'https://promptlab.lemonsqueezy.com';

  globalThis.fetch = async () => new Response(JSON.stringify({
    valid: true,
    error: null,
    license_key: {
      status: 'active',
      key: 'license-123',
    },
    instance: {
      id: 'instance-1',
      name: 'prompt-lab-web',
    },
    meta: {
      product_name: 'Prompt Lab Pro',
      variant_id: 456,
      customer_email: 'user@example.com',
      customer_name: 'Prompt Lab User',
    },
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  const handler = await loadHandler(licenseUrl);
  const response = await handler(new Request('https://promptlab.tools/api/billing/license', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'validate',
      licenseKey: 'license-123',
      instanceId: 'instance-1',
    }),
  }));

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.plan, 'pro');
  assert.equal(payload.billingPeriod, 'monthly');
  assert.equal(payload.manageUrl, 'https://promptlab.lemonsqueezy.com/billing');
});

test('billing license rejects a key from an unrelated Lemon variant', async () => {
  process.env.LEMON_SQUEEZY_MONTHLY_VARIANT_ID = '456';
  process.env.LEMON_SQUEEZY_YEARLY_VARIANT_ID = '789';

  globalThis.fetch = async () => new Response(JSON.stringify({
    valid: true,
    error: null,
    license_key: {
      status: 'active',
      key: 'license-123',
    },
    instance: null,
    meta: {
      product_name: 'Other App',
      variant_id: 999,
      customer_email: 'user@example.com',
    },
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  const handler = await loadHandler(licenseUrl);
  const response = await handler(new Request('https://promptlab.tools/api/billing/license', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'validate',
      licenseKey: 'license-123',
    }),
  }));

  assert.equal(response.status, 403);
  assert.match(await response.text(), /does not match the configured Prompt Lab Pro plans/i);
});

test('billing portal returns the configured portal url', async () => {
  process.env.LEMON_SQUEEZY_PORTAL_URL = 'https://billing.promptlab.tools';
  const handler = await loadHandler(portalUrl);
  const response = await handler(new Request('https://promptlab.tools/api/billing/portal'));

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.url, 'https://billing.promptlab.tools');
});
