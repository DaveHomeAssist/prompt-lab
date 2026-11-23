import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('extension/manifest.json', root), 'utf8'));
const publicManifest = JSON.parse(readFileSync(new URL('public/manifest.json', root), 'utf8'));
const menus = readFileSync(new URL('extension/highlight-menus.js', root), 'utf8');
const content = readFileSync(new URL('src/highlight-content.js', root), 'utf8');

test('both manifests add contextMenus and no broad host or content-script entry', () => {
  for (const file of [manifest, publicManifest]) {
    assert.ok(file.permissions.includes('contextMenus'));
    assert.equal(file.content_scripts, undefined);
    assert.equal(file.web_accessible_resources, undefined);
    assert.ok(!file.host_permissions.some((host) => host.includes('<all_urls>')));
  }
});

test('the selection menu uses the two required titles and can be turned off', () => {
  assert.match(menus, /Enhance with Prompt Lab/);
  assert.match(menus, /Send to Prompt Lab/);
  assert.match(menus, /contexts: \['selection'\]/);
  assert.match(menus, /pl2-highlight-context-menu/);
  assert.match(content, /Copied, paste to replace/);
  assert.doesNotMatch(content, /apiKey|chrome\.storage/);
});
