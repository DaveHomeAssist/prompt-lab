import {
  buildStripeConfig,
  buildStripeWebhookRecord,
  corsRejectionResponse,
  jsonResponse,
  optionsResponse,
  persistStripeWebhookRecord,
  verifyStripeSignature,
} from '../_lib/stripeBilling.js';
import { assertProductionConfig } from '../_lib/assertProductionConfig.js';
import { createNodeCompatibleHandler } from '../_lib/nodeHandler.js';
import { isExternalFetchTimeout, isFeatureEnabled } from '../_lib/runtimeSafety.js';

async function webhookHandler(request) {
  if (request.method === 'OPTIONS') return optionsResponse(request);
  const corsRejection = corsRejectionResponse(request);
  if (corsRejection) return corsRejection;
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405, {}, request);
  }
  if (!isFeatureEnabled('BILLING_ENABLED')) {
    return jsonResponse({ error: 'Billing is disabled.' }, 503, {}, request);
  }
  try {
    assertProductionConfig({ stripe: true, webhook: true, durableStore: true });
  } catch (error) {
    return jsonResponse({ error: error.message || 'Billing is not configured.' }, 503, {}, request);
  }

  const config = buildStripeConfig();
  if (!config.webhookSecret) {
    return jsonResponse({ error: 'Stripe webhook secret is not configured.' }, 503, {}, request);
  }

  const rawBody = await request.text();
  const providedSignature = request.headers.get('stripe-signature') || request.headers.get('Stripe-Signature') || '';
  const isValid = await verifyStripeSignature(rawBody, providedSignature, config.webhookSecret);
  if (!isValid) {
    return jsonResponse({ error: 'Invalid webhook signature.' }, 401, {}, request);
  }

  try {
    const payload = JSON.parse(rawBody || '{}');
    const record = buildStripeWebhookRecord(payload, config);
    const result = await persistStripeWebhookRecord(record, config);
    return jsonResponse({ ok: true, mode: result.mode }, 200, {}, request);
  } catch (error) {
    const status = isExternalFetchTimeout(error) ? 504 : 400;
    return jsonResponse({ error: error.message || 'Could not process webhook.' }, status, {}, request);
  }
}

export default createNodeCompatibleHandler(webhookHandler);
