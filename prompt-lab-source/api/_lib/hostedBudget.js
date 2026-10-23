// Dollar budget for the hosted shared Anthropic key.
//
// The shared key draws on a monthly API credit grant, so the real limit is
// money, not request counts. Every shared-key request reserves its worst-case
// cost before it is sent, and settles to the cost Anthropic reports once the
// response finishes. A request whose usage never arrives (client abort,
// upstream timeout) keeps its reservation, so the meter only errs high.
//
// Amounts are integer micro-dollars. A rate of $X per million tokens is
// exactly X micro-dollars per token.

const DAY_MS = 24 * 60 * 60_000;
const CACHE_WRITE_5M = 1.25;
const CACHE_WRITE_1H = 2;

// USD per million tokens, checked against
// https://platform.claude.com/docs/en/about-claude/pricing on 2026-10-14.
// `cacheRead` is the cache-hit multiplier on input. `longPrompt` bills a whole
// request at higher rates once its prompt exceeds `aboveTokens`.
export const BUDGET_PRICING = Object.freeze({
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.025 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.05 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.05 },
  'claude-haiku-5-5': {
    input: 0.1, output: 0.5, cacheRead: 0.1,
    longPrompt: { aboveTokens: 100_000, input: 0.5, output: 2.5 },
  },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.1 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.1 },
  'claude-opus-4-7': { input: 5, output: 25, cacheRead: 0.1 },
  'claude-opus-4-6': { input: 5, output: 25, cacheRead: 0.1 },
  'claude-opus-4-5': { input: 5, output: 25, cacheRead: 0.1 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.1 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.1 },
  'claude-sonnet-4-5': { input: 3, output: 15, cacheRead: 0.1 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1 },
});

/** Rates for an exact catalogue id or its dated snapshot; null when unpriced. */
export function pricingFor(model) {
  if (typeof model !== 'string') return null;
  if (Object.hasOwn(BUDGET_PRICING, model)) return BUDGET_PRICING[model];
  const dated = model.match(/^(.+)-\d{8}$/);
  return dated && Object.hasOwn(BUDGET_PRICING, dated[1]) ? BUDGET_PRICING[dated[1]] : null;
}

function readUsd(env, name) {
  const raw = typeof env[name] === 'string' ? env[name].trim() : '';
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.round(value * 1e6) : null;
}

/**
 * Budget settings, or null when no cycle budget is configured.
 * HOSTED_CYCLE_BUDGET_USD: shared-key spend allowed per billing cycle.
 * HOSTED_BUDGET_CYCLE_DAY: day of month (UTC, 1 to 28) the cycle starts.
 * HOSTED_IP_DAILY_BUDGET_USD: optional spend one non-owner IP may use per UTC day.
 */
export function readBudgetConfig(env = process.env) {
  const cycleBudgetMicros = readUsd(env, 'HOSTED_CYCLE_BUDGET_USD');
  if (cycleBudgetMicros == null) return null;
  const day = Number.parseInt(String(env.HOSTED_BUDGET_CYCLE_DAY || '').trim(), 10);
  return {
    cycleBudgetMicros,
    cycleDay: Number.isInteger(day) ? Math.min(28, Math.max(1, day)) : 1,
    ipDailyMicros: readUsd(env, 'HOSTED_IP_DAILY_BUDGET_USD'),
  };
}

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

/** The billing cycle and UTC day containing `now`. */
export function budgetWindow(now, cycleDay) {
  const date = new Date(now);
  const year = date.getUTCFullYear();
  let month = date.getUTCMonth();
  if (now < Date.UTC(year, month, cycleDay)) month -= 1;
  const cycleStart = Date.UTC(year, month, cycleDay);
  const cycleEnd = Date.UTC(year, month + 1, cycleDay);
  const dayStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return {
    cycleId: isoDay(cycleStart),
    dayId: isoDay(dayStart),
    cycleEnd,
    dayEnd: dayStart + DAY_MS,
    daysRemaining: Math.max(1, Math.ceil((cycleEnd - dayStart) / DAY_MS)),
  };
}

/**
 * Worst-case cost of a text-only request: every body byte billed as an input
 * token (byte-level tokens never cover less than a byte) plus a full max_tokens.
 */
