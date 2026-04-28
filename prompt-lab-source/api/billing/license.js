import {
  buildStripeConfig,
  corsRejectionResponse,
  jsonResponse,
  lookupBillingForClerk,
  optionsResponse,
  parseJsonBody,
} from '../_lib/stripeBilling.js';
import { assertProductionConfig } from '../_lib/assertProductionConfig.js';
import { ClerkAuthError, verifyClerkRequest } from '../_lib/verifyClerkToken.js';

assertProductionConfig();

function readString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

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

  const body = await parseJsonBody(request);
  const action = readString(body?.action).toLowerCase();

  if (!['activate', 'deactivate', 'validate'].includes(action)) {
    return jsonResponse({ error: 'Unknown billing action.' }, 400, {}, request);
  }

  if (action === 'deactivate') {
    return jsonResponse({
      ok: true,
      deactivated: true,
    }, 200, {}, request);
  }

  try {
    const payload = await lookupBillingForClerk(buildStripeConfig(), {
      clerkUserId: auth.clerkUserId,
      clerkEmail: auth.clerkEmail,
    });

    if (action === 'activate' && payload.plan !== 'pro') {
      return jsonResponse({ error: 'No active Prompt Lab Pro subscription was found for this signed-in account.' }, 404, {}, request);
    }

    return jsonResponse({
      ok: true,
      ...payload,
    }, 200, {}, request);
  } catch (error) {
    const message = error.message || 'Billing request failed.';
    const status = /No active Prompt Lab Pro subscription/i.test(message) ? 404 : 400;
    return jsonResponse({ error: message }, status, {}, request);
  }
}
