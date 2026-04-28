export const config = { runtime: 'edge' };

import {
  buildStripeConfig,
  corsRejectionResponse,
  createCheckout,
  jsonResponse,
  optionsResponse,
  parseJsonBody,
} from '../_lib/stripeBilling.js';
import { assertProductionConfig } from '../_lib/assertProductionConfig.js';

assertProductionConfig();

export default async function handler(request) {
  if (request.method === 'OPTIONS') return optionsResponse(request);
  const corsRejection = corsRejectionResponse(request);
  if (corsRejection) return corsRejection;
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405, {}, request);
  }

  const body = await parseJsonBody(request);
  const period = body?.period === 'annual' ? 'annual' : 'monthly';

  try {
    const config = buildStripeConfig();
    const result = await createCheckout(config, {
      period,
      email: typeof body?.email === 'string' ? body.email.trim() : '',
      source: typeof body?.source === 'string' && body.source.trim() ? body.source.trim() : 'app',
      clerkUserId: typeof body?.clerkUserId === 'string' ? body.clerkUserId.trim() : '',
      deviceId: typeof body?.deviceId === 'string' ? body.deviceId.trim() : '',
      sessionId: typeof body?.sessionId === 'string' ? body.sessionId.trim() : '',
      surface: typeof body?.surface === 'string' ? body.surface.trim() : '',
      contactEmail: typeof body?.contactEmail === 'string' ? body.contactEmail.trim() : '',
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
    return jsonResponse({ error: error.message || 'Could not create checkout.' }, 500, {}, request);
  }
}
