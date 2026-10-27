import test from 'node:test';
import assert from 'node:assert/strict';
import { checkStripePrices } from '../scripts/check-stripe-prices.mjs';

const env = {
  STRIPE_SECRET_KEY: 'sk_test_placeholder',
  STRIPE_MONTHLY_PRICE_ID: 'price_month',
  STRIPE_YEARLY_PRICE_ID: 'price_year',
  STRIPE_LEGACY_YEARLY_PRICE_IDS: 'price_legacy',
};
const prices = {
  price_month: { currency: 'usd', unit_amount: 900, recurring: { interval: 'month', interval_count: 1 }, active: true },
  price_year: { currency: 'usd', unit_amount: 7900, recurring: { interval: 'year', interval_count: 1 }, active: true },
  price_legacy: { currency: 'usd', unit_amount: 9900, recurring: { interval: 'year', interval_count: 1 }, active: false },
};

function fakeFetch(table, calls = []) {
  return async (url, init) => {
    calls.push({ url, method: init.method });
    const id = decodeURIComponent(url.split('/').pop());
    return table[id] ? new Response(JSON.stringify(table[id])) : new Response('{}', { status: 404 });
  };
}

test('passes when Stripe matches shared/pricing.js and only sends GETs', async () => {
  const calls = [];
  const result = await checkStripePrices({ env, fetchImpl: fakeFetch(prices, calls) });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 3);
  assert.ok(calls.every((call) => call.method === 'GET' && call.url.startsWith('https://api.stripe.com/v1/prices/')));
});

test('fails on a wrong amount, interval or inactive price', async () => {
  const result = await checkStripePrices({
    env,
    fetchImpl: fakeFetch({
      ...prices,
      price_year: { ...prices.price_year, unit_amount: 9900 },
      price_month: { ...prices.price_month, active: false, recurring: { interval: 'year' } },
    }),
  });
  assert.equal(result.ok, false);
  const byName = Object.fromEntries(result.results.map((r) => [r.name, r]));
  assert.match(byName.annual.problems.join(), /unit_amount 9900, expected 7900/);
  assert.match(byName.monthly.problems.join(), /interval/);
  assert.match(byName.monthly.problems.join(), /not active/);
  assert.equal(byName['legacy annual'].ok, true, 'legacy prices may be archived');
});

test('reports missing configuration without calling Stripe', async () => {
  const calls = [];
  assert.equal((await checkStripePrices({ env: {}, fetchImpl: fakeFetch(prices, calls) })).error, 'STRIPE_SECRET_KEY is not set');
  const partial = await checkStripePrices({ env: { STRIPE_SECRET_KEY: 'x' }, fetchImpl: fakeFetch(prices, calls) });
  assert.equal(partial.ok, false);
  assert.equal(calls.length, 0);
});
