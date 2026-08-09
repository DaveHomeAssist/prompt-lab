const LANDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const LANDING_CLOCK_SKEW_MS = 5 * 60 * 1000;

const enumField = (...values) => ({ type: 'enum', values: new Set(values) });
const integerField = (max) => ({ type: 'integer', min: 0, max });
const booleanField = { type: 'boolean' };
const timestampField = { type: 'timestamp' };

const PLAN = enumField('free', 'pro');
const SURFACE = enumField('extension', 'web', 'desktop');
const SECTION = enumField('create', 'library', 'evaluate');
const BILLING_PERIOD = enumField('monthly', 'annual', 'owner');
const BILLING_STATUS = enumField(
  'free',
  'active',
  'canceled',
  'inactive',
  'past_due',
  'trialing',
  'unpaid',
  'incomplete',
  'incomplete_expired',
  'paused',
  'offline',
  'error',
  'owner',
);
const FEATURE = enumField('general', 'export', 'collections', 'batchRuns', 'diffView', 'abTesting');
const CHECKOUT_SOURCE = enumField(
  'billing-modal',
  'landing-pricing',
  'export',
  'collections',
  'batchRuns',
  'diffView',
  'abTesting',
);
const LANDING_PLACEMENT = enumField(
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
  'privacy',
);
const LANDING_INTENT = enumField('open', 'free', 'upgrade', 'sample');
const LANDING_DESTINATION = enumField('app', 'demo', 'setup', 'source', 'guide', 'privacy');
const ATTRIBUTION_VERSION = enumField(1);

function schema(fields, required = []) {
  return Object.freeze({ fields: Object.freeze(fields), required: Object.freeze(required) });
}

const LANDING_BASE_FIELDS = Object.freeze({
  attributionVersion: ATTRIBUTION_VERSION,
  placement: LANDING_PLACEMENT,
  intent: LANDING_INTENT,
  destination: LANDING_DESTINATION,
  period: enumField('monthly', 'annual'),
  timestamp: timestampField,
});

export const TELEMETRY_EVENT_SCHEMAS = Object.freeze({
  'app.opened': schema({ section: SECTION, surface: SURFACE, libraryCount: integerField(100_000), plan: PLAN }),
  'billing.checkout_started': schema({ period: enumField('monthly', 'annual'), source: CHECKOUT_SOURCE, surface: SURFACE }),
  'billing.feature_blocked': schema({ featureId: FEATURE, plan: PLAN }),
  'billing.license_activated': schema({ plan: PLAN, status: BILLING_STATUS, billingPeriod: BILLING_PERIOD }),
  'billing.license_deactivated': schema({ plan: PLAN }),
  'billing.license_validated': schema({ plan: PLAN, status: BILLING_STATUS, billingPeriod: BILLING_PERIOD }),
  'billing.modal_opened': schema({ featureId: FEATURE, plan: PLAN, section: SECTION }),
  'billing.owner_access_activated': schema({ plan: PLAN, status: BILLING_STATUS }),
  'billing.portal_opened': schema({ plan: PLAN }),
  'composer.block_added': schema({ source: enumField('library', 'follow-up'), plan: PLAN }),
  'editor.enhance_requested': schema({
    mode: enumField('balanced', 'claude', 'chatgpt', 'image', 'code', 'concise', 'detailed'),
    inputLength: integerField(1_000_000),
    wordCount: integerField(200_000),
    editing: booleanField,
    plan: PLAN,
  }),
  'evaluate.abtest_prompt_sent': schema({ side: enumField('a', 'b'), plan: PLAN }),
  'evaluate.batch_runs_requested': schema({ testCaseCount: integerField(10_000), plan: PLAN }),
  'evaluate.compare_opened': schema({ plan: PLAN }),
  'evaluate.quick_start_requested': schema({ plan: PLAN }),
  'followups.loaded_into_editor': schema({ plan: PLAN }),
  'identity.updated': schema({ source: enumField('preferences'), telemetryEnabled: booleanField }, ['source', 'telemetryEnabled']),
  'landing.cta_clicked': schema({ ...LANDING_BASE_FIELDS }, ['attributionVersion', 'placement', 'intent', 'destination']),
  'landing.demo_completed': schema({
    ...LANDING_BASE_FIELDS,
    demoMode: enumField('balanced', 'concise', 'detailed'),
    resultCount: integerField(50),
  }, ['attributionVersion', 'placement', 'intent', 'destination', 'demoMode', 'resultCount']),
  'landing.docs_result_selected': schema({
    ...LANDING_BASE_FIELDS,
    resultCount: integerField(50),
  }, ['attributionVersion', 'placement', 'destination', 'resultCount']),
  'landing.pricing_period_selected': schema({ ...LANDING_BASE_FIELDS }, ['attributionVersion', 'placement', 'period']),
  'landing.referral_opened': schema({ ...LANDING_BASE_FIELDS }, ['attributionVersion', 'placement', 'intent', 'destination']),
  'landing.surface_selected': schema({ ...LANDING_BASE_FIELDS }, ['attributionVersion', 'placement', 'intent', 'destination']),
  'library.export_requested': schema({ promptCount: integerField(100_000), plan: PLAN }),
  'library.prompt_loaded': schema({ source: enumField('library', 'create'), hasCollection: booleanField, plan: PLAN }),
  'library.prompt_saved': schema({
    plan: PLAN,
    via: enumField('inline', 'save-panel'),
    isVersion: booleanField,
    hasCollection: booleanField,
  }),
  'navigation.section_changed': schema({
    section: SECTION,
    runsView: enumField('history', 'compare'),
    workspaceView: enumField('editor', 'library', 'composer'),
    plan: PLAN,
  }),
  'workbench.activation_evaluate_opened': schema({
    plan: PLAN,
    libraryCount: integerField(100_000),
    evalRunCount: integerField(100_000),
  }),
});

