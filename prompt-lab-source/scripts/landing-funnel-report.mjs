import { pathToFileURL } from 'node:url';

export const LANDING_FUNNEL_EVENTS = [
  'landing.referral_opened',
  'landing.cta_clicked',
  'landing.demo_completed',
  'landing.surface_selected',
  'landing.pricing_period_selected',
  'landing.docs_result_selected',
];

const DEFAULT_PREFIX = 'promptlab';
const REQUEST_TIMEOUT_MS = 10_000;

export function resolveLandingFunnelConfig(env = process.env) {
  const redisUrl = readFirst(env, 'KV_REST_API_URL', 'UPSTASH_REDIS_REST_URL').replace(/\/+$/, '');
  const redisToken = readFirst(env, 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_TOKEN');
  const prefix = readFirst(env, 'PROMPTLAB_TELEMETRY_PREFIX') || DEFAULT_PREFIX;

  if (!redisUrl || !redisToken) {
    throw new Error(
      'Telemetry storage is not configured. Set KV_REST_API_URL and KV_REST_API_TOKEN '
      + '(or the UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN equivalents).',
    );
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(redisUrl);
  } catch {
    throw new Error('Telemetry storage URL is invalid.');
  }

  const localHost = parsedUrl.hostname === 'localhost' || parsedUrl.hostname === '127.0.0.1';
  if (parsedUrl.protocol !== 'https:' && !(localHost && parsedUrl.protocol === 'http:')) {
    throw new Error('Telemetry storage URL must use HTTPS (HTTP is allowed only for localhost).');
  }
  if (!/^[a-zA-Z0-9._:-]{1,80}$/.test(prefix)) {
    throw new Error('PROMPTLAB_TELEMETRY_PREFIX contains unsupported characters.');
  }

  return { redisUrl, redisToken, prefix };
}

export async function fetchLandingFunnelCounts(config, { fetchImpl = fetch } = {}) {
  if (!config?.redisUrl || !config?.redisToken || !config?.prefix) {
    throw new Error('A complete telemetry storage configuration is required.');
  }

  const entries = await Promise.all(LANDING_FUNNEL_EVENTS.map(async (event) => {
    const key = `${config.prefix}:telemetry:count:${event}`;
    const count = await fetchAggregateCount(config, key, fetchImpl);
    return [event, count];
  }));
  return Object.fromEntries(entries);
}

export function formatLandingFunnelReport(counts) {
  const lines = ['Prompt Lab landing funnel (aggregate event counts)'];
  LANDING_FUNNEL_EVENTS.forEach((event) => {
    const value = Number(counts?.[event]);
    const count = Number.isSafeInteger(value) && value >= 0 ? value : 0;
    lines.push(`${event.padEnd(38)} ${String(count).padStart(8)}`);
  });
  return `${lines.join('\n')}\n`;
}

export async function runLandingFunnelReport({ env = process.env, fetchImpl = fetch } = {}) {
  const config = resolveLandingFunnelConfig(env);
  const counts = await fetchLandingFunnelCounts(config, { fetchImpl });
  return formatLandingFunnelReport(counts);
}

async function fetchAggregateCount(config, key, fetchImpl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const url = `${config.redisUrl}/get/${encodeURIComponent(key)}`;
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${config.redisToken}` },
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.error) {
      throw new Error(`Telemetry storage returned HTTP ${response.status}.`);
    }
    const count = Number(payload?.result ?? 0);
    return Number.isSafeInteger(count) && count >= 0 ? count : 0;
  } finally {
    clearTimeout(timeout);
  }
}

function readFirst(env, ...names) {
  for (const name of names) {
    const value = env?.[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function printHelp() {
  process.stdout.write([
    'Usage: node scripts/landing-funnel-report.mjs',
    '',
    'Reads only aggregate landing event counters from Prompt Lab telemetry storage.',
    'Requires KV_REST_API_URL + KV_REST_API_TOKEN, or the equivalent UPSTASH variables.',
    'Optional: PROMPTLAB_TELEMETRY_PREFIX (default: promptlab).',
    '',
  ].join('\n'));
}

const isDirectRun = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printHelp();
  } else {
    runLandingFunnelReport()
      .then((report) => process.stdout.write(report))
      .catch((error) => {
        process.stderr.write(`Landing funnel report failed: ${error.message}\n`);
        process.exitCode = 1;
      });
  }
}
