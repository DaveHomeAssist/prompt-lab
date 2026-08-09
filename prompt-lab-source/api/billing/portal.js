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

// Terminal response for billing-off deployments: clients must treat this as
// a final state and stop retrying. There is no portal URL to hand back, so
// the payload keeps its existing `error` shape and adds the terminal flags.
function billingDisabledResponse(request, message) {
  return jsonResponse({
    error: message,
    billingDisabled: true,
    retryable: false,
  }, 200, {}, request);
}

async function portalHandler(request) {
  if (request.method === 'OPTIONS') return optionsResponse(request);
  const corsRejection = corsRejectionResponse(request);
  if (corsRejection) return corsRejection;
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405, {}, request);
  }
  if (!isFeatureEnabled('BILLING_ENABLED')) {
    return billingDisabledResponse(request, 'Billing is disabled.');
  }
  try {
    assertProductionConfig({ clerk: true, stripe: true });
  } catch (error) {
    return billingDisabledResponse(request, error.message || 'Billing is not configured.');
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
