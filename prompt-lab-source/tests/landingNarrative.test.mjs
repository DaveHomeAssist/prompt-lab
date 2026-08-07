import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = dirname(fileURLToPath(import.meta.url));
const sourceDir = resolve(testDir, '..');
const landingPath = join(sourceDir, 'prompt-lab-web', 'index.html');
const landingHtml = readFileSync(landingPath, 'utf8');
const landingText = landingHtml
  .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
  .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&(?:nbsp|middot);/g, ' ')
  .replace(/&(?:ndash|mdash|rarr);/g, '—')
  .replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ')
  .trim();

function expectLandingToMatch(pattern, message = `Expected landing to match ${pattern}`) {
  assert.ok(pattern.test(landingText), message);
}

function expectLandingNotToMatch(pattern, message = `Expected landing not to match ${pattern}`) {
  assert.equal(pattern.test(landingText), false, message);
}

function expectSourceToMatch(pattern, message = `Expected landing source to match ${pattern}`) {
  assert.ok(pattern.test(landingHtml), message);
}

test('landing hero leads with the outcome and one primary conversion path', () => {
  expectLandingToMatch(/Turn rough prompts into reusable, tested workflows\./);
  expectLandingToMatch(/\bTry PromptLab free\b/);
  expectLandingToMatch(/\bSee the workflow\b/);
  expectLandingToMatch(/Free editor/i);
  expectLandingToMatch(/Local library storage/i);
  expectLandingToMatch(/Connect a provider when (?:(?:you are|you're) )?ready/i);

  expectLandingNotToMatch(/Prompt engineering workspace\./);
  expectLandingNotToMatch(/Every prompt,\s*<\/span>/);
  expectLandingNotToMatch(/Improve your first prompt/);
});

test('landing explains surfaces without promising an unverified desktop download', () => {
  expectLandingToMatch(/Web app/i);
  expectLandingToMatch(/recommended/i);
  expectLandingToMatch(/Browser extension/i);
  expectLandingToMatch(/Desktop/i);
  expectLandingToMatch(/build (?:information|notes)/i);

  expectLandingNotToMatch(/Download (?:the )?desktop(?: app)?/i);
});

test('landing tells the sample, workflow, privacy, pricing, and FAQ story in order', () => {
  const hero = landingHtml.search(/<section\b[^>]*\bclass=["'][^"']*\bhero\b/i);
  const sample = landingHtml.search(/<section\b[^>]*\bid=["']demo["']/i);
  const workflow = landingHtml.indexOf('id="workflow"');
  const privacy = landingHtml.indexOf('id="privacy"');
  const pricing = landingHtml.indexOf('id="pricing"');
  const faq = landingHtml.indexOf('id="faq"');

  assert.notEqual(hero, -1, 'Expected hero section');
  assert.notEqual(sample, -1, 'Expected #demo section');
  assert.notEqual(workflow, -1, 'Expected #workflow section');
  assert.notEqual(privacy, -1, 'Expected privacy and portability content');
  assert.notEqual(pricing, -1, 'Expected #pricing section');
  assert.notEqual(faq, -1, 'Expected #faq section');
  assert.ok(hero < sample, 'Hero should precede the sample');
  assert.ok(sample < workflow, 'Sample should precede the Create–Library–Evaluate workflow');
  assert.ok(workflow < privacy, 'Workflow should precede privacy and portability');
  assert.ok(privacy < pricing, 'Privacy should precede pricing');
  assert.ok(pricing < faq, 'Pricing should precede the FAQ');

  const workflowHtml = landingHtml.slice(workflow, privacy);
  const create = workflowHtml.search(/class=["'][^"']*feature-tag[^"']*["'][^>]*>\s*Create\s*</i);
  const library = workflowHtml.search(/class=["'][^"']*feature-tag[^"']*["'][^>]*>\s*Library\s*</i);
  const evaluate = workflowHtml.search(/class=["'][^"']*feature-tag[^"']*["'][^>]*>\s*Evaluate\s*</i);
  assert.notEqual(create, -1, 'Expected Create workflow step');
  assert.notEqual(library, -1, 'Expected Library workflow step');
  assert.notEqual(evaluate, -1, 'Expected Evaluate workflow step');
  assert.ok(create < library && library < evaluate, 'Workflow must read Create–Library–Evaluate');
});

test('landing presents the demo as a transparent sample, not live processing', () => {
  expectLandingToMatch(/Interactive sample/);
  expectLandingToMatch(/(?:Example|Fixed sample) prompt/);
  expectLandingToMatch(/Show sample result/);
  expectLandingToMatch(/Try your own prompt(?: in PromptLab)?/);
  expectLandingToMatch(/(?:sample|example|preview).*(?:seven|7) modes/i);

  expectLandingNotToMatch(/\bRefine\s*→/i);
  expectLandingNotToMatch(/Refining\.\.\./);
});

test('pricing uses two plans with accurate monthly and annual math', () => {
  expectLandingToMatch(/Start free\. Upgrade when useful\./);
  expectLandingToMatch(/\bFree\b/);
  expectLandingToMatch(/\bPro\b/);
  expectLandingToMatch(/\$\s*9(?:\.00)?/);
  expectSourceToMatch(/proPrice\.textContent\s*=\s*["']100["']/);
  expectSourceToMatch(/\$8\.33 effective monthly/i);
  expectSourceToMatch(/save \$8\/year/i);
  expectLandingNotToMatch(/2 months free/i);
  assert.equal(
    /class="pricing-tier"[^>]*>\s*Annual\s*</i.test(landingHtml),
    false,
    'Annual billing must not be presented as a third pricing tier',
  );
});
