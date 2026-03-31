export const config = { runtime: 'edge' };

import {
  buildBillingConfig,
  jsonResponse,
  optionsResponse,
} from '../_lib/lemonSqueezy.js';

export default async function handler(request) {
  if (request.method === 'OPTIONS') return optionsResponse();
  if (request.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed.' }, 405);
  }

  const config = buildBillingConfig();
  return jsonResponse({
    ok: true,
    url: config.portalUrl,
  });
}
