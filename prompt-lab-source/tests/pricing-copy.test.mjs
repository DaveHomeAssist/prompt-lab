// AUD-013: every place that shows a Pro price or the Pro feature list must
// agree with shared/pricing.js. Static pages keep literal text (the landing
// page is copied raw into docs/ by scripts/publish-landing.mjs), so this test
// is what keeps them honest.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ANNUAL_EFFECTIVE_MONTHLY_CENTS,
  ANNUAL_SAVINGS_CENTS,
  LEGACY_ANNUAL_AMOUNT_CENTS,
  PRICE_COPY,
  PRO_FEATURE_LIST,
  PRO_PRICES,
  formatUsd,
} from '../shared/pricing.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const flatten = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');

const LANDING_PAGES = ['prompt-lab-web/index.html', '../docs/index.html'];

test('derived amounts are consistent', () => {
  assert.equal(formatUsd(900), '$9');
  assert.equal(formatUsd(658), '$6.58');
  assert.equal(ANNUAL_SAVINGS_CENTS, 12 * PRO_PRICES.monthly.amountCents - PRO_PRICES.annual.amountCents);
  assert.equal(ANNUAL_EFFECTIVE_MONTHLY_CENTS, Math.round(PRO_PRICES.annual.amountCents / 12));
  assert.ok(ANNUAL_SAVINGS_CENTS > 0, 'annual must be cheaper than 12 monthly payments');
  assert.ok(LEGACY_ANNUAL_AMOUNT_CENTS !== PRO_PRICES.annual.amountCents);
});

for (const page of LANDING_PAGES) {
  test(`${page}: pricing card matches shared/pricing.js`, () => {
    const html = read(page);
    const monthly = String(PRO_PRICES.monthly.amountCents / 100);
    const annual = String(PRO_PRICES.annual.amountCents / 100);
    assert.match(html, new RegExp(`<span id="proPrice">${escape(monthly)}</span>`));
    assert.match(html, new RegExp(`proPrice\\.textContent\\s*=\\s*'${escape(annual)}'`));
    assert.match(html, new RegExp(`proPrice\\.textContent\\s*=\\s*'${escape(monthly)}'`));
    assert.match(html, new RegExp(escape(`${PRICE_COPY.annualEffectiveMonthly} effective monthly`)));
    assert.match(html, new RegExp(escape(`save ${PRICE_COPY.annualSavings}/year`)));
    assert.match(html, new RegExp(`Save ${escape(PRICE_COPY.annualSavings)}<`));
    const textContentAmounts = [...html.matchAll(/proPrice\.textContent\s*=\s*'([^']+)'/g)].map((m) => m[1]).sort();
    assert.deepEqual(textContentAmounts, [annual, monthly].sort(), 'no other Pro amounts in the toggle script');
  });

  test(`${page}: Pro feature list matches shared/pricing.js`, () => {
    const html = read(page);
    const card = html.match(/<div class="pricing-tier">Pro<\/div>[\s\S]*?<ul class="pricing-features">([\s\S]*?)<\/ul>/);
    assert.ok(card, 'Pro pricing card not found');
    const items = [...card[1].matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1].trim());
    assert.deepEqual(items, ['Everything in Free', ...PRO_FEATURE_LIST.map((feature) => feature.landingLabel)]);
  });
}

test('terms and billing policy state the configured prices', () => {
  const terms = flatten(read('prompt-lab-web/public/terms.html'));
  assert.ok(terms.includes(PRICE_COPY.termsSentence), `terms must say "${PRICE_COPY.termsSentence}"`);
  assert.ok(terms.includes(PRICE_COPY.legacyAnnualWords), 'terms must name the legacy annual price');
  const policy = read('docs/billing-policy.md').replace(/\s+/g, ' ');
  assert.ok(policy.includes(PRICE_COPY.termsSentence), `billing policy must say "${PRICE_COPY.termsSentence}"`);
});

test('app sources take prices from shared/pricing.js, not literals', () => {
  for (const file of [
    'prompt-lab-extension/src/modals/BillingModal.jsx',
    'prompt-lab-extension/src/lib/signInContext.js',
  ]) {
    const source = read(file);
    assert.match(source, /shared\/pricing\.js/, `${file} must import shared/pricing.js`);
    assert.doesNotMatch(source, /\$\d/, `${file} must not hard-code a dollar amount`);
  }
  const billing = read('prompt-lab-extension/src/lib/billing.js');
  assert.match(billing, /PRO_FEATURE_LIST/);
});
