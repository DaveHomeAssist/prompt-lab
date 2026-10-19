import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const options = readFileSync(path.join(root, 'extension', 'options.html'), 'utf8');
const optionsJs = readFileSync(path.join(root, 'extension', 'options.js'), 'utf8');

test('options page has one quiet, honest link to Pro on the web', () => {
  const links = options.match(/<a [^>]*promptlab\.tools[^>]*>[^<]*<\/a>/g) || [];
  assert.equal(links.length, 1, 'exactly one promptlab.tools link');
  const [link] = links;
  assert.match(link, /Pro features on the web/);
  assert.match(link, /href="https:\/\/promptlab\.tools\/\?source=extension&amp;placement=options_about#pricing"/);
  assert.match(link, /target="_blank"/);
  assert.match(link, /rel="noopener noreferrer"/);
  // Honest framing: the extension is free and Prompt Lab, not Google, sells Pro.
  assert.match(options, /Everything in this extension is free\./);
  assert.match(options, /sold by Prompt Lab, not Google/);
});

test('the Pro link is static: no script reveals, repeats or badges it', () => {
  assert.doesNotMatch(optionsJs, /aboutPro|about-pro|Pro features on the web/);
  const background = readFileSync(path.join(root, 'extension', 'background.js'), 'utf8');
  assert.doesNotMatch(background, /setBadgeText|notifications\.create|promptlab\.tools\/\?source=extension/);
});

test('the side panel bundle sources carry no extra upgrade prompt', () => {
  const srcFiles = readdirSync(path.join(root, 'src'), { recursive: true })
    .filter((file) => /\.(jsx?|mjs)$/.test(file) && !/__tests__|tests\//.test(file));
  for (const file of srcFiles) {
    const text = readFileSync(path.join(root, 'src', file), 'utf8');
    assert.doesNotMatch(text, /placement=options_about/, `${file} should not repeat the options link`);
  }
});
