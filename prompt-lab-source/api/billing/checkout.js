import {
  buildStripeConfig,
  corsRejectionResponse,
  createCheckout,
  jsonResponse,
  optionsResponse,
  parseJsonBody,
} from '../_lib/stripeBilling.js';
import { assertProductionConfig } from '../_lib/assertProductionConfig.js';
import { ClerkAuthError, verifyClerkRequest } from '../_lib/verifyClerkToken.js';
import { createNodeCompatibleHandler } from '../_lib/nodeHandler.js';
import { isExternalFetchTimeout, isFeatureEnabled } from '../_lib/runtimeSafety.js';

// Terminal response for billing-off deployments: clients must treat this as
// a final state and stop retrying. There is no checkout URL to hand back, so
// the payload keeps its existing `error` shape and adds the terminal flags.
function billingDisabledResponse(request, message) {
  return jsonResponse({
    error: message,
    billingDisabled: true,
    retryable: false,
  }, 200, {}, request);
}

function readSource(value) {
  return typeof value === 'string'
    ? value.trim().replace(/[^a-zA-Z0-9._:-]+/g, '-').slice(0, 64)
    : '';
}

async function checkoutHandler(request) {
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
  } catch {
    return billingDisabledResponse(request, 'Billing is not configured.');
  }

  let auth;
  try {
    auth = await verifyClerkRequest(request);
  } catch (error) {
    const status = error instanceof ClerkAuthError ? error.status : 401;
    return jsonResponse({ error: error.message || 'A valid Clerk session is required.' }, status, {}, request);
  }

  const body = await parseJsonBody(request);
  const period = body?.period === 'annual' ? 'annual' : 'monthly';

  try {
    const config = buildStripeConfig();
    const result = await createCheckout(config, {
      period,
      source: readSource(body?.source) || 'app',
      email: auth.clerkEmail,
      clerkUserId: auth.clerkUserId,
    });

    if (!result.checkoutUrl) {
      return jsonResponse({ error: 'Stripe did not return a checkout URL.' }, 502, {}, request);
    }

    return jsonResponse({
      ok: true,
      url: result.checkoutUrl,
      period: result.period,
      priceId: result.priceId,
      checkoutSessionId: result.checkoutSessionId,
    }, 200, {}, request);
  } catch (error) {
    return jsonResponse(
      { error: error.message || 'Could not create checkout.' },
      isExternalFetchTimeout(error) ? 504 : 500,
      {},
      request,
    );
  }
}

export default createNodeCompatibleHandler(checkoutHandler);
