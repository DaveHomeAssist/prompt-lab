export const config = { runtime: 'edge' };

import {
  assertTelemetryConsent,
  buildTelemetryConfig,
  enforceTelemetryRateLimit,
  jsonResponse,
  normalizeTelemetryEvent,
  optionsResponse,
  parseJsonBody,
  persistTelemetryEvent,
  TelemetryRequestError,
} from './_lib/telemetryStore.js';
import { assertProductionConfig } from './_lib/assertProductionConfig.js';
import { isExternalFetchTimeout, isFeatureEnabled } from './_lib/runtimeSafety.js';

// Terminal response for telemetry-off deployments: clients must treat this as
// a final state and drop the queued event instead of replaying it forever.
// Keeps the existing `error` payload shape and adds the terminal flags.
function telemetryDisabledResponse(message) {
  return jsonResponse({
    error: message,
    telemetryDisabled: true,
    retryable: false,
  }, 200);
}

export default async function handler(request) {
  if (request.method === 'OPTIONS') return optionsResponse();
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405);
  }

  if (!isFeatureEnabled('PROMPTLAB_TELEMETRY_ENABLED')) {
    return telemetryDisabledResponse('Telemetry is disabled.');
  }

  try {
    assertProductionConfig({ durableStore: true });
  } catch {
    return telemetryDisabledResponse('Telemetry storage is not configured.');
  }

  try {
    const body = await parseJsonBody(request);
    assertTelemetryConsent(body);
    const telemetryConfig = buildTelemetryConfig();
    const rateLimit = await enforceTelemetryRateLimit(request, telemetryConfig);
    if (rateLimit.limited) {
      return jsonResponse(
        { error: 'Telemetry rate limit exceeded.' },
        429,
        {
          'Retry-After': String(rateLimit.retryAfterSeconds),
          'X-RateLimit-Remaining': '0',
        },
      );
    }
    const payload = body?.kind === 'identify'
      ? normalizeTelemetryEvent({
          event: 'identity.updated',
          surface: body?.surface,
          appVersion: body?.appVersion,
          deviceId: body?.deviceId,
          sessionId: body?.sessionId,
          plan: body?.plan,
          contactEmail: body?.contactEmail,
          telemetryEnabled: body?.telemetryEnabled,
          context: {
            source: 'preferences',
            telemetryEnabled: body?.telemetryEnabled !== false,
          },
        })
      : normalizeTelemetryEvent(body);

    const result = await persistTelemetryEvent(payload, telemetryConfig);
    return jsonResponse(result, 200, {
      'X-RateLimit-Remaining': String(rateLimit.remaining),
    });
  } catch (error) {
    const status = isExternalFetchTimeout(error)
      ? 504
      : (error instanceof TelemetryRequestError ? error.status : 400);
    return jsonResponse({ error: error.message || 'Could not record telemetry.' }, status);
  }
}
