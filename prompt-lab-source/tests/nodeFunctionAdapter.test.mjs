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
  'PROMPTLAB_BUG_REPORTS_ENABLED',
  'PROMPTLAB_BUG_REPORTS_LIMIT_PER_MIN',
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
  process.env.PROMPTLAB_BUG_REPORTS_ENABLED = 'true';
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

test('node bug report function is closed by default even when Notion is configured', async () => {
  process.env.NOTION_TOKEN = 'secret_not_used';
  process.env.NOTION_BUG_REPORT_PARENT_PAGE_ID = 'page_not_used';
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
  assert.match(result.body, /Bug reporting is temporarily unavailable/);
});

test('node bug report function rate limits submissions before writing to Notion', async () => {
  process.env.PROMPTLAB_BUG_REPORTS_ENABLED = 'true';
  process.env.PROMPTLAB_BUG_REPORTS_LIMIT_PER_MIN = '2';
  process.env.NOTION_TOKEN = 'secret_test';
  process.env.NOTION_BUG_REPORT_PARENT_PAGE_ID = 'page_test';
  const originalFetch = globalThis.fetch;
  const fetchCalls = [];
  globalThis.fetch = async (...args) => {
    fetchCalls.push(args);
    return new Response(JSON.stringify({ id: 'notion-page', url: 'https://notion.test/page' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const handler = await loadHandler(bugReportUrl);
    const results = [];
    for (let index = 0; index < 3; index += 1) {
      const request = createNodeRequest({
        url: '/api/bug-report',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': '203.0.113.10',
        },
        body: JSON.stringify({ title: `Failure ${index}`, steps: 'Open app' }),
      });
      const { response, done } = createNodeResponse();
      await handler(request, response);
      results.push(await done);
    }

    assert.equal(results[0].statusCode, 200);
    assert.equal(results[1].statusCode, 200);
    assert.equal(results[2].statusCode, 429);
    assert.match(results[2].body, /Too many bug report submissions/);
    assert.equal(fetchCalls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
