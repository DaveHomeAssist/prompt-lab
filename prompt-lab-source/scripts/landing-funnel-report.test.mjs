import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LANDING_FUNNEL_EVENTS,
  fetchLandingFunnelCounts,
  formatLandingFunnelReport,
  resolveLandingFunnelConfig,
} from './landing-funnel-report.mjs';

test('resolves the same Redis REST environment names as telemetry storage', () => {
  assert.deepEqual(resolveLandingFunnelConfig({
    KV_REST_API_URL: 'https://example.upstash.io/',
    KV_REST_API_TOKEN: 'private-token',
    PROMPTLAB_TELEMETRY_PREFIX: 'promptlab-preview',
  }), {
    redisUrl: 'https://example.upstash.io',
    redisToken: 'private-token',
    prefix: 'promptlab-preview',
  });

  assert.deepEqual(resolveLandingFunnelConfig({
    UPSTASH_REDIS_REST_URL: 'https://fallback.upstash.io',
    UPSTASH_REDIS_REST_TOKEN: 'fallback-token',
  }), {
    redisUrl: 'https://fallback.upstash.io',
    redisToken: 'fallback-token',
    prefix: 'promptlab',
  });
});

test('rejects incomplete or unsafe storage configuration without echoing secrets', () => {
  assert.throws(
    () => resolveLandingFunnelConfig({ KV_REST_API_TOKEN: 'do-not-print-me' }),
    (error) => !error.message.includes('do-not-print-me'),
  );
  assert.throws(
    () => resolveLandingFunnelConfig({
      KV_REST_API_URL: 'http://remote.example.com',
      KV_REST_API_TOKEN: 'do-not-print-me',
    }),
    /must use HTTPS/,
  );
});

test('reads only aggregate counters for the fixed landing event allowlist', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ result: '7' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const counts = await fetchLandingFunnelCounts({
    redisUrl: 'https://example.upstash.io',
    redisToken: 'private-token',
    prefix: 'promptlab',
  }, { fetchImpl });

  assert.deepEqual(Object.keys(counts), LANDING_FUNNEL_EVENTS);
  assert.ok(Object.values(counts).every((count) => count === 7));
  assert.equal(calls.length, LANDING_FUNNEL_EVENTS.length);
  assert.ok(calls.every(({ url }) => url.includes('/get/promptlab%3Atelemetry%3Acount%3Alanding.')));
  assert.ok(calls.every(({ init }) => init.headers.Authorization === 'Bearer private-token'));
});

test('formats aggregate counts without identifiers or unexpected fields', () => {
  const report = formatLandingFunnelReport({
    'landing.referral_opened': 12,
    'landing.cta_clicked': 8,
    deviceId: 'pldev-private',
    contactEmail: 'person@example.com',
  });

  assert.match(report, /landing\.referral_opened\s+12/);
  assert.match(report, /landing\.cta_clicked\s+8/);
  assert.doesNotMatch(report, /pldev-private|person@example\.com|deviceId|contactEmail/);
});
