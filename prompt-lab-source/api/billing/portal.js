import {
  buildStripeConfig,
  corsRejectionResponse,
  createPortalSessionForClerk,
  jsonResponse,
  optionsResponse,
} from '../_lib/stripeBilling.js';
import { assertProductionConfig } from '../_lib/assertProductionConfig.js';
import { ClerkAuthError, verifyClerkRequest } from '../_lib/verifyClerkToken.js';
import { createNodeCompatibleHandler } from '../_lib/nodeHandler.js';
import { isExternalFetchTimeout, isFeatureEnabled } from '../_lib/runtimeSafety.js';

async function portalHandler(request) {
  if (request.method === 'OPTIONS') return optionsResponse(request);
  const corsRejection = corsRejectionResponse(request);
  if (corsRejection) return corsRejection;
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405, {}, request);
  }
  if (!isFeatureEnabled('BILLING_ENABLED')) {
    return jsonResponse({ error: 'Billing is disabled.' }, 503, {}, request);
  }
  try {
    assertProductionConfig({ clerk: true, stripe: true });
  } catch (error) {
    return jsonResponse({ error: error.message || 'Billing is not configured.' }, 503, {}, request);
  }

  let auth;
  try {
    auth = await verifyClerkRequest(request);
  } catch (error) {
    const status = error instanceof ClerkAuthError ? error.status : 401;
    return jsonResponse({ error: error.message || 'A valid Clerk session is required.' }, status, {}, request);
  }

  try {
    const payload = await createPortalSessionForClerk(buildStripeConfig(), {
      clerkUserId: auth.clerkUserId,
      clerkEmail: auth.clerkEmail,
    });

    return jsonResponse({
      ok: true,
      url: payload.url,
      customerId: payload.customerId,
      customerEmail: payload.customerEmail,
    }, 200, {}, request);
  } catch (error) {
    const status = isExternalFetchTimeout(error) ? 504 : 400;
    return jsonResponse({ error: error.message || 'Could not create billing portal session.' }, status, {}, request);
  }
}

export default createNodeCompatibleHandler(portalHandler);
