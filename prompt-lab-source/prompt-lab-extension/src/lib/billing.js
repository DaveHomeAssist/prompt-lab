import { isExtension } from './platform.js';

export const PLAN_FREE = 'free';
export const PLAN_PRO = 'pro';

export const BILLING_FEATURES = Object.freeze({
  abTesting: {
    id: 'abTesting',
    label: 'A/B testing',
    description: 'Run prompt variants head-to-head inside Evaluate.',
  },
  diffView: {
    id: 'diffView',
    label: 'Diff viewer',
    description: 'Compare generated outputs side-by-side.',
  },
  batchRuns: {
    id: 'batchRuns',
    label: 'Batch runs',
    description: 'Run saved test cases in one pass.',
  },
  collections: {
    id: 'collections',
    label: 'Collections',
    description: 'Organize prompts into reusable groups.',
  },
  export: {
    id: 'export',
    label: 'Library export',
    description: 'Export your library as JSON.',
  },
});

const PRO_FEATURES = new Set(Object.keys(BILLING_FEATURES));

export function createDefaultBillingState() {
  return {
    plan: PLAN_FREE,
    status: 'free',
    licenseKey: '',
    instanceId: '',
    instanceName: '',
    billingPeriod: '',
    variantId: '',
    productName: '',
    customerEmail: '',
    customerName: '',
    lastValidatedAt: '',
    validationError: '',
    manageUrl: '',
  };
}

export function normalizeBillingState(value = {}) {
  const fallback = createDefaultBillingState();
  const plan = value?.plan === PLAN_PRO ? PLAN_PRO : PLAN_FREE;
  return {
    ...fallback,
    ...(value && typeof value === 'object' ? value : {}),
    plan,
    status: typeof value?.status === 'string' && value.status.trim() ? value.status.trim() : fallback.status,
    licenseKey: typeof value?.licenseKey === 'string' ? value.licenseKey : '',
    instanceId: typeof value?.instanceId === 'string' ? value.instanceId : '',
    instanceName: typeof value?.instanceName === 'string' ? value.instanceName : '',
    billingPeriod: typeof value?.billingPeriod === 'string' ? value.billingPeriod : '',
    variantId: typeof value?.variantId === 'string' ? value.variantId : '',
    productName: typeof value?.productName === 'string' ? value.productName : '',
    customerEmail: typeof value?.customerEmail === 'string' ? value.customerEmail : '',
    customerName: typeof value?.customerName === 'string' ? value.customerName : '',
    lastValidatedAt: typeof value?.lastValidatedAt === 'string' ? value.lastValidatedAt : '',
    validationError: typeof value?.validationError === 'string' ? value.validationError : '',
    manageUrl: typeof value?.manageUrl === 'string' ? value.manageUrl : '',
  };
}

export function canAccessFeature(plan, featureId) {
  if (!PRO_FEATURES.has(featureId)) return true;
  return plan === PLAN_PRO;
}

export function getFeatureMeta(featureId) {
  return BILLING_FEATURES[featureId] || {
    id: featureId,
    label: 'Prompt Lab Pro',
    description: 'Unlock advanced Prompt Lab workflow features.',
  };
}

export function getBillingApiBase() {
  const configuredBase = (
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_PROMPTLAB_API_BASE)
      ? String(import.meta.env.VITE_PROMPTLAB_API_BASE)
      : 'https://promptlab.tools'
  ).replace(/\/+$/, '');

  if (typeof window !== 'undefined') {
    const origin = window.location.origin || '';
    const isHostedWebOrigin = /^https?:\/\//.test(origin) && !/localhost|127\.0\.0\.1/.test(origin);
    if (isHostedWebOrigin && !isExtension) {
      return `${origin}/api`;
    }
  }

  return `${configuredBase}/api`;
}

export function buildLicenseInstanceName() {
  const runtime = isExtension
    ? 'extension'
    : (typeof window !== 'undefined' && /^https?:/.test(window.location.origin || ''))
      ? 'web'
      : 'desktop';
  const host = typeof window !== 'undefined' && window.location?.hostname
    ? window.location.hostname
    : 'local';
  return `prompt-lab-${runtime}-${host}`;
}

export function describeBillingStatus(state) {
  switch (state.status) {
    case 'active':
      return 'Pro is active on this device.';
    case 'inactive':
      return 'License is valid but not currently activated on this device.';
    case 'offline':
      return 'Could not reach billing. Cached Pro access is still available.';
    case 'expired':
      return 'This license has expired.';
    case 'disabled':
      return 'This license has been disabled.';
    case 'error':
      return state.validationError || 'Billing could not be verified.';
    default:
      return state.plan === PLAN_PRO
        ? 'Prompt Lab Pro is available.'
        : 'Free plan active. Upgrade to unlock advanced workflow features.';
  }
}

export function getPlanLabel(state) {
  if (state.plan === PLAN_PRO) {
    return state.billingPeriod === 'annual' ? 'Pro Annual' : 'Pro Monthly';
  }
  return 'Free';
}
