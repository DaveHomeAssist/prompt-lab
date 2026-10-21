#!/usr/bin/env node
// AUD-013: read-only check that the Stripe prices configured for checkout
// match shared/pricing.js. It only sends GET /v1/prices/{id}; it never creates
// or changes anything. Reads STRIPE_SECRET_KEY, STRIPE_MONTHLY_PRICE_ID,
// STRIPE_YEARLY_PRICE_ID and optional STRIPE_LEGACY_YEARLY_PRICE_IDS from the
// environment and never prints the key. A restricted key with read access to
// Prices is enough.
//
//   node scripts/check-stripe-prices.mjs
import { pathToFileURL } from 'node:url';
import { LEGACY_ANNUAL_AMOUNT_CENTS, PRICING_CURRENCY, PRO_PRICES } from '../shared/pricing.js';

export function expectedPrices(env) {
  const list = [
    { name: 'monthly', envName: 'STRIPE_MONTHLY_PRICE_ID', id: env.STRIPE_MONTHLY_PRICE_ID, amount: PRO_PRICES.monthly.amountCents, interval: 'month' },
    { name: 'annual', envName: 'STRIPE_YEARLY_PRICE_ID', id: env.STRIPE_YEARLY_PRICE_ID, amount: PRO_PRICES.annual.amountCents, interval: 'year' },
  ];
  for (const id of String(env.STRIPE_LEGACY_YEARLY_PRICE_IDS || '').split(',').map((v) => v.trim()).filter(Boolean)) {
    list.push({ name: 'legacy annual', envName: 'STRIPE_LEGACY_YEARLY_PRICE_IDS', id, amount: LEGACY_ANNUAL_AMOUNT_CENTS, interval: 'year' });
  }
  return list;
}

export function comparePrice(expected, price) {
  const problems = [];
  if (price.currency !== PRICING_CURRENCY) problems.push(`currency ${price.currency}, expected ${PRICING_CURRENCY}`);
  if (price.unit_amount !== expected.amount) problems.push(`unit_amount ${price.unit_amount}, expected ${expected.amount}`);
  if (price.recurring?.interval !== expected.interval || (price.recurring?.interval_count ?? 1) !== 1) {
    problems.push(`interval ${price.recurring?.interval_count ?? '?'} ${price.recurring?.interval ?? 'none'}, expected 1 ${expected.interval}`);
  }
  if (expected.name !== 'legacy annual' && price.active !== true) problems.push('price is not active');
  return problems;
}

export async function checkStripePrices({ env = process.env, fetchImpl = fetch } = {}) {
  if (!env.STRIPE_SECRET_KEY) return { ok: false, results: [], error: 'STRIPE_SECRET_KEY is not set' };
  const results = [];
  for (const expected of expectedPrices(env)) {
    if (!expected.id) {
      results.push({ name: expected.name, ok: false, problems: [`${expected.envName} is not set`] });
      continue;
    }
    const response = await fetchImpl(`https://api.stripe.com/v1/prices/${encodeURIComponent(expected.id)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
    });
    if (!response.ok) {
      results.push({ name: expected.name, ok: false, problems: [`Stripe returned HTTP ${response.status}`] });
      continue;
    }
    const problems = comparePrice(expected, await response.json());
    results.push({ name: expected.name, ok: problems.length === 0, problems });
  }
  return { ok: results.every((result) => result.ok), results };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const { ok, results, error } = await checkStripePrices();
  if (error) console.error(error);
  for (const result of results) {
    console.log(`${result.ok ? 'ok  ' : 'FAIL'} ${result.name}${result.problems.length ? `: ${result.problems.join('; ')}` : ''}`);
  }
  process.exitCode = ok ? 0 : 1;
}
