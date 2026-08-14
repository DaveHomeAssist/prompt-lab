import { isExtension } from './platform.js';

export const PLAN_FREE = 'free';
export const PLAN_PRO = 'pro';
export const BILLING_STATUS_OWNER = 'owner';

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
const ownerAccessEnabled = typeof import.meta !== 'undefined' && (
  import.meta.env?.MODE === 'test' ||
  (
    !isExtension &&
    (import.meta.env?.DEV || import.meta.env?.VITE_PROMPTLAB_OWNER_ACCESS === 'true')
  )
);
const ownerEmail = (
  typeof import.meta !== 'undefined' && import.meta.env?.VITE_PROMPTLAB_OWNER_EMAIL
    ? String(import.meta.env.VITE_PROMPTLAB_OWNER_EMAIL)
    : 'dave@promptlab.tools'
).trim().toLowerCase();

export function createDefaultBillingState() {
  return {
    plan: PLAN_FREE,
    status: 'free',
    customerId: '',
    subscriptionId: '',
    priceId: '',
    billingPeriod: '',
    productName: '',
    customerEmail: '',
    customerName: '',
    lastValidatedAt: '',
    validationError: '',
    manageUrl: '',
    billingDisabled: false,
  };
}

export function isOwnerAccessAvailable() {
  return ownerAccessEnabled;
}

export function createOwnerBillingState() {
  return normalizeBillingState({
    plan: PLAN_PRO,
    status: BILLING_STATUS_OWNER,
    billingPeriod: BILLING_STATUS_OWNER,
    productName: 'Prompt Lab Pro',
    customerEmail: ownerEmail,
    customerName: 'Dave',
    lastValidatedAt: new Date().toISOString(),
  });
}

export function isOwnerProState(state = {}) {
  return state?.plan === PLAN_PRO && (
    state?.status === BILLING_STATUS_OWNER
    || state?.billingPeriod === BILLING_STATUS_OWNER
  );
}

export function normalizeBillingState(value = {}) {
  const fallback = createDefaultBillingState();
  const plan = value?.plan === PLAN_PRO ? PLAN_PRO : PLAN_FREE;
  const status = typeof value?.status === 'string' && value.status.trim()
    ? value.status.trim()
    : fallback.status;
  const billingPeriod = typeof value?.billingPeriod === 'string' ? value.billingPeriod : '';
  // A local cache must never make a Free plan look like Owner Pro. A valid
  // owner response always carries plan: 'pro', so discard only contradictory
  // owner markers instead of promoting client-controlled state to Pro.
  const hasInvalidOwnerMarker = plan !== PLAN_PRO && (
    status === BILLING_STATUS_OWNER || billingPeriod === BILLING_STATUS_OWNER
  );
  return {
    ...fallback,
    ...(value && typeof value === 'object' ? value : {}),
    plan,
    status: hasInvalidOwnerMarker ? fallback.status : status,
    customerId: typeof value?.customerId === 'string' ? value.customerId : '',
    subscriptionId: typeof value?.subscriptionId === 'string' ? value.subscriptionId : '',
    priceId: typeof value?.priceId === 'string' ? value.priceId : '',
    billingPeriod: hasInvalidOwnerMarker ? fallback.billingPeriod : billingPeriod,
    productName: typeof value?.productName === 'string' ? value.productName : '',
    customerEmail: typeof value?.customerEmail === 'string' ? value.customerEmail : '',
    customerName: typeof value?.customerName === 'string' ? value.customerName : '',
    lastValidatedAt: typeof value?.lastValidatedAt === 'string' ? value.lastValidatedAt : '',
    validationError: typeof value?.validationError === 'string' ? value.validationError : '',
    manageUrl: typeof value?.manageUrl === 'string' ? value.manageUrl : '',
    billingDisabled: value?.billingDisabled === true,
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

export function describeBillingStatus(state) {
  if (isOwnerProState(state)) {
    return state.status === BILLING_STATUS_OWNER
      ? 'Owner Pro access is active on this device.'
      : 'Owner Pro access is active for this signed-in account.';
  }

  switch (state.status) {
    case BILLING_STATUS_OWNER:
      return 'Owner Pro access is active on this device.';
    case 'active':
      return 'Prompt Lab Pro is active for this Stripe billing email.';
    case 'trialing':
      return 'Your Prompt Lab Pro trial is active.';
    case 'past_due':
      return 'Billing needs attention, but Pro access is still available for now.';
    case 'inactive':
      return 'Billing is connected, but no active Prompt Lab Pro subscription was found.';
    case 'offline':
      return 'Could not reach billing. Cached Pro access is still available.';
    case 'canceled':
      return 'This Prompt Lab Pro subscription has been canceled.';
    case 'unpaid':
      return 'Stripe reports this subscription as unpaid.';
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
    if (isOwnerProState(state)) return 'Owner Pro';
    return state.billingPeriod === 'annual' ? 'Pro Annual' : 'Pro Monthly';
  }
  return 'Free';
}
