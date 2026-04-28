import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const sourceDir = path.resolve(testDir, '..');
const licenseUrl = pathToFileURL(path.join(sourceDir, 'api', 'billing', 'license.js')).href;

async function loadHandler() {
  const mod = await import(`${licenseUrl}?t=${Date.now()}-${Math.random()}`);
  return mod.default;
}

test('billing preflight allows Authorization for trusted web origin', async () => {
  const handler = await loadHandler();
  const response = await handler(new Request('https://promptlab.tools/api/billing/license', {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://promptlab.tools',
      'Access-Control-Request-Headers': 'Authorization, Content-Type',
    },
  }));

  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://promptlab.tools');
  assert.match(response.headers.get('Access-Control-Allow-Headers') || '', /Authorization/);
  assert.equal(response.headers.get('Vary'), 'Origin');
});

test('billing preflight rejects unlisted origins', async () => {
  const handler = await loadHandler();
  const response = await handler(new Request('https://promptlab.tools/api/billing/license', {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://evil.example',
      'Access-Control-Request-Headers': 'Authorization, Content-Type',
    },
  }));

  assert.equal(response.status, 403);
});
