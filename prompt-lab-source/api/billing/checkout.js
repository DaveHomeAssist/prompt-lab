export const config = { runtime: 'nodejs' };

import {
  buildStripeConfig,
  createCheckout,
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

export function createCheckoutHandler(
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
    let period = 'monthly';
    let clerkIdentity = null;
    let status = 500;
    let timeout = false;
    let note = '';
    let controlState = { requestId: '', clientIp: '' };
    try {
      const body = await parseJsonBody(request);
      period = body?.period === 'annual' ? 'annual' : 'monthly';
      clerkIdentity = await resolveIdentity(request);
      if (!clerkIdentity.isAuthenticated) {
        status = 401;
        note = 'auth-required';
        return jsonResponse({ error: AUTH_REQUIRED_MESSAGE }, 401);
      }

      controlState = await enforceControls({
        request,
        route: 'checkout',
        action: `checkout:${period}`,
        identity: clerkIdentity,
      });
      if (controlState.response) {
        status = controlState.status;
        note = status === 429 ? 'rate-limited' : 'guard-blocked';
        return controlState.response;
      }

      const config = buildStripeConfig();
      const result = await createCheckout(config, {
        period,
        email: clerkIdentity.customerEmail,
        source: typeof body?.source === 'string' && body.source.trim() ? body.source.trim() : 'app',
        clerkUserId: clerkIdentity.userId,
        deviceId: typeof body?.deviceId === 'string' ? body.deviceId.trim() : '',
        sessionId: typeof body?.sessionId === 'string' ? body.sessionId.trim() : '',
        surface: typeof body?.surface === 'string' ? body.surface.trim() : '',
        contactEmail: typeof body?.contactEmail === 'string' ? body.contactEmail.trim() : '',
      });

      if (!result.checkoutUrl) {
        status = 502;
        note = 'missing-checkout-url';
        return jsonResponse({ error: 'Stripe did not return a checkout URL.' }, 502);
      }

      status = 200;
      return jsonResponse({
        ok: true,
        url: result.checkoutUrl,
        period: result.period,
        priceId: result.priceId,
        checkoutSessionId: result.checkoutSessionId,
      });
    } catch (error) {
      timeout = isBillingTimeoutError(error);
      if (timeout) {
        await recordRouteFailure({ route: 'checkout', error });
      }
      status = timeout ? 504 : 500;
      note = timeout ? 'timeout' : 'request-failed';
      return jsonResponse({ error: error.message || 'Could not create checkout.' }, status);
    } finally {
      logResult({
        route: 'checkout',
        action: `checkout:${period}`,
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

export default createCheckoutHandler();
