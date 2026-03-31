export const config = { runtime: 'edge' };

import {
  buildStripeConfig,
  createCheckout,
  jsonResponse,
  optionsResponse,
  parseJsonBody,
} from '../_lib/stripeBilling.js';

export default async function handler(request) {
  if (request.method === 'OPTIONS') return optionsResponse();
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405);
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
      return jsonResponse({ error: 'Stripe did not return a checkout URL.' }, 502);
    }

    return jsonResponse({
      ok: true,
      url: result.checkoutUrl,
      period: result.period,
      priceId: result.priceId,
      checkoutSessionId: result.checkoutSessionId,
    });
  } catch (error) {
    return jsonResponse({ error: error.message || 'Could not create checkout.' }, 500);
  }
}
