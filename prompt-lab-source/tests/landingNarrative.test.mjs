import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const sourceDir = path.resolve(testDir, '..');
const landingPath = path.join(sourceDir, 'prompt-lab-web', 'index.html');
const landingHtml = fs.readFileSync(landingPath, 'utf8');

test('landing hero and navigation frame Prompt Lab around the workflow', () => {
  assert.match(landingHtml, /Open PromptLab/);
  assert.match(landingHtml, /Extension setup/);
  assert.match(landingHtml, /Write sharper prompts\./);
  assert.match(landingHtml, /Keep the winners\./);
  assert.doesNotMatch(landingHtml, /Every prompt,\s*<\/span>/);
  assert.doesNotMatch(landingHtml, /Improve your first prompt/);
});

test('landing product sections tell the Workbench, Library, Evaluate story', () => {
  assert.match(landingHtml, /<div class="section-label">Workflow<\/div>/);
  assert.match(landingHtml, /Workbench, Library, Evaluate\./);
  assert.match(landingHtml, /<div class="feature-tag">Workbench<\/div>/);
  assert.match(landingHtml, /<div class="feature-tag">Evaluate<\/div>/);
  assert.match(landingHtml, /<div class="feature-tag">Library<\/div>/);
  assert.match(landingHtml, /Providers supported/);
  assert.match(landingHtml, /Library-backed workflow/);
  assert.match(landingHtml, /Prompts kept local-first/);
  assert.match(landingHtml, /Build a prompt workflow,/);
  assert.match(landingHtml, /not a prompt pile\./);
});
