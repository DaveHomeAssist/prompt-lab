export const LANDING_ATTRIBUTION_STORAGE_KEY = 'promptlab_landing_attribution';
export const LANDING_ATTRIBUTION_VERSION = 1;
export const LANDING_ATTRIBUTION_EVENT_LIMIT = 12;

const LANDING_ATTRIBUTION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const LANDING_ATTRIBUTION_CLOCK_SKEW_MS = 5 * 60 * 1000;
const LANDING_INTENT_KEYS = ['upgrade', 'period', 'source'];
const BILLING_PERIODS = new Set(['monthly', 'annual']);

const EVENT_FIELDS = {
  'landing.cta_clicked': ['placement', 'intent', 'destination', 'period'],
  'landing.demo_completed': ['placement', 'intent', 'destination', 'demoMode', 'resultCount'],
  'landing.surface_selected': ['placement', 'intent', 'destination'],
  'landing.pricing_period_selected': ['placement', 'intent', 'period'],
  'landing.docs_result_selected': ['placement', 'intent', 'destination', 'resultCount'],
};

const REQUIRED_EVENT_FIELDS = {
  'landing.cta_clicked': ['placement', 'intent', 'destination'],
  'landing.demo_completed': ['placement', 'intent', 'destination', 'demoMode', 'resultCount'],
  'landing.surface_selected': ['placement', 'intent', 'destination'],
  'landing.pricing_period_selected': ['placement', 'period'],
  'landing.docs_result_selected': ['placement', 'destination', 'resultCount'],
};

const ALLOWED_VALUES = {
  placement: new Set([
    'nav',
    'nav_mobile',
    'mobile_menu',
    'hero',
    'surface_web',
    'surface_extension',
    'surface_desktop',
    'demo',
    'pricing_free',
    'pricing_pro',
    'final_cta',
    'footer',
    'docs_search',
  ]),
  intent: new Set([
    'open',
    'free',
    'upgrade',
    'sample',
  ]),
  destination: new Set([
    'app',
    'demo',
    'setup',
    'source',
    'guide',
  ]),
  period: BILLING_PERIODS,
  demoMode: new Set(['balanced', 'concise', 'detailed']),
};

export function parseLandingIntent(search = '') {
  let params;
  try {
    params = new URLSearchParams(String(search).replace(/^\?/, ''));
  } catch {
    return null;
  }

  if (LANDING_INTENT_KEYS.some((key) => params.getAll(key).length !== 1)) return null;

  const period = params.get('period');
  if (
    params.get('upgrade') !== 'pro'
    || params.get('source') !== 'landing-pricing'
    || !BILLING_PERIODS.has(period)
  ) {
    return null;
  }

  return {
    upgrade: 'pro',
    period,
    source: 'landing-pricing',
  };
}

export function buildLandingIntentRedirectUrl(urlLike, intent) {
  const safeIntent = normalizeLandingIntent(intent);
  if (!safeIntent) return '';

  try {
    const url = new URL(String(urlLike));
    LANDING_INTENT_KEYS.forEach((key) => url.searchParams.delete(key));
    url.searchParams.set('upgrade', safeIntent.upgrade);
    url.searchParams.set('period', safeIntent.period);
    url.searchParams.set('source', safeIntent.source);
    return url.toString();
  } catch {
    return '';
  }
}

export function stripLandingIntentParams(urlLike) {
  try {
    const url = new URL(String(urlLike));
    LANDING_INTENT_KEYS.forEach((key) => url.searchParams.delete(key));
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '';
  }
}

export function sanitizeLandingAttribution(value, { now = Date.now() } = {}) {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }

  if (
    !parsed
    || typeof parsed !== 'object'
    || parsed.version !== LANDING_ATTRIBUTION_VERSION
    || !Array.isArray(parsed.events)
  ) {
    return null;
  }

  const events = parsed.events
    .slice(-LANDING_ATTRIBUTION_EVENT_LIMIT)
    .map((event) => sanitizeLandingAttributionEvent(event, now))
    .filter(Boolean);

  if (events.length === 0) return null;
  return { version: LANDING_ATTRIBUTION_VERSION, events };
}

