export const config = { runtime: 'nodejs' };

import {
  buildStripeConfig,
  createPortalSession,
  jsonResponse,
  optionsResponse,
  parseJsonBody,
} from '../_lib/stripeBilling.js';
import { isBillingTimeoutError } from '../_lib/billingNetwork.js';
import { resolveClerkBillingIdentity } from '../_lib/clerkBillingAuth.js';

export default async function handler(request) {
  if (request.method === 'OPTIONS') return optionsResponse();
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405);
  }

  const body = await parseJsonBody(request);
  const clerkIdentity = await resolveClerkBillingIdentity(request);
  if (clerkIdentity.hasBearerToken && !clerkIdentity.isAuthenticated) {
    return jsonResponse({ error: 'Unauthorized billing request.' }, 401);
  }

  try {
    const payload = await createPortalSession(buildStripeConfig(), {
      customerId: clerkIdentity.isAuthenticated ? '' : (typeof body?.customerId === 'string' ? body.customerId.trim() : ''),
      customerEmail: clerkIdentity.isAuthenticated
        ? clerkIdentity.customerEmail
        : (typeof body?.customerEmail === 'string' ? body.customerEmail.trim() : ''),
    });

    return jsonResponse({
      ok: true,
      url: payload.url,
      customerId: payload.customerId,
      customerEmail: payload.customerEmail,
    });
  } catch (error) {
    const status = isBillingTimeoutError(error) ? 504 : 400;
    return jsonResponse({ error: error.message || 'Could not create billing portal session.' }, status);
  }
}
