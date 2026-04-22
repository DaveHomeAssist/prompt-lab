import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const sourceDir = path.resolve(testDir, '..');

function billingModuleUrl(fileName) {
  return pathToFileURL(path.join(sourceDir, 'api', 'billing', fileName)).href;
}

const checkoutUrl = billingModuleUrl('checkout.js');
const licenseUrl = billingModuleUrl('license.js');
const portalUrl = billingModuleUrl('portal.js');
const controlsUrl = pathToFileURL(path.join(sourceDir, 'api', '_lib', 'billingControls.js')).href;

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_CONSOLE_INFO = console.info;
const ORIGINAL_CONSOLE_WARN = console.warn;
const ENV_KEYS = [
  'STRIPE_SECRET_KEY',
  'STRIPE_MONTHLY_PRICE_ID',
  'STRIPE_YEARLY_PRICE_ID',
  'STRIPE_CHECKOUT_SUCCESS_URL',
  'STRIPE_CHECKOUT_CANCEL_URL',
  'STRIPE_PORTAL_RETURN_URL',
  'PROMPTLAB_BILLING_TIMEOUT_MS',
  'BILLING_ENABLED',
  'BILLING_CHECKOUT_USER_LIMIT_PER_MIN',
  'BILLING_LICENSE_GLOBAL_LIMIT_PER_MIN',
  'BILLING_LICENSE_USER_LIMIT_PER_MIN',
  'BILLING_PORTAL_USER_LIMIT_PER_MIN',
  'BILLING_CIRCUIT_OPEN_ROUTES',
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
  return import(`${moduleUrl}?t=${Date.now()}-${Math.random()}`);
}

async function loadBillingControls() {
  return import(controlsUrl);
}

function createAuthenticatedIdentity(overrides = {}) {
  return {
    hasBearerToken: true,
    isAuthenticated: true,
    userId: 'user_123',
    customerEmail: 'user@example.com',
    ...overrides,
  };
}

test.afterEach(async () => {
  resetEnv();
  const controls = await loadBillingControls();
  controls.resetBillingControlState();
  globalThis.fetch = ORIGINAL_FETCH;
  console.info = ORIGINAL_CONSOLE_INFO;
  console.warn = ORIGINAL_CONSOLE_WARN;
});

test('billing checkout creates a Stripe checkout for the requested plan', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_123';
  process.env.STRIPE_MONTHLY_PRICE_ID = 'price_monthly';
  process.env.STRIPE_YEARLY_PRICE_ID = 'price_yearly';
  process.env.STRIPE_CHECKOUT_SUCCESS_URL = 'https://promptlab.tools/app/?billing=success';
  process.env.STRIPE_CHECKOUT_CANCEL_URL = 'https://promptlab.tools/app/?billing=cancelled';

  const captured = [];
  globalThis.fetch = async (_url, init) => {
    captured.push(new URLSearchParams(init.body));
    return new Response(JSON.stringify({
      id: 'cs_test_123',
      url: 'https://checkout.stripe.com/c/pay/cs_test_123',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const { createCheckoutHandler } = await loadHandler(checkoutUrl);
  const handler = createCheckoutHandler({
    resolveIdentity: async () => createAuthenticatedIdentity(),
  });
  const response = await handler(new Request('https://promptlab.tools/api/billing/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      period: 'monthly',
      source: 'upgrade-modal',
    }),
  }));

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.url, 'https://checkout.stripe.com/c/pay/cs_test_123');
  assert.equal(captured[0].get('line_items[0][price]'), 'price_monthly');
  assert.equal(captured[0].get('customer_email'), 'user@example.com');
  assert.equal(captured[0].get('subscription_data[metadata][billing_period]'), 'monthly');
});

