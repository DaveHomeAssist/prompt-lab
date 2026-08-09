import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = dirname(fileURLToPath(import.meta.url));
const sourceDir = resolve(testDir, '..');
const webDir = join(sourceDir, 'prompt-lab-web');
const landingHtml = readFileSync(join(webDir, 'index.html'), 'utf8');
const guideHtml = readFileSync(join(webDir, 'public', 'guide.html'), 'utf8');
const setupHtml = readFileSync(join(webDir, 'public', 'setup.html'), 'utf8');
const privacyHtml = readFileSync(join(webDir, 'public', 'privacy.html'), 'utf8');
const privacyRedirectHtml = readFileSync(join(webDir, 'public', 'privacy', 'index.html'), 'utf8');

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function openingTagById(html, id) {
  const idPattern = escapeRegExp(id);
  const match = html.match(new RegExp(`<([a-z][\\w:-]*)\\b[^>]*\\bid=["']${idPattern}["'][^>]*>`, 'i'));
  assert.ok(match, `Expected element #${id}`);
  return match[0];
}

function attributeValue(tag, name) {
  const namePattern = escapeRegExp(name);
  const match = tag.match(new RegExp(`\\b${namePattern}\\s*=\\s*(["'])(.*?)\\1`, 'i'));
  return match?.[2]
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

function hasBooleanAttribute(tag, name) {
  const namePattern = escapeRegExp(name);
  return new RegExp(`\\s${namePattern}(?:\\s*=\\s*(?:["']${namePattern}["']|["']?["']?)|(?=\\s|>))`, 'i').test(tag);
}

function inputTagsByName(html, name) {
  return [...html.matchAll(/<input\b[^>]*>/gi)]
    .map((match) => match[0])
    .filter((tag) => attributeValue(tag, 'name') === name);
}

function assertLabelFor(html, id) {
  const idPattern = escapeRegExp(id);
  assert.match(html, new RegExp(`<label\\b[^>]*\\bfor=["']${idPattern}["'][^>]*>`, 'i'));
}

function assertPageMatch(html, pattern, message) {
  assert.ok(pattern.test(html), message ?? `Expected page to match ${pattern}`);
}

test('landing has a keyboard skip link and one named main landmark', () => {
  const skipTag = landingHtml.match(/<a\b[^>]*\bclass=["'][^"']*\bskip-link\b[^"']*["'][^>]*>/i)?.[0];
  assert.ok(skipTag, 'Expected .skip-link anchor');
  assert.equal(attributeValue(skipTag, 'href'), '#main-content');

  const mainTag = openingTagById(landingHtml, 'main-content');
  assert.match(mainTag, /^<main\b/i);
  assert.equal(attributeValue(mainTag, 'tabindex'), '-1');
  assert.equal((landingHtml.match(/<main\b/gi) ?? []).length, 1);
});

test('mobile navigation exposes dialog state and a dedicated close control', () => {
  const toggleTag = openingTagById(landingHtml, 'navToggle');
  assert.match(toggleTag, /^<button\b/i);
  assert.equal(attributeValue(toggleTag, 'aria-expanded'), 'false');
  assert.equal(attributeValue(toggleTag, 'aria-controls'), 'mobileNav');

  const dialogTag = openingTagById(landingHtml, 'mobileNav');
  assert.equal(attributeValue(dialogTag, 'role'), 'dialog');
  assert.equal(attributeValue(dialogTag, 'aria-modal'), 'true');
  assert.ok(
    attributeValue(dialogTag, 'aria-label') || attributeValue(dialogTag, 'aria-labelledby'),
    '#mobileNav needs an accessible name',
  );

  const closeTag = openingTagById(landingHtml, 'mobileNavClose');
  assert.match(closeTag, /^<button\b/i);
  assert.ok(attributeValue(closeTag, 'aria-label'), '#mobileNavClose needs an accessible name');
});

test('interactive sample uses labeled native controls and persistent status semantics', () => {
  const demoTag = openingTagById(landingHtml, 'demo');
  assert.match(demoTag, /^<section\b/i);

  const modesTag = openingTagById(landingHtml, 'demoModes');
  assert.match(modesTag, /^<fieldset\b/i);
  assertPageMatch(
    landingHtml,
    /<fieldset\b[^>]*\bid=["']demoModes["'][^>]*>[\s\S]*?<legend\b[^>]*>/i,
    '#demoModes needs a legend',
  );

  const modeInputs = inputTagsByName(landingHtml, 'demoMode');
  assert.equal(modeInputs.length, 3);
  assert.deepEqual(
    modeInputs.map((tag) => attributeValue(tag, 'value')).sort(),
    ['balanced', 'concise', 'detailed'],
  );
  for (const tag of modeInputs) {
    assert.equal(attributeValue(tag, 'type'), 'radio');
    const id = attributeValue(tag, 'id');
    assert.ok(id, 'Each demo mode radio needs an id');
    assertLabelFor(landingHtml, id);
  }

  const inputTag = openingTagById(landingHtml, 'demoInput');
  assert.match(inputTag, /^<textarea\b/i);
  assert.ok(hasBooleanAttribute(inputTag, 'readonly'), '#demoInput must be readonly');
  assertLabelFor(landingHtml, 'demoInput');

  const outputTag = openingTagById(landingHtml, 'demoOutput');
  assert.equal(attributeValue(outputTag, 'aria-busy'), 'false');

  const runTag = openingTagById(landingHtml, 'demoRun');
  assert.match(runTag, /^<button\b/i);
  assert.equal(attributeValue(runTag, 'type'), 'button');

  const statusTag = openingTagById(landingHtml, 'demoStatus');
  assert.equal(attributeValue(statusTag, 'role'), 'status');

  const ctaTag = openingTagById(landingHtml, 'demoCta');
  assert.match(ctaTag, /^<a\b/i);
  assert.match(attributeValue(ctaTag, 'href') ?? '', /\/app\/?(?:[?#]|$)/);
});

test('pricing uses one labeled billing-period group and explicit upgrade intent', () => {
  const periodInputs = inputTagsByName(landingHtml, 'billingPeriod');
  assert.equal(periodInputs.length, 2);
  assert.deepEqual(
    periodInputs.map((tag) => attributeValue(tag, 'id')).sort(),
    ['billingAnnual', 'billingMonthly'],
  );
  for (const tag of periodInputs) {
    assert.equal(attributeValue(tag, 'type'), 'radio');
    assertLabelFor(landingHtml, attributeValue(tag, 'id'));
  }

  const proCtaTag = openingTagById(landingHtml, 'proCta');
  assert.match(proCtaTag, /^<a\b/i);
  assert.equal(
    attributeValue(proCtaTag, 'href'),
    '/app?upgrade=pro&period=monthly&source=landing-pricing',
  );

  openingTagById(landingHtml, 'proPrice');
  openingTagById(landingHtml, 'proPeriod');
});

test('target-blank links protect the opener on landing and task documentation', () => {
  const pages = [
    ['landing', landingHtml],
    ['guide', guideHtml],
    ['setup', setupHtml],
    ['privacy', privacyHtml],
  ];

  for (const [pageName, html] of pages) {
    const externalTags = [...html.matchAll(/<a\b[^>]*\btarget=["']_blank["'][^>]*>/gi)].map((match) => match[0]);
    for (const tag of externalTags) {
      const relTokens = new Set((attributeValue(tag, 'rel') ?? '').toLowerCase().split(/\s+/).filter(Boolean));
      assert.ok(relTokens.has('noopener'), `${pageName} target=_blank link is missing noopener: ${tag}`);
      assert.ok(relTokens.has('noreferrer'), `${pageName} target=_blank link is missing noreferrer: ${tag}`);
    }
  }
});

test('public landing surfaces load fonts locally without automatic third-party requests', () => {
  const pages = [
    ['landing', landingHtml, '/fonts/'],
    ['guide', guideHtml, './fonts/'],
    ['setup', setupHtml, './fonts/'],
    ['privacy', privacyHtml, './fonts/'],
  ];

  for (const [pageName, html, fontRoot] of pages) {
    assert.doesNotMatch(html, /fonts\.(?:googleapis|gstatic)\.com/i);
    assert.ok(
      html.includes(`${fontRoot}outfit.woff2`),
      `${pageName} should load Outfit from ${fontRoot}`,
    );
    assert.ok(
      html.includes(`${fontRoot}jetbrains-mono.woff2`),
      `${pageName} should load JetBrains Mono from ${fontRoot}`,
    );
  }
});

test('public landing surfaces declare a first-party-only content security policy', () => {
  const pages = [
    ['landing', landingHtml],
    ['guide', guideHtml],
    ['setup', setupHtml],
    ['privacy', privacyHtml],
    ['privacy redirect', privacyRedirectHtml],
  ];
  const requiredDirectives = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ];

  for (const [pageName, html] of pages) {
    const policyTag = [...html.matchAll(/<meta\b[^>]*>/gi)]
      .map((match) => match[0])
      .find((tag) => attributeValue(tag, 'http-equiv')?.toLowerCase() === 'content-security-policy');
    assert.ok(policyTag, `${pageName} needs a Content-Security-Policy meta tag`);
    const policy = attributeValue(policyTag, 'content') ?? '';
    for (const directive of requiredDirectives) {
      assert.ok(policy.includes(directive), `${pageName} CSP is missing ${directive}`);
    }
    assert.doesNotMatch(policy, /https?:|\*/i, `${pageName} CSP must not allow external origins or wildcards`);
  }
});

test('landing conversion controls have unique stable analytics identifiers', () => {
  const analyticsIds = [...landingHtml.matchAll(/\bdata-analytics-id=["']([^"']+)["']/gi)]
    .map((match) => match[1]);
  assert.equal(new Set(analyticsIds).size, analyticsIds.length, 'Landing analytics IDs must be unique');
  assert.deepEqual([...analyticsIds].sort(), [
    'landing.demo.example_prompt',
    'landing.demo.mode_balanced',
    'landing.demo.mode_concise',
    'landing.demo.mode_detailed',
    'landing.demo.show_result',
    'landing.demo.try_own',
    'landing.final.try_free',
    'landing.footer.open_app',
    'landing.hero.see_workflow',
    'landing.hero.try_free',
    'landing.mobile_menu.open_app',
    'landing.nav.open_app',
    'landing.nav_mobile.open_app',
    'landing.pricing.annual',
    'landing.pricing.free',
    'landing.pricing.monthly',
    'landing.pricing.pro',
    'landing.privacy.open_policy',
    'landing.surface.desktop_source',
    'landing.surface.extension',
    'landing.surface.web',
  ]);

  const privacyCta = landingHtml.match(/<a\b[^>]*href=["']\/privacy["'][^>]*>/i)?.[0];
  assert.ok(privacyCta, 'Expected the privacy policy CTA');
  assert.equal(attributeValue(privacyCta, 'data-analytics-id'), 'landing.privacy.open_policy');
});

test('landing task links resolve to canonical guide and setup headings', () => {
  const taskLinks = [
    { page: 'guide.html', id: 'quick-start', html: guideHtml },
    { page: 'setup.html', id: 'provider-setup', html: setupHtml },
    { page: 'guide.html', id: 'import-export', html: guideHtml },
    { page: 'guide.html', id: 'variables', html: guideHtml },
    { page: 'guide.html', id: 'keyboard-shortcuts', html: guideHtml },
  ];

  for (const { page, id, html } of taskLinks) {
    const destination = `${page}#${id}`;
    assertPageMatch(
      landingHtml,
      new RegExp(`href=["'](?:https:\\/\\/promptlab\\.tools\\/|\\.?\\/?)${escapeRegExp(destination)}["']`, 'i'),
      `Expected landing link to ${destination}`,
    );
    const headingTag = openingTagById(html, id);
    assert.match(headingTag, /^<h[1-6]\b/i, `${destination} should identify a heading`);
  }
});

test('reveal animation is an enhancement and reduced motion has an explicit path', () => {
  assertPageMatch(
    landingHtml,
    /(?:\.js\s+\.reveal\b[^}]*\{[^}]*opacity\s*:\s*0|\.reveal\b[^{}]*\{[^}]*opacity\s*:\s*1)/si,
    'Reveal content must default to visible or be hidden only after JavaScript opts in',
  );
  assertPageMatch(landingHtml, /\.reveal-motion\s+\.reveal:not\(\.visible\)/i);
  assertPageMatch(landingHtml, /new\s+IntersectionObserver\s*\(/i);
  assertPageMatch(landingHtml, /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/i);
  assertPageMatch(landingHtml, /matchMedia\(\s*["']\(prefers-reduced-motion:\s*reduce\)["']\s*\)/i);
});
