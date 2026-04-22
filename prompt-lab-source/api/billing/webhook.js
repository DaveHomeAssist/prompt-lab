export const config = { runtime: 'nodejs' };

import {
  buildStripeConfig,
  buildStripeWebhookRecord,
  jsonResponse,
  optionsResponse,
  persistStripeWebhookRecord,
  verifyStripeSignature,
} from '../_lib/stripeBilling.js';

export default async function handler(request) {
  if (request.method === 'OPTIONS') return optionsResponse();
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405);
  }

  const config = buildStripeConfig();
  if (!config.webhookSecret) {
    return jsonResponse({ error: 'Stripe webhook secret is not configured.' }, 503);
  }

  const rawBody = await request.text();
  const providedSignature = request.headers.get('stripe-signature') || request.headers.get('Stripe-Signature') || '';
  const isValid = await verifyStripeSignature(rawBody, providedSignature, config.webhookSecret);
  if (!isValid) {
    return jsonResponse({ error: 'Invalid webhook signature.' }, 401);
  }

  try {
    const payload = JSON.parse(rawBody || '{}');
    const record = buildStripeWebhookRecord(payload, config);
    const result = await persistStripeWebhookRecord(record, config);
    return jsonResponse({ ok: true, mode: result.mode }, 200);
  } catch (error) {
    return jsonResponse({ error: error.message || 'Could not process webhook.' }, 400);
  }
}
