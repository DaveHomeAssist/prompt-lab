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
  expectLandingToMatch(/Preview the three strategies on the same rough prompt/);
  expectLandingNotToMatch(/\b(?:seven|7) (?:enhancement )?modes\b/i);

  expectLandingNotToMatch(/\bRefine\s*→/i);
  expectLandingNotToMatch(/Refining\.\.\./);
});

test('pricing uses two plans with accurate monthly and annual math', () => {
  expectLandingToMatch(/Start free\. Upgrade when useful\./);
  expectLandingToMatch(/\bFree\b/);
  expectLandingToMatch(/\bPro\b/);
  // Proposal 1: the card shows the annual plan by default; the monthly $9 is
  // one toggle away (set by the toggle script).
  expectLandingToMatch(/\$\s*79\b/);
  expectLandingToMatch(/\$6\.58 effective monthly/);
  expectSourceToMatch(/proPrice\.textContent\s*=\s*["']9["']/);
  expectSourceToMatch(/proPrice\.textContent\s*=\s*["']79["']/);
  // $79/12 = $6.58; 12 x $9 - $79 = $29 saved.
  expectSourceToMatch(/\$6\.58 effective monthly/i);
  expectSourceToMatch(/save \$29\/year/i);
  assert.equal(/proPrice\.textContent\s*=\s*["']99["']/.test(landingHtml), false, "old $99 annual price must be gone");
  expectLandingNotToMatch(/2 months free/i);
  assert.equal(
    /class="pricing-tier"[^>]*>\s*Annual\s*</i.test(landingHtml),
    false,
    'Annual billing must not be presented as a third pricing tier',
  );
});

test('pricing card lists library export under Free and keeps it out of Pro', () => {
  const freeCard = landingHtml.match(/<div class="pricing-tier">Free<\/div>[\s\S]*?<\/ul>/)?.[0] || '';
  const proCard = landingHtml.match(/<div class="pricing-tier">Pro<\/div>[\s\S]*?<\/ul>/)?.[0] || '';
  assert.match(freeCard, /JSON library export/);
  assert.doesNotMatch(proCard, /export/i);
  for (const feature of ['Compare in Evaluate', 'Batch test-case runs', 'Collections']) {
    assert.ok(proCard.includes(feature), `Pro card should list ${feature}`);
  }
  // AUD-008: the diff viewer is free.
  assert.doesNotMatch(proCard, /diff/i);
  assert.match(freeCard, /Diff of every improvement/);
});

// The hero product window and the sample must use the choices the shipped
// generation controls offer. The seven-mode picker is retired; its ids survive
// only so old runs can be replayed.
test('product window and sample only show real generation choices', () => {
  const options = readFileSync(new URL('../prompt-lab-extension/src/lib/generationOptions.js', import.meta.url), 'utf8');
  const labelsOf = (name) => {
    const block = options.match(new RegExp(`export const ${name} = Object\\.freeze\\(\\[([\\s\\S]*?)\\]\\);`))?.[1] || '';
    return new Set([...block.matchAll(/label: '([^']+)'/g)].map((m) => m[1]));
  };
  const strategies = labelsOf('STRATEGIES');
  const choices = new Set([...strategies, ...labelsOf('TASKS'), ...labelsOf('TARGETS')]);
  assert.deepEqual([...strategies].sort(), ['Expanded', 'Rebuilt', 'Refined']);

  const segments = landingHtml.match(/<span class="window-segments">([\s\S]*?)<\/span>\s*<span class="window-switch">/)?.[1] || '';
  const segmentLabels = [...segments.matchAll(/<span\b[^>]*>([^<]+)<\/span>/g)].map((m) => m[1].trim());
  assert.deepEqual(segmentLabels, ['Expanded', 'Refined', 'Rebuilt']);
  const selects = [...landingHtml.matchAll(/<span class="window-select">([^<]+)<\/span>/g)].map((m) => m[1].trim());
  assert.ok(selects.length > 0, 'product window select values not found');
  for (const value of selects) assert.ok(choices.has(value), `"${value}" is not a real task type or destination`);

  const sampleLabels = [...landingHtml.matchAll(/<input type="radio" name="demoMode"[^>]*><label for="[^"]+">([^<]+)<\/label>/g)].map((m) => m[1]);
  assert.deepEqual(sampleLabels, ['Expanded', 'Refined', 'Rebuilt']);
  expectLandingNotToMatch(/\b(?:Balanced|Concise|Detailed|Image Gen|Code Gen)\b/);
});

test('sensitive data claims match the scanner and never promise name detection', () => {
  const engine = readFileSync(new URL('../prompt-lab-extension/src/lib/piiEngine.js', import.meta.url), 'utf8');
  const patternsBlock = engine.match(/export const patterns = Object\.freeze\(\{([\s\S]*?)\n\}\);/)?.[1] || '';
  const detectorCount = [...patternsBlock.matchAll(/^ {2}\w+: Object\.freeze\(/gm)].length;
  assert.ok(detectorCount >= 8, 'piiEngine patterns should be readable');
  assert.doesNotMatch(patternsBlock, /\bname\b/i, 'the engine gained a name detector; update the landing claim');

  const listed = landingHtml.match(/<ul class="safety-types">([\s\S]*?)<\/ul>/)?.[1] || '';
  assert.equal([...listed.matchAll(/<li>/g)].length, detectorCount, 'list each built-in detector once');
  expectLandingToMatch(/does not (?:recognise|recognize|detect) names/i);
  expectLandingNotToMatch(/redaction of names|(?<!not )(?:detects?|catch(?:es)?|finds?) names/i);
});

test('hero badge names the current release', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const badge = landingHtml.match(/<div class="hero-badge" data-release="([^"]+)">\s*<span class="hero-badge-dot"><\/span>\s*v(\d+\.\d+) /);
  assert.ok(badge, 'hero badge with data-release not found');
  assert.equal(badge[1], pkg.version);
  assert.equal(badge[2], pkg.version.split('.').slice(0, 2).join('.'));
  expectLandingToMatch(/v\d+\.\d+ Create Library Evaluate/);
});

test('Free plan names the strategies, not retired modes', () => {
  const freeCard = landingHtml.match(/<div class="pricing-tier">Free<\/div>[\s\S]*?<\/ul>/)?.[0] || '';
  assert.match(freeCard, /<li>Expanded, Refined and Rebuilt strategies<\/li>/);
  assert.match(freeCard, /<li>Sensitive data check before send<\/li>/);
});
