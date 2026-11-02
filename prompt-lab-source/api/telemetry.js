export const config = { runtime: 'edge' };

import {
  assertTelemetryConsent,
  buildTelemetryConfig,
  deleteTelemetryRecords,
  enforceTelemetryRateLimit,
  jsonResponse,
  normalizeTelemetryEvent,
  optionsResponse,
  parseJsonBody,
  persistTelemetryEvent,
  TelemetryRequestError,
} from './_lib/telemetryStore.js';
import { assertProductionConfig } from './_lib/assertProductionConfig.js';
import { corsRejectionResponse } from './_lib/allowedOrigins.js';
import { isExternalFetchTimeout, isFeatureEnabled } from './_lib/runtimeSafety.js';

// Terminal response for telemetry-off deployments: clients must treat this as
// a final state and drop the queued event instead of replaying it forever.
// Keeps the existing `error` payload shape and adds the terminal flags.
function telemetryDisabledResponse(message, request) {
  return jsonResponse({
    error: message,
    telemetryDisabled: true,
    retryable: false,
  }, 200, {}, request);
}

// PRIV-02: POST /api/telemetry?action=withdraw deletes this device's stored
// records. It is honoured even when telemetry collection is switched off, so
// records written earlier can still be deleted. It needs no consent flag and
// stores nothing.
function isWithdrawalRequest(request) {
  try {
    return new URL(request.url).searchParams.get('action') === 'withdraw';
  } catch {
    return false;
  }
}

async function handleWithdrawal(request) {
  try {
    const body = await parseJsonBody(request);
    const telemetryConfig = buildTelemetryConfig();
    const rateLimit = await enforceTelemetryRateLimit(request, telemetryConfig);
    if (rateLimit.limited) {
      return jsonResponse(
        { error: 'Telemetry rate limit exceeded.' },
        429,
        { 'Retry-After': String(rateLimit.retryAfterSeconds), 'X-RateLimit-Remaining': '0' },
        request,
      );
    }
    const result = await deleteTelemetryRecords({
      deviceId: body?.deviceId,
      contactEmail: body?.contactEmail,
    }, telemetryConfig);
    return jsonResponse({ ...result, withdrawn: true }, 200, {}, request);
  } catch (error) {
    const status = isExternalFetchTimeout(error)
      ? 504
      : (error instanceof TelemetryRequestError ? error.status : 500);
    const message = error instanceof TelemetryRequestError
      ? error.message
      : 'Could not delete telemetry records.';
    return jsonResponse({ error: message }, status, {}, request);
  }
}

export default async function handler(request) {
  // Same origin policy as /api/proxy: unlisted (or missing) origins are
  // rejected before any body is read, and never receive Allow-Origin.
  const corsRejection = corsRejectionResponse(request);
  if (corsRejection) return corsRejection;

  if (request.method === 'OPTIONS') return optionsResponse(request);
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405, {}, request);
  }

  if (isWithdrawalRequest(request)) {
    return handleWithdrawal(request);
  }

  if (!isFeatureEnabled('PROMPTLAB_TELEMETRY_ENABLED')) {
    return telemetryDisabledResponse('Telemetry is disabled.', request);
  }

  try {
    assertProductionConfig({ durableStore: true });
  } catch {
    return telemetryDisabledResponse('Telemetry storage is not configured.', request);
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
        request,
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
    }, request);
  } catch (error) {
    const status = isExternalFetchTimeout(error)
      ? 504
      : (error instanceof TelemetryRequestError ? error.status : 400);
    return jsonResponse({ error: error.message || 'Could not record telemetry.' }, status, {}, request);
  }
}