export function reservationMicros(rates, { bodyBytes, maxTokens }) {
  const input = Math.max(rates.input, rates.longPrompt?.input ?? 0);
  const output = Math.max(rates.output, rates.longPrompt?.output ?? 0);
  return Math.ceil(bodyBytes * input + maxTokens * output);
}

const count = (value) => (Number.isFinite(value) && value > 0 ? value : 0);

/** Cost of one response from the usage Anthropic reports. */
export function usageCostMicros(rates, usage) {
  const input = count(usage?.input_tokens);
  const output = count(usage?.output_tokens);
  const cacheRead = count(usage?.cache_read_input_tokens);
  const cacheWrite = count(usage?.cache_creation_input_tokens);
  const cacheWrite1h = Math.min(cacheWrite, count(usage?.cache_creation?.ephemeral_1h_input_tokens));
  const long = rates.longPrompt && input + cacheRead + cacheWrite > rates.longPrompt.aboveTokens;
  const inRate = long ? rates.longPrompt.input : rates.input;
  const outRate = long ? rates.longPrompt.output : rates.output;
  return Math.ceil(
    input * inRate
    + output * outRate
    + cacheRead * inRate * rates.cacheRead
    + (cacheWrite - cacheWrite1h) * inRate * CACHE_WRITE_5M
    + cacheWrite1h * inRate * CACHE_WRITE_1H,
  );
}

/**
 * Reserve `reserve` against the cycle, today's pace and (for non-owners) the
 * caller's IP. `incrementBy(key, amount, ttlMs)` must return the new total.
 * Owners count toward spend but are held only by the cycle ceiling.
 */
export async function reserveBudget({ config, reserve, ip, owner, now = Date.now(), incrementBy }) {
  const window = budgetWindow(now, config.cycleDay);
  const ttl = (end) => Math.max(DAY_MS, end - now + 2 * DAY_MS);
  const keys = [
    { key: `cycle:${window.cycleId}`, ttlMs: ttl(window.cycleEnd) },
    { key: `day:${window.dayId}`, ttlMs: ttl(window.dayEnd) },
    ...(!owner && config.ipDailyMicros ? [{ key: `ip:${window.dayId}:${ip}`, ttlMs: ttl(window.dayEnd) }] : []),
  ];
  const adjust = (amount) => Promise.all(keys.map(({ key, ttlMs }) => incrementBy(key, amount, ttlMs)));

  const [cycleTotal, dayTotal, ipTotal] = (await adjust(reserve)).map(Number);
  // Unspent days roll forward: today's pace is what remains of the cycle
  // before today, spread over the days left including today.
  const dayAllowance = Math.floor((config.cycleBudgetMicros - (cycleTotal - dayTotal)) / window.daysRemaining);
  let refusal = null;
  if (cycleTotal > config.cycleBudgetMicros) refusal = { scope: 'cycle', resetAt: window.cycleEnd };
  else if (!owner && dayTotal > dayAllowance) refusal = { scope: 'day', resetAt: window.dayEnd };
  else if (!owner && config.ipDailyMicros && ipTotal > config.ipDailyMicros) refusal = { scope: 'ip', resetAt: window.dayEnd };

  if (refusal) {
    await adjust(-reserve);
    return { refused: true, ...refusal };
  }
  let settled = false;
  return {
    refused: false,
    reserve,
    /** Replace the reservation with the reported cost. Runs at most once. */
    async settle(actualMicros) {
      if (settled) return;
      settled = true;
      const delta = Math.ceil(actualMicros) - reserve;
      if (delta !== 0) await adjust(delta);
    },
  };
}

/** Collects the final usage from Anthropic Messages SSE text, chunk by chunk. */
export function createSseUsageReader() {
  let buffer = '';
  let usage = null;
  const readLine = (line) => {
    if (!line.startsWith('data:')) return;
    let event;
    try { event = JSON.parse(line.slice(5).trim()); } catch { return; }
    if (event?.type === 'message_start' && event.message?.usage) usage = { ...event.message.usage };
    else if (event?.type === 'message_delta' && event.usage) usage = { ...(usage || {}), ...event.usage };
  };
  return {
    push(text) {
      buffer += text;
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) readLine(line.replace(/\r$/, ''));
    },
    finish() {
      if (buffer) readLine(buffer.replace(/\r$/, ''));
      buffer = '';
      return usage;
    },
  };
}