export class TelemetrySchemaError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TelemetrySchemaError';
  }
}

export function normalizeTelemetryEventName(value) {
  return String(value || '').trim().toLowerCase();
}

export function isLandingTelemetryEvent(value) {
  return normalizeTelemetryEventName(value).startsWith('landing.');
}

export function sanitizeTelemetryEventContext(eventName, value, { now = Date.now() } = {}) {
  const normalizedEvent = normalizeTelemetryEventName(eventName);
  const eventSchema = TELEMETRY_EVENT_SCHEMAS[normalizedEvent];
  if (!eventSchema) {
    throw new TelemetrySchemaError('A supported telemetry event is required.');
  }

  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const output = {};
  for (const [field, descriptor] of Object.entries(eventSchema.fields)) {
    const normalized = normalizeField(input[field], descriptor, now);
    if (normalized !== undefined) output[field] = normalized;
  }

  const missing = eventSchema.required.filter((field) => output[field] === undefined);
  if (missing.length > 0) {
    throw new TelemetrySchemaError(`Telemetry context is missing required fields: ${missing.join(', ')}.`);
  }
  return output;
}

function normalizeField(value, descriptor, now) {
  if (descriptor.type === 'enum') {
    if (typeof value === 'number') return descriptor.values.has(value) ? value : undefined;
    const normalized = typeof value === 'string' ? value.trim() : '';
    return descriptor.values.has(normalized) ? normalized : undefined;
  }
  if (descriptor.type === 'boolean') {
    return typeof value === 'boolean' ? value : undefined;
  }
  if (descriptor.type === 'integer') {
    if (!Number.isSafeInteger(value)) return undefined;
    return Math.min(descriptor.max, Math.max(descriptor.min, value));
  }
  if (descriptor.type === 'timestamp') {
    if (!Number.isSafeInteger(value)) return undefined;
    if (value < now - LANDING_MAX_AGE_MS || value > now + LANDING_CLOCK_SKEW_MS) return undefined;
    return value;
  }
  return undefined;
}
