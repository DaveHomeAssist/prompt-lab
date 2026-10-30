import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { accountSyncBuild, accountSyncExtensionEntry, accountSyncWebCsp, addCspSources, desktopSyncOverlay, patchExtensionManifest } from '../scripts/account-sync-build.mjs';

const ON = { VITE_PL_ACCOUNT_SYNC: 'on', VITE_SUPABASE_URL: 'https://abcd.supabase.co' };
const manifest = JSON.parse(readFileSync(new URL('../prompt-lab-extension/public/manifest.json', import.meta.url), 'utf8'));
const tauri = JSON.parse(readFileSync(new URL('../prompt-lab-desktop/src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
const appHtml = readFileSync(new URL('../prompt-lab-web/app/index.html', import.meta.url), 'utf8');
const runHtml = (plugin, html, filename) => plugin.transformIndexHtml.handler(html, { filename });

test('flag off (the default) changes nothing anywhere', () => {
  for (const env of [{}, { VITE_PL_ACCOUNT_SYNC: 'on' }, { ...ON, VITE_SUPABASE_URL: 'https://evil.example.com' }, { ...ON, VITE_PL_ACCOUNT_SYNC: 'off' }]) {
    assert.equal(accountSyncBuild(env).enabled, false);
    assert.equal(patchExtensionManifest(manifest, env), manifest);
    assert.equal(desktopSyncOverlay(tauri, env), null);
    assert.equal(runHtml(accountSyncWebCsp(env), appHtml, '/x/prompt-lab-web/app/index.html'), appHtml);
    assert.equal(runHtml(accountSyncExtensionEntry(env), '<head></head>'), '<head></head>');
  }
});

test('web /app: only connect-src gains only the project Supabase origin', () => {
  const out = runHtml(accountSyncWebCsp(ON), appHtml, '/x/prompt-lab-web/app/index.html');
  const csp = (html) => html.match(/Content-Security-Policy" content="([^"]*)"/)[1].split('; ');
  const before = csp(appHtml); const after = csp(out);
  assert.equal(after.length, before.length);
  after.forEach((directive, index) => {
    if (directive.startsWith('connect-src')) assert.equal(directive, `${before[index]} https://abcd.supabase.co`);
    else assert.equal(directive, before[index]);
  });
  assert.equal(runHtml(accountSyncWebCsp(ON), appHtml, '/x/prompt-lab-web/index.html'), appHtml, 'landing page untouched');
});

test('extension: cookies plus exact Clerk and Supabase host permissions, nothing wider', () => {
  const out = patchExtensionManifest(manifest, ON);
  assert.deepEqual(out.permissions.filter((p) => !manifest.permissions.includes(p)), ['cookies']);
  assert.deepEqual(out.host_permissions.filter((p) => !manifest.host_permissions.includes(p)), ['https://clerk.promptlab.tools/*', 'https://abcd.supabase.co/*']);
  assert.ok(!out.host_permissions.some((p) => p.includes('<all_urls>') || p.startsWith('http://promptlab')));
  assert.match(runHtml(accountSyncExtensionEntry(ON), '<head></head>'), /extensionAccountAuth\.js/);
});

test('desktop: connect-src adds Clerk and Supabase; shell open adds only the Clerk authorize URL', () => {
  const overlay = desktopSyncOverlay(tauri, ON);
  assert.equal(overlay.app.security.csp, addCspSources(tauri.app.security.csp, 'connect-src', ['https://clerk.promptlab.tools', 'https://abcd.supabase.co']));
  assert.match(overlay.app.security.csp, /script-src 'self'$/);
  const open = new RegExp(overlay.plugins.shell.open);
  assert.ok(open.test('https://promptlab.tools/pricing'));
  assert.ok(open.test('https://clerk.promptlab.tools/oauth/authorize?client_id=x'));
  assert.ok(!open.test('https://clerk.promptlab.tools/v1/client'));
  assert.ok(!open.test('https://evil.example.com/'));
});
