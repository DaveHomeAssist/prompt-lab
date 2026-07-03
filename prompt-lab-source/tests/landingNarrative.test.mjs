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
  assert.match(landingHtml, /Prompt engineering workspace\./);
  assert.match(landingHtml, /Draft, import, save, compose, and evaluate prompts/);
  assert.doesNotMatch(landingHtml, /Every prompt,\s*<\/span>/);
  assert.doesNotMatch(landingHtml, /Improve your first prompt/);
});

test('landing product sections tell the Workbench, Library, Evaluate story', () => {
  assert.match(landingHtml, /<div class="section-label">Workflow<\/div>/);
  assert.match(landingHtml, /Create, Library, Evaluate\./);
  assert.match(landingHtml, /<div class="feature-tag">Workbench<\/div>/);
  assert.match(landingHtml, /<div class="feature-tag">Evaluate<\/div>/);
  assert.match(landingHtml, /<div class="feature-tag">Library<\/div>/);
  assert.match(landingHtml, /Extension and desktop support Claude, OpenAI, Gemini, OpenRouter, and Ollama/);
  assert.match(landingHtml, /Import preset packs, library exports, and starter bundles/);
  assert.match(landingHtml, /Prompts kept in your workspace/);
  assert.match(landingHtml, /Save the prompts that earn a second life/);
  assert.match(landingHtml, /shape the prompt, keep the version that works, and test the result/);
});
