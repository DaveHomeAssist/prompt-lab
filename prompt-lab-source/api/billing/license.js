export const config = { runtime: 'nodejs' };

import {
  buildStripeConfig,
  jsonResponse,
  lookupBilling,
  optionsResponse,
  parseJsonBody,
} from '../_lib/stripeBilling.js';
import { isBillingTimeoutError } from '../_lib/billingNetwork.js';
import { resolveClerkBillingIdentity } from '../_lib/clerkBillingAuth.js';

function readString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export default async function handler(request) {
  if (request.method === 'OPTIONS') return optionsResponse();
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405);
  }

  const body = await parseJsonBody(request);
  const action = readString(body?.action).toLowerCase();
  const customerEmail = readString(body?.customerEmail || body?.licenseKey).toLowerCase();
  const customerId = readString(body?.customerId || body?.instanceId);

  if (!['activate', 'deactivate', 'validate'].includes(action)) {
    return jsonResponse({ error: 'Unknown billing action.' }, 400);
  }

  if (action === 'deactivate') {
    return jsonResponse({
      ok: true,
      deactivated: true,
    });
  }

  const clerkIdentity = await resolveClerkBillingIdentity(request);
  if (clerkIdentity.hasBearerToken && !clerkIdentity.isAuthenticated) {
    return jsonResponse({ error: 'Unauthorized billing request.' }, 401);
  }

  const effectiveCustomerEmail = clerkIdentity.isAuthenticated ? clerkIdentity.customerEmail : customerEmail;
  const effectiveCustomerId = clerkIdentity.isAuthenticated ? '' : customerId;

  if (!effectiveCustomerEmail && !effectiveCustomerId) {
    return jsonResponse({ error: 'The Stripe billing email is required.' }, 400);
  }

  try {
    const payload = await lookupBilling(buildStripeConfig(), {
      customerEmail: effectiveCustomerEmail,
      customerId: effectiveCustomerId,
    });

    if (action === 'activate' && payload.plan !== 'pro') {
      return jsonResponse({ error: 'No active Prompt Lab Pro subscription was found for this Stripe billing email.' }, 404);
    }

    return jsonResponse({
      ok: true,
      ...payload,
    });
  } catch (error) {
    const message = error.message || 'Billing request failed.';
    if (isBillingTimeoutError(error)) {
      return jsonResponse({ error: message }, 504);
    }
    const status = /No active Prompt Lab Pro subscription/i.test(message) ? 404 : 400;
    return jsonResponse({ error: message }, status);
  }
}
