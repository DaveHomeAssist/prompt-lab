export const config = { runtime: 'edge' };

import {
  buildTelemetryConfig,
  jsonResponse,
  normalizeTelemetryEvent,
  optionsResponse,
  parseJsonBody,
  persistTelemetryEvent,
} from './_lib/telemetryStore.js';
import { assertProductionConfig } from './_lib/assertProductionConfig.js';

assertProductionConfig();

export default async function handler(request) {
  if (request.method === 'OPTIONS') return optionsResponse();
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405);
  }

  try {
    const body = await parseJsonBody(request);
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

    const result = await persistTelemetryEvent(payload, buildTelemetryConfig());
    return jsonResponse(result, 200);
  } catch (error) {
    return jsonResponse({ error: error.message || 'Could not record telemetry.' }, 400);
  }
}
