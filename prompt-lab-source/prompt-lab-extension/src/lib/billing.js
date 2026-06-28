import { isExtension } from './platform.js';

export const PLAN_FREE = 'free';
export const PLAN_PRO = 'pro';

export const BILLING_FEATURES = Object.freeze({
  abTesting: {
    id: 'abTesting',
    label: 'A/B testing',
    description: 'Candidate paid value. Run prompt variants head-to-head inside Evaluate.',
  },
  diffView: {
    id: 'diffView',
    label: 'Diff viewer',
    description: 'Candidate paid value. Compare generated outputs side by side.',
  },
  batchRuns: {
    id: 'batchRuns',
    label: 'Batch runs',
    description: 'Candidate paid value. Run saved test cases in one pass.',
  },
  collections: {
    id: 'collections',
    label: 'Collections',
    description: 'Candidate paid value. Organize prompts into reusable groups.',
  },
  export: {
    id: 'export',
    label: 'Library export',
    description: 'Candidate paid value. Export your library as JSON.',
  },
});

const PRO_FEATURES = new Set(Object.keys(BILLING_FEATURES));

function readBooleanEnv(name, fallback = false) {
  const value = typeof import.meta !== 'undefined' ? import.meta.env?.[name] : undefined;
  if (typeof value !== 'string' || !value.trim()) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

export function isPublicProEnabled() {
  return readBooleanEnv('VITE_PROMPTLAB_PRO_CTA_ENABLED', false);
}

export function createDefaultBillingState() {
  return {
    plan: PLAN_FREE,
    status: 'free',
    clerkUserId: '',
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
    clerkUserId: typeof value?.clerkUserId === 'string' ? value.clerkUserId : '',
    customerId: typeof value?.customerId === 'string' ? value.customerId : '',
    subscriptionId: typeof value?.subscriptionId === 'string' ? value.subscriptionId : '',
    priceId: typeof value?.priceId === 'string' ? value.priceId : '',
    billingPeriod: typeof value?.billingPeriod === 'string' ? value.billingPeriod : '',
    productName: typeof value?.productName === 'string' ? value.productName : '',
    customerEmail: typeof value?.customerEmail === 'string' ? value.customerEmail : '',
    customerName: typeof value?.customerName === 'string' ? value.customerName : '',
    lastValidatedAt: typeof value?.lastValidatedAt === 'string' ? value.lastValidatedAt : '',
    validationError: typeof value?.validationError === 'string' ? value.validationError : '',
    manageUrl: typeof value?.manageUrl === 'string' ? value.manageUrl : '',
  };
}

export function canAccessFeature(plan, featureId, { proCtaEnabled = isPublicProEnabled() } = {}) {
  if (!PRO_FEATURES.has(featureId)) return true;
  if (!proCtaEnabled) return true;
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

export function describeBillingStatus(state, { proCtaEnabled = isPublicProEnabled() } = {}) {
  const hasClerkIdentity = typeof state?.clerkUserId === 'string' && state.clerkUserId.trim();
  const hasCustomerEmail = typeof state?.customerEmail === 'string' && state.customerEmail.trim();

  if (!proCtaEnabled && state.plan !== PLAN_PRO) {
    return 'Controlled beta access active. Pro stays hidden until billing and paid value are verified.';
  }

  switch (state.status) {
    case 'active':
      if (hasClerkIdentity) return 'Prompt Lab Pro is active for this signed in account.';
      if (hasCustomerEmail) return 'Prompt Lab Pro is active for this billing email.';
      return 'Prompt Lab Pro is active on this device.';
    case 'trialing':
      return 'Your Prompt Lab Pro trial is active.';
    case 'past_due':
      return 'Billing needs attention, but Pro access is still available for now.';
    case 'inactive':
      if (hasClerkIdentity) return 'This signed in account does not have an active Prompt Lab Pro subscription.';
      return 'Billing is connected, but no active Prompt Lab Pro subscription was found.';
    case 'offline':
      return 'Could not reach billing. Cached Pro access is still available.';
    case 'canceled':
      return 'This Prompt Lab Pro subscription has been canceled.';
    case 'unpaid':
      return 'The payment processor reports this subscription as unpaid.';
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
    if (state.billingPeriod === 'owner') return 'Pro Owner';
    return state.billingPeriod === 'annual' ? 'Pro Annual' : 'Pro Monthly';
  }
  return 'Free';
}