test('billing sync validates only configured Prompt Lab Stripe prices', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_123';
  process.env.STRIPE_MONTHLY_PRICE_ID = 'price_monthly';
  process.env.STRIPE_YEARLY_PRICE_ID = 'price_yearly';
  const calls = [];

  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes('/customers?')) {
      return new Response(JSON.stringify({
        data: [{
          id: 'cus_123',
          email: 'user@example.com',
          name: 'Prompt Lab User',
        }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({
      data: [{
        id: 'sub_123',
        status: 'active',
        items: {
          data: [{
            price: { id: 'price_monthly' },
          }],
        },
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const { createLicenseHandler } = await loadHandler(licenseUrl);
  const handler = createLicenseHandler({
    resolveIdentity: async () => createAuthenticatedIdentity(),
  });
  const response = await handler(new Request('https://promptlab.tools/api/billing/license', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'validate',
    }),
  }));

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.plan, 'pro');
  assert.equal(payload.billingPeriod, 'monthly');
  assert.equal(payload.customerId, 'cus_123');
  assert.match(calls[0], /customers\?limit=1&email=user%40example.com/);
});

test('billing sync rejects an email with no active Prompt Lab Pro subscription', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_123';
  process.env.STRIPE_MONTHLY_PRICE_ID = 'price_monthly';
  process.env.STRIPE_YEARLY_PRICE_ID = 'price_yearly';

  globalThis.fetch = async (url) => {
    if (String(url).includes('/customers?')) {
      return new Response(JSON.stringify({
        data: [{
          id: 'cus_123',
          email: 'user@example.com',
          name: 'Prompt Lab User',
        }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({
      data: [{
        id: 'sub_123',
        status: 'active',
        items: {
          data: [{
            price: { id: 'price_other' },
          }],
        },
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const { createLicenseHandler } = await loadHandler(licenseUrl);
  const handler = createLicenseHandler({
    resolveIdentity: async () => createAuthenticatedIdentity(),
  });
  const response = await handler(new Request('https://promptlab.tools/api/billing/license', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'activate',
    }),
  }));

  assert.equal(response.status, 404);
  assert.match(await response.text(), /No active Prompt Lab Pro subscription/i);
});

test('billing portal returns the configured portal url', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_123';
  process.env.STRIPE_PORTAL_RETURN_URL = 'https://promptlab.tools/app/';
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('/customers?')) {
      return new Response(JSON.stringify({
        data: [{
          id: 'cus_123',
          email: 'user@example.com',
          name: 'Prompt Lab User',
        }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    assert.equal(init.method, 'POST');
    assert.equal(new URLSearchParams(init.body).get('customer'), 'cus_123');
    return new Response(JSON.stringify({
      url: 'https://billing.stripe.com/session/test_123',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  const { createPortalHandler } = await loadHandler(portalUrl);
  const handler = createPortalHandler({
    resolveIdentity: async () => createAuthenticatedIdentity(),
  });
  const response = await handler(new Request('https://promptlab.tools/api/billing/portal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  }));

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.url, 'https://billing.stripe.com/session/test_123');
});

test('billing license fails fast when Stripe lookup hangs', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_123';
  process.env.STRIPE_MONTHLY_PRICE_ID = 'price_monthly';
  process.env.STRIPE_YEARLY_PRICE_ID = 'price_yearly';
  process.env.PROMPTLAB_BILLING_TIMEOUT_MS = '25';

  globalThis.fetch = async () => new Promise(() => {});

  const { createLicenseHandler } = await loadHandler(licenseUrl);
  const handler = createLicenseHandler({
    resolveIdentity: async () => createAuthenticatedIdentity(),
  });
  const response = await handler(new Request('https://promptlab.tools/api/billing/license', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'validate',
    }),
  }));

  assert.equal(response.status, 504);
  assert.match(await response.text(), /timed out/i);
});

test('billing checkout rejects unauthenticated requests', async () => {
  const { default: handler } = await loadHandler(checkoutUrl);
  const response = await handler(new Request('https://promptlab.tools/api/billing/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ period: 'monthly' }),
  }));

  assert.equal(response.status, 401);
  assert.match(await response.text(), /Sign in to manage Prompt Lab billing/i);
});

test('billing routes honor the global billing kill switch', async () => {
  process.env.BILLING_ENABLED = 'false';
  globalThis.fetch = async () => {
    throw new Error('upstream should not run while billing is disabled');
  };

  const { createCheckoutHandler } = await loadHandler(checkoutUrl);
  const handler = createCheckoutHandler({
    resolveIdentity: async () => createAuthenticatedIdentity(),
  });
  const response = await handler(new Request('https://promptlab.tools/api/billing/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ period: 'monthly' }),
  }));

  assert.equal(response.status, 503);
  assert.match(await response.text(), /temporarily unavailable/i);
});

test('billing checkout rate limits repeated requests from the same signed in user', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_123';
  process.env.STRIPE_MONTHLY_PRICE_ID = 'price_monthly';
  process.env.STRIPE_YEARLY_PRICE_ID = 'price_yearly';
  process.env.STRIPE_CHECKOUT_SUCCESS_URL = 'https://promptlab.tools/app/?billing=success';
  process.env.STRIPE_CHECKOUT_CANCEL_URL = 'https://promptlab.tools/app/?billing=cancelled';
  process.env.BILLING_CHECKOUT_USER_LIMIT_PER_MIN = '1';

  let upstreamCalls = 0;
  globalThis.fetch = async () => {
    upstreamCalls += 1;
    return new Response(JSON.stringify({
      id: `cs_test_${upstreamCalls}`,
      url: `https://checkout.stripe.com/c/pay/cs_test_${upstreamCalls}`,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const { createCheckoutHandler } = await loadHandler(checkoutUrl);
  const handler = createCheckoutHandler({
    resolveIdentity: async () => createAuthenticatedIdentity(),
  });

  const first = await handler(new Request('https://promptlab.tools/api/billing/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ period: 'monthly' }),
  }));
  const second = await handler(new Request('https://promptlab.tools/api/billing/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ period: 'monthly' }),
  }));

  assert.equal(first.status, 200);
  assert.equal(second.status, 429);
  assert.equal(upstreamCalls, 1);
  assert.equal(second.headers.get('Retry-After'), '10');
});

test('billing license opens the circuit breaker after a timeout', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_123';
  process.env.STRIPE_MONTHLY_PRICE_ID = 'price_monthly';
  process.env.STRIPE_YEARLY_PRICE_ID = 'price_yearly';
  process.env.PROMPTLAB_BILLING_TIMEOUT_MS = '25';

  globalThis.fetch = async () => new Promise(() => {});

  const { createLicenseHandler } = await loadHandler(licenseUrl);
  const handler = createLicenseHandler({
    resolveIdentity: async () => createAuthenticatedIdentity(),
  });

  const first = await handler(new Request('https://promptlab.tools/api/billing/license', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'validate' }),
  }));

  assert.equal(first.status, 504);

  globalThis.fetch = async () => new Response(JSON.stringify({
    data: [{
      id: 'cus_123',
      email: 'user@example.com',
      name: 'Prompt Lab User',
    }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  const second = await handler(new Request('https://promptlab.tools/api/billing/license', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'validate' }),
  }));

  assert.equal(second.status, 503);
  assert.match(await second.text(), /temporarily unavailable/i);
});

test('billing routes emit the structured log format', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_123';
  process.env.STRIPE_MONTHLY_PRICE_ID = 'price_monthly';
  process.env.STRIPE_YEARLY_PRICE_ID = 'price_yearly';
  const logLines = [];
  console.info = (message) => {
    logLines.push(String(message));
  };
  console.warn = () => {};

  globalThis.fetch = async (url) => {
    if (String(url).includes('/customers?')) {
      return new Response(JSON.stringify({
        data: [{
          id: 'cus_123',
          email: 'user@example.com',
          name: 'Prompt Lab User',
        }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({
      data: [{
        id: 'sub_123',
        status: 'active',
        items: {
          data: [{
            price: { id: 'price_monthly' },
          }],
        },
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const { createLicenseHandler } = await loadHandler(licenseUrl);
  const handler = createLicenseHandler({
    resolveIdentity: async () => createAuthenticatedIdentity(),
  });

  const response = await handler(new Request('https://promptlab.tools/api/billing/license', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'validate' }),
  }));

  assert.equal(response.status, 200);
  assert.ok(logLines.some((line) => /\[Billing\] route=license action=validate auth=yes status=200 duration=\d+ timeout=false/.test(line)));
});

test('billing sync rejects unauthenticated requests', async () => {
  const { default: handler } = await loadHandler(licenseUrl);
  const response = await handler(new Request('https://promptlab.tools/api/billing/license', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'validate',
      customerEmail: 'user@example.com',
    }),
  }));

  assert.equal(response.status, 401);
  assert.match(await response.text(), /Sign in to manage Prompt Lab billing/i);
});

test('billing portal rejects unauthenticated requests', async () => {
  const { default: handler } = await loadHandler(portalUrl);
  const response = await handler(new Request('https://promptlab.tools/api/billing/portal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customerEmail: 'user@example.com' }),
  }));

  assert.equal(response.status, 401);
  assert.match(await response.text(), /Sign in to manage Prompt Lab billing/i);
});
