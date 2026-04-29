import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const sourceDir = path.resolve(testDir, '..');

function apiModuleUrl(...parts) {
  return pathToFileURL(path.join(sourceDir, 'api', ...parts)).href;
}

const checkoutUrl = apiModuleUrl('billing', 'checkout.js');
const webhookUrl = apiModuleUrl('billing', 'webhook.js');
const bugReportUrl = apiModuleUrl('bug-report.js');

const ENV_KEYS = [
  'BILLING_ENABLED',
  'STRIPE_WEBHOOK_SECRET',
  'NOTION_TOKEN',
  'NOTION_BUG_REPORT_PARENT_PAGE_ID',
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

function createNodeRequest({ method = 'POST', url = '/', headers = {}, body = '' } = {}) {
  const request = Readable.from(body ? [Buffer.from(body)] : []);
  request.method = method;
  request.url = url;
  request.headers = {
    host: 'promptlab.tools',
    'x-forwarded-proto': 'https',
    ...headers,
  };
  return request;
}

function createNodeResponse() {
  let resolveDone;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });
  const headers = new Map();
  const response = {
    statusCode: 200,
    setHeader(key, value) {
      headers.set(String(key).toLowerCase(), String(value));
    },
    end(body = '') {
      resolveDone({
        statusCode: this.statusCode,
        headers,
        body: Buffer.isBuffer(body) ? body.toString('utf8') : String(body),
      });
    },
  };

  return { response, done };
}

test.afterEach(() => {
  resetEnv();
});

test('node billing function returns through ServerResponse when billing is disabled', async () => {
  process.env.BILLING_ENABLED = 'false';
  const handler = await loadHandler(checkoutUrl);
  const request = createNodeRequest({
    url: '/api/billing/checkout',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ period: 'monthly' }),
  });
  const { response, done } = createNodeResponse();

  await handler(request, response);
  const result = await done;

  assert.equal(result.statusCode, 503);
  assert.match(result.headers.get('content-type'), /application\/json/);
  assert.match(result.body, /Hosted billing is temporarily unavailable/);
});

test('node billing webhook returns through ServerResponse when unconfigured', async () => {
  delete process.env.STRIPE_WEBHOOK_SECRET;
  const handler = await loadHandler(webhookUrl);
  const request = createNodeRequest({
    url: '/api/billing/webhook',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'checkout.session.completed' }),
  });
  const { response, done } = createNodeResponse();

  await handler(request, response);
  const result = await done;

  assert.equal(result.statusCode, 503);
  assert.match(result.body, /Stripe webhook secret is not configured/);
});

test('node bug report function returns through ServerResponse when unconfigured', async () => {
  delete process.env.NOTION_TOKEN;
  delete process.env.NOTION_BUG_REPORT_PARENT_PAGE_ID;
  const handler = await loadHandler(bugReportUrl);
  const request = createNodeRequest({
    url: '/api/bug-report',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Failure', steps: 'Open app' }),
  });
  const { response, done } = createNodeResponse();

  await handler(request, response);
  const result = await done;

  assert.equal(result.statusCode, 503);
  assert.match(result.body, /Bug reporting is not configured/);
});
