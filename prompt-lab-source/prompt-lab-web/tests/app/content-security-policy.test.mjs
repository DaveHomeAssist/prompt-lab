import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appIndexPath = new URL('../../app/index.html', import.meta.url);

async function readAppCsp() {
  const html = await readFile(appIndexPath, 'utf8');
  const match = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
  assert.ok(match, 'app index must declare a Content Security Policy');
  return match[1];
}

test('app CSP permits the configured Clerk runtime and API domain without a wildcard', async () => {
  const csp = await readAppCsp();

  assert.match(csp, /script-src[^;]*\bhttps:\/\/clerk\.promptlab\.tools\b/);
  assert.match(csp, /connect-src[^;]*\bhttps:\/\/clerk\.promptlab\.tools\b/);
  assert.doesNotMatch(csp, /https:\/\/\*\.clerk\./);
});
