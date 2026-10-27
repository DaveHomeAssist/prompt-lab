import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  BILLING_OFFLINE_GRACE_DAYS,
  BILLING_REVALIDATE_AFTER_HOURS,
} from '../prompt-lab-extension/src/lib/billingPolicy.js';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const terms = await read('../prompt-lab-web/public/terms.html');
const policyDoc = await read('../docs/billing-policy.md');
const billingModal = await read('../prompt-lab-extension/src/modals/BillingModal.jsx');
const vercel = JSON.parse(await read('../vercel.json'));
const sitemap = await read('../prompt-lab-web/public/sitemap.xml');
const landing = await read('../prompt-lab-web/index.html');

const text = terms.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ');
const isDraft = /data-draft="true"/.test(terms);

test('terms page is served at /terms', () => {
  assert.ok(
    vercel.rewrites.some((rule) => rule.source === '/terms' && rule.destination === '/terms.html'),
    'vercel.json needs a /terms rewrite',
  );
  assert.match(terms, /<link rel="canonical" href="https:\/\/promptlab\.tools\/terms\.html">/);
});

test('a draft terms page is labeled, unindexed and unlinked', () => {
  assert.ok(isDraft, 'terms must remain a draft until separately approved');
  assert.match(terms, /<title>[^<]*Draft[^<]*<\/title>/);
  assert.match(terms, /<meta name="robots" content="noindex,nofollow">/);
  assert.match(text, /DRAFT, not in effect\./);
  assert.match(text, /not legal advice/);
  assert.match(text, /does not make this draft effective or constitute acceptance of it/);
  assert.doesNotMatch(text, /By using Prompt Lab or buying Prompt Lab Pro you agree/);
  assert.doesNotMatch(sitemap, /terms\.html/, 'do not list a draft in the sitemap');
  assert.doesNotMatch(landing, /href="[^"]*terms(\.html)?"/, 'do not link a draft from the landing page');
});

test('terms cover every required topic', () => {
  for (const id of [
    'subscription', 'cancellation', 'refunds', 'failed-payments', 'device-access',
    'acceptable-use', 'disclaimers', 'liability', 'contact',
  ]) {
    assert.match(terms, new RegExp(`<h2 id="${id}">`), `missing section #${id}`);
  }
  assert.match(text, /renews automatically until you cancel/);
  assert.match(terms, /mailto:hi@promptlab\.tools/);
});

test('terms state the same prices as checkout', () => {
  // AUD-013: the dialog renders PRICE_COPY from shared/pricing.js;
  // tests/pricing-copy.test.mjs checks those amounts against these terms.
  assert.match(billingModal, /PRICE_COPY\.monthlyPerPeriod/);
  assert.match(billingModal, /PRICE_COPY\.annualPerPeriod/);
  assert.doesNotMatch(billingModal, /\$99\/year/);
  assert.match(text, /USD 9 per month or USD 79 per year/);
});

test('terms match the billing policy: refunds, disputes and device checks', () => {
  assert.match(policyDoc, /within 14 days of your first/);
  assert.match(text, /within 14 days of your first Prompt Lab Pro payment/);
  assert.match(text, /within 14 days of an annual renewal payment/);
  assert.match(text, /A full refund ends Pro\./);
  assert.match(text, /Monthly renewals are not refundable/);
  assert.match(text, /we cancel your subscription immediately/);
  assert.match(text, new RegExp(`after ${BILLING_REVALIDATE_AFTER_HOURS} hours since its last check`));
  assert.match(text, /not a guaranteed maximum delay/);
  assert.match(text, /browser scheduling, network availability and server updates/);
  assert.doesNotMatch(text, /up to 6 hours to appear|Refresh Status applies it immediately/);
  assert.match(text, new RegExp(`for up to ${BILLING_OFFLINE_GRACE_DAYS} days after its last successful check`));
});

test('clauses that need a legal review stay flagged while the page is a draft', () => {
  if (!isDraft) return;
  const flags = [...terms.matchAll(/<span class="legal-flag">([^<]*)<\/span>/g)].map((m) => m[1]);
  const all = flags.join(' ');
  for (const topic of [/withdrawal/i, /Automatic Renewal Law/, /click-to-cancel/, /VAT/, /hi@promptlab\.tools/]) {
    assert.match(all, topic, `missing legal-check flag for ${topic}`);
  }
});

test('library export is described as free on every plan, not as a Pro feature', () => {
  assert.match(text, /JSON library export is available on every plan, including Free/);
  assert.doesNotMatch(text, /Pro adds[^.]*export/);
});
