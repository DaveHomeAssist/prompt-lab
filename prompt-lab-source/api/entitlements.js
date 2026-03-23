import { requireAuthenticatedUser } from './_lib/auth.js';
import { empty, json } from './_lib/http.js';
import { getEntitlements } from './_lib/entitlements.js';

export default async function handler(request) {
  const origin = request.headers.get('origin') || '';

  if (request.method === 'OPTIONS') {
    return empty(204, origin, request);
  }

  if (request.method !== 'GET' && request.method !== 'POST') {
    return json({ error: 'Method not allowed.' }, 405, origin, request);
  }

  const auth = await requireAuthenticatedUser(request);
  if (auth.errorResponse) {
    return auth.errorResponse;
  }

  try {
    const data = await getEntitlements(auth.user.id);

    return json(
      {
        ok: true,
        userId: auth.user.id,
        plan: data.plan,
        status: data.status,
        entitlements: data.entitlements,
        updatedAt: data.updatedAt,
      },
      200,
      auth.origin,
      request,
    );
  } catch (error) {
    return json(
      { error: error?.message || 'Failed to resolve entitlements.' },
      500,
      auth.origin,
      request,
    );
  }
}
