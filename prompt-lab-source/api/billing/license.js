export const config = { runtime: 'edge' };

import {
  buildBillingConfig,
  callLicenseApi,
  jsonResponse,
  normalizeLicenseRecord,
  optionsResponse,
  parseJsonBody,
} from '../_lib/lemonSqueezy.js';

function readString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export default async function handler(request) {
  if (request.method === 'OPTIONS') return optionsResponse();
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405);
  }

  const body = await parseJsonBody(request);
  const action = readString(body?.action).toLowerCase();
  const licenseKey = readString(body?.licenseKey);
  const instanceId = readString(body?.instanceId);
  const instanceName = readString(body?.instanceName);

  if (!['activate', 'deactivate', 'validate'].includes(action)) {
    return jsonResponse({ error: 'Unknown billing action.' }, 400);
  }

  if (!licenseKey) {
    return jsonResponse({ error: 'A license key is required.' }, 400);
  }

  if (action === 'activate' && !instanceName) {
    return jsonResponse({ error: 'An instance name is required to activate this license.' }, 400);
  }

  if (action === 'deactivate' && !instanceId) {
    return jsonResponse({ error: 'An instance ID is required to deactivate this license.' }, 400);
  }

  try {
    const payload = await callLicenseApi(action, {
      license_key: licenseKey,
      ...(instanceId ? { instance_id: instanceId } : {}),
      ...(instanceName ? { instance_name: instanceName } : {}),
    });

    if (action === 'deactivate') {
      return jsonResponse({
        ok: Boolean(payload?.deactivated),
        deactivated: Boolean(payload?.deactivated),
      });
    }

    const normalized = normalizeLicenseRecord(payload, buildBillingConfig());
    return jsonResponse({
      ok: true,
      ...normalized,
    });
  } catch (error) {
    const message = error.message || 'License request failed.';
    const status = /configured Prompt Lab Pro plans/i.test(message) ? 403 : 400;
    return jsonResponse({ error: message }, status);
  }
}
