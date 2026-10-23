import test from 'node:test';
import assert from 'node:assert/strict';

import {
  budgetWindow,
  createSseUsageReader,
  pricingFor,
  readBudgetConfig,
  reservationMicros,
  reserveBudget,
  usageCostMicros,
} from '../api/_lib/hostedBudget.js';

const OCT_22 = Date.UTC(2026, 9, 22, 18, 0);

function memoryStore() {
  const totals = new Map();
  return {
    totals,
    incrementBy: async (key, amount) => {
      const next = (totals.get(key) ?? 0) + amount;
      totals.set(key, next);
      return next;
    },
  };
}

test('pricing covers exact and dated ids only, at published rates', () => {
  const sonnet = pricingFor('claude-sonnet-4-6');
  assert.deepEqual(sonnet, { input: 3, output: 15, cacheRead: 0.1 });
  assert.equal(pricingFor('claude-sonnet-4-6-20260101'), sonnet);
  assert.equal(pricingFor('claude-sonnet-4-6-preview'), null);
  assert.equal(pricingFor('gpt-5.6-sol'), null);
  // $X per MTok is X micro-dollars per token.
  assert.equal(usageCostMicros(sonnet, { input_tokens: 1000, output_tokens: 100 }), 1000 * 3 + 100 * 15);
  assert.equal(usageCostMicros(pricingFor('claude-opus-5-5'), {
    input_tokens: 1000, output_tokens: 0, cache_read_input_tokens: 1000, cache_creation_input_tokens: 1000,
    cache_creation: { ephemeral_1h_input_tokens: 400 },
  }), 1000 * 4 + 1000 * 4 * 0.05 + 600 * 4 * 1.25 + 400 * 4 * 2);
  const haiku = pricingFor('claude-haiku-5-5');
  assert.equal(usageCostMicros(haiku, { input_tokens: 100_000, output_tokens: 10 }), Math.ceil(100_000 * 0.1 + 10 * 0.5));
  assert.equal(usageCostMicros(haiku, { input_tokens: 100_001, output_tokens: 10 }), Math.ceil(100_001 * 0.5 + 10 * 2.5));
  assert.equal(reservationMicros(haiku, { bodyBytes: 10, maxTokens: 10 }), 10 * 0.5 + 10 * 2.5);
});

test('config reads dollars as micro-dollars and clamps the cycle day', () => {
  assert.equal(readBudgetConfig({}), null);
  assert.equal(readBudgetConfig({ HOSTED_CYCLE_BUDGET_USD: '0' }), null);
  assert.deepEqual(readBudgetConfig({ HOSTED_CYCLE_BUDGET_USD: '180', HOSTED_BUDGET_CYCLE_DAY: '31', HOSTED_IP_DAILY_BUDGET_USD: '0.5' }), {
    cycleBudgetMicros: 180_000_000, cycleDay: 28, ipDailyMicros: 500_000,
  });
});

test('the cycle follows the billing day across months and years', () => {
  const october = budgetWindow(OCT_22, 14);
  assert.equal(october.cycleId, '2026-10-14');
  assert.equal(october.dayId, '2026-10-22');
  assert.equal(new Date(october.cycleEnd).toISOString(), '2026-11-14T00:00:00.000Z');
  assert.equal(october.daysRemaining, 23);
  assert.equal(budgetWindow(Date.UTC(2026, 10, 13, 23), 14).cycleId, '2026-10-14');
  assert.equal(budgetWindow(Date.UTC(2026, 10, 13, 23), 14).daysRemaining, 1);
  assert.equal(budgetWindow(Date.UTC(2027, 0, 5), 14).cycleId, '2026-12-14');
});

test('daily pace spreads the remaining cycle budget and refunds a refusal', async () => {
  const store = memoryStore();
  const config = { cycleBudgetMicros: 23_000_000, cycleDay: 14, ipDailyMicros: null };
  const reserve = (amount, extra = {}) => reserveBudget({ config, reserve: amount, ip: '1', owner: false, now: OCT_22, incrementBy: store.incrementBy, ...extra });
  // 23 days left: $1.00 a day.
  const ok = await reserve(600_000);
  assert.equal(ok.refused, false);
  const over = await reserve(500_000);
  assert.deepEqual({ refused: over.refused, scope: over.scope }, { refused: true, scope: 'day' });
  assert.equal(store.totals.get('day:2026-10-22'), 600_000);
  // Settling to the real cost frees the rest of today's pace.
  await ok.settle(100_000);
  await ok.settle(0);
  assert.equal(store.totals.get('day:2026-10-22'), 100_000);
  assert.equal((await reserve(500_000)).refused, false);
  // Owners are held only by the cycle ceiling.
  assert.equal((await reserve(5_000_000, { owner: true })).refused, false);
  assert.equal((await reserve(30_000_000, { owner: true })).scope, 'cycle');
});

test('unspent days roll forward and past spend shrinks today\'s pace', async () => {
  const config = { cycleBudgetMicros: 23_000_000, cycleDay: 14, ipDailyMicros: null };
  // Two days left with nothing spent: half the cycle is available today.
  const quiet = memoryStore();
  const nov12 = Date.UTC(2026, 10, 12, 9);
  assert.equal((await reserveBudget({ config, reserve: 11_000_000, ip: '1', owner: false, now: nov12, incrementBy: quiet.incrementBy })).refused, false);
  // $20 already spent before today: $3 over 23 days is about 13 cents.
  const busy = memoryStore();
  busy.totals.set('cycle:2026-10-14', 20_000_000);
  const late = await reserveBudget({ config, reserve: 200_000, ip: '1', owner: false, now: OCT_22, incrementBy: busy.incrementBy });
  assert.equal(late.scope, 'day');
  assert.equal(busy.totals.get('cycle:2026-10-14'), 20_000_000);
});

test('the per-IP cap applies to visitors only', async () => {
  const store = memoryStore();
  const config = { cycleBudgetMicros: 180_000_000, cycleDay: 14, ipDailyMicros: 500_000 };
  const call = (ip, owner = false) => reserveBudget({ config, reserve: 300_000, ip, owner, now: OCT_22, incrementBy: store.incrementBy });
  assert.equal((await call('a')).refused, false);
  assert.equal((await call('a')).scope, 'ip');
  assert.equal((await call('b')).refused, false);
  assert.equal((await call('a', true)).refused, false);
});

test('SSE usage survives events split across chunks', () => {
  const reader = createSseUsageReader();
  const start = `data: ${JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 12, cache_read_input_tokens: 3, output_tokens: 1 } } })}\n\n`;
  const delta = `data: ${JSON.stringify({ type: 'message_delta', usage: { output_tokens: 40 } })}\r\n\r\n`;
  const text = start + 'data: not json\n' + delta;
  for (let i = 0; i < text.length; i += 7) reader.push(text.slice(i, i + 7));
  assert.deepEqual(reader.finish(), { input_tokens: 12, cache_read_input_tokens: 3, output_tokens: 40 });
  assert.equal(createSseUsageReader().finish(), null);
});
