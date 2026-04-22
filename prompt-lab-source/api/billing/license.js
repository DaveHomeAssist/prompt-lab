export const config = { runtime: 'nodejs' };

import {
  buildStripeConfig,
  jsonResponse,
  lookupBilling,
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

function readString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

const AUTH_REQUIRED_MESSAGE = 'Sign in to manage Prompt Lab billing.';

export function createLicenseHandler(
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
    let action = 'unknown';
    let clerkIdentity = null;
    let status = 500;
    let timeout = false;
    let note = '';
    let controlState = { requestId: '', clientIp: '' };
    try {
      const body = await parseJsonBody(request);
      action = readString(body?.action).toLowerCase();

      if (!['activate', 'deactivate', 'validate'].includes(action)) {
        status = 400;
        note = 'invalid-action';
        return jsonResponse({ error: 'Unknown billing action.' }, 400);
      }

      clerkIdentity = await resolveIdentity(request);
      if (!clerkIdentity.isAuthenticated) {
        status = 401;
        note = 'auth-required';
        return jsonResponse({ error: AUTH_REQUIRED_MESSAGE }, 401);
      }

      controlState = await enforceControls({
        request,
        route: 'license',
        action,
        identity: clerkIdentity,
      });
      if (controlState.response) {
        status = controlState.status;
        note = status === 429 ? 'rate-limited' : 'guard-blocked';
        return controlState.response;
      }

      if (action === 'deactivate') {
        status = 200;
        return jsonResponse({
          ok: true,
          deactivated: true,
        });
      }

      const payload = await lookupBilling(buildStripeConfig(), {
        customerEmail: clerkIdentity.customerEmail,
        customerId: '',
      });

      if (action === 'activate' && payload.plan !== 'pro') {
        status = 404;
        note = 'no-active-plan';
        return jsonResponse({ error: 'No active Prompt Lab Pro subscription was found for this account.' }, 404);
      }

      status = 200;
      return jsonResponse({
        ok: true,
        ...payload,
      });
    } catch (error) {
      const message = error.message || 'Billing request failed.';
      timeout = isBillingTimeoutError(error);
      if (timeout) {
        await recordRouteFailure({ route: 'license', error });
        status = 504;
        note = 'timeout';
        return jsonResponse({ error: message }, 504);
      }
      status = /No active Prompt Lab Pro subscription/i.test(message) ? 404 : 400;
      note = status === 404 ? 'no-active-plan' : 'request-failed';
      return jsonResponse({ error: message }, status);
    } finally {
      logResult({
        route: 'license',
        action,
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

export default createLicenseHandler();