export function readLandingAttribution(storage, options) {
  if (!storage || typeof storage.getItem !== 'function') return null;
  try {
    return sanitizeLandingAttribution(storage.getItem(LANDING_ATTRIBUTION_STORAGE_KEY), options);
  } catch {
    return null;
  }
}

export function clearLandingAttribution(storage) {
  if (!storage || typeof storage.removeItem !== 'function') return false;
  try {
    storage.removeItem(LANDING_ATTRIBUTION_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function buildLandingTelemetryEvents({ landingIntent, landingAttribution, now = Date.now() } = {}) {
  const safeIntent = normalizeLandingIntent(landingIntent);
  const safeAttribution = sanitizeLandingAttribution(landingAttribution, { now });
  const storedEvents = safeAttribution?.events || [];
  if (!safeIntent && storedEvents.length === 0) return [];

  const latestEvent = storedEvents.at(-1);
  const reportableStoredEvents = storedEvents.slice(-(LANDING_ATTRIBUTION_EVENT_LIMIT - 1));
  const referralContext = compactObject({
    attributionVersion: LANDING_ATTRIBUTION_VERSION,
    placement: latestEvent?.placement || (safeIntent ? 'pricing_pro' : undefined),
    intent: latestEvent?.intent || (safeIntent ? 'upgrade' : undefined),
    destination: latestEvent?.destination || 'app',
    period: safeIntent?.period || latestEvent?.period,
    timestamp: latestEvent?.timestamp,
  });

  const events = [
    { event: 'landing.referral_opened', context: referralContext },
    ...reportableStoredEvents.map(({ event, ...context }) => {
      const pricingPeriod = safeIntent
        && event === 'landing.cta_clicked'
        && context.placement === 'pricing_pro'
        ? safeIntent.period
        : context.period;
      return {
        event,
        context: compactObject({
          attributionVersion: LANDING_ATTRIBUTION_VERSION,
          ...context,
          period: pricingPeriod,
        }),
      };
    }),
  ];

  if (safeIntent && !reportableStoredEvents.some((entry) => entry.event === 'landing.cta_clicked')) {
    events.splice(1, 0, {
      event: 'landing.cta_clicked',
      context: {
        attributionVersion: LANDING_ATTRIBUTION_VERSION,
        placement: 'pricing_pro',
        intent: 'upgrade',
        destination: 'app',
        period: safeIntent.period,
      },
    });
  }

  return events.slice(0, LANDING_ATTRIBUTION_EVENT_LIMIT);
}

export function normalizeLandingIntent(value) {
  if (!value || typeof value !== 'object') return null;
  if (
    value.upgrade !== 'pro'
    || value.source !== 'landing-pricing'
    || !BILLING_PERIODS.has(value.period)
  ) {
    return null;
  }
  return {
    upgrade: 'pro',
    period: value.period,
    source: 'landing-pricing',
  };
}

function sanitizeLandingAttributionEvent(value, now) {
  if (!value || typeof value !== 'object' || !EVENT_FIELDS[value.event]) return null;

  const timestamp = value.timestamp;
  if (
    typeof timestamp !== 'number'
    || !Number.isSafeInteger(timestamp)
    || timestamp < now - LANDING_ATTRIBUTION_MAX_AGE_MS
    || timestamp > now + LANDING_ATTRIBUTION_CLOCK_SKEW_MS
  ) {
    return null;
  }

  const event = { event: value.event, timestamp };
  EVENT_FIELDS[value.event].forEach((field) => {
    const normalized = normalizeAttributionField(field, value[field]);
    if (normalized !== undefined) event[field] = normalized;
  });

  const requiredFields = REQUIRED_EVENT_FIELDS[value.event];
  if (requiredFields.some((field) => event[field] === undefined)) return null;
  return event;
}

function normalizeAttributionField(field, value) {
  if (field === 'resultCount') {
    if (typeof value !== 'number') return undefined;
    const count = value;
    if (!Number.isSafeInteger(count)) return undefined;
    return Math.max(0, Math.min(50, count));
  }
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return ALLOWED_VALUES[field]?.has(normalized) ? normalized : undefined;
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}
