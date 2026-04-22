export const config = { runtime: 'nodejs' };

import {
  buildStripeConfig,
  createPortalSession,
  jsonResponse,
  optionsResponse,
  parseJsonBody,
} from '../_lib/stripeBilling.js';
import {
  enforceBillingRouteControls,
  logBillingRouteResult,
  recordBillingRouteFailure,
} from '../_lib/billingControls.js';
import { isBillingTimeoutError } from '../_lib/billingNetwork.js';
import { resolveClerkBillingIdentity } from '../_lib/clerkBillingAuth.js';

const AUTH_REQUIRED_MESSAGE = 'Sign in to manage Prompt Lab billing.';

export function createPortalHandler(
  {
    resolveIdentity = resolveClerkBillingIdentity,
    enforceControls = enforceBillingRouteControls,
    recordRouteFailure = recordBillingRouteFailure,
    logResult = logBillingRouteResult,
  } = {},
) {
  return async function handler(request) {
    if (request.method === 'OPTIONS') return optionsResponse();
    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed.' }, 405);
    }

    const startedAt = Date.now();
    let clerkIdentity = null;
    let status = 500;
    let timeout = false;
    let note = '';
    let controlState = { requestId: '', clientIp: '' };
    try {
      await parseJsonBody(request);
      clerkIdentity = await resolveIdentity(request);
      if (!clerkIdentity.isAuthenticated) {
        status = 401;
        note = 'auth-required';
        return jsonResponse({ error: AUTH_REQUIRED_MESSAGE }, 401);
      }

      controlState = await enforceControls({
        request,
        route: 'portal',
        action: 'portal',
        identity: clerkIdentity,
      });
      if (controlState.response) {
        status = controlState.status;
        note = status === 429 ? 'rate-limited' : 'guard-blocked';
        return controlState.response;
      }

      const payload = await createPortalSession(buildStripeConfig(), {
        customerId: '',
        customerEmail: clerkIdentity.customerEmail,
      });

      status = 200;
      return jsonResponse({
        ok: true,
        url: payload.url,
        customerId: payload.customerId,
        customerEmail: payload.customerEmail,
      });
    } catch (error) {
      timeout = isBillingTimeoutError(error);
      if (timeout) {
        await recordRouteFailure({ route: 'portal', error });
      }
      status = timeout ? 504 : 400;
      note = timeout ? 'timeout' : 'request-failed';
      return jsonResponse({ error: error.message || 'Could not create billing portal session.' }, status);
    } finally {
      logResult({
        route: 'portal',
        action: 'portal',
        identity: clerkIdentity,
        status,
        startedAt,
        timeout,
        requestId: controlState.requestId,
        clientIp: controlState.clientIp,
        note,
      });
    }
  };
}

export default createPortalHandler();
