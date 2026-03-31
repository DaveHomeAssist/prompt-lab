export const config = { runtime: 'edge' };

import {
  buildLemonWebhookEvent,
  buildTelemetryConfig,
  jsonResponse,
  optionsResponse,
  persistTelemetryEvent,
  verifyLemonSignature,
} from '../_lib/telemetryStore.js';

export default async function handler(request) {
  if (request.method === 'OPTIONS') return optionsResponse();
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405);
  }

  const config = buildTelemetryConfig();
  if (!config.webhookSecret) {
    return jsonResponse({ error: 'Lemon webhook secret is not configured.' }, 503);
  }

  const rawBody = await request.text();
  const providedSignature = request.headers.get('x-signature') || request.headers.get('X-Signature') || '';
  const isValid = await verifyLemonSignature(rawBody, providedSignature, config.webhookSecret);
  if (!isValid) {
    return jsonResponse({ error: 'Invalid webhook signature.' }, 401);
  }

  try {
    const payload = JSON.parse(rawBody || '{}');
    const event = buildLemonWebhookEvent(payload);
    const result = await persistTelemetryEvent(event, config);
    return jsonResponse({ ok: true, mode: result.mode }, 200);
  } catch (error) {
    return jsonResponse({ error: error.message || 'Could not process webhook.' }, 400);
  }
}
