import {
  buildStripeConfig,
  corsRejectionResponse,
  createPortalSessionForClerk,
  jsonResponse,
  optionsResponse,
} from '../_lib/stripeBilling.js';
import { assertProductionConfig } from '../_lib/assertProductionConfig.js';
import { ClerkAuthError, verifyClerkRequest } from '../_lib/verifyClerkToken.js';

assertProductionConfig();

export default async function handler(request) {
  if (request.method === 'OPTIONS') return optionsResponse(request);
  const corsRejection = corsRejectionResponse(request);
  if (corsRejection) return corsRejection;
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405, {}, request);
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
    return jsonResponse({ error: error.message || 'Could not create billing portal session.' }, 400, {}, request);
  }
}
