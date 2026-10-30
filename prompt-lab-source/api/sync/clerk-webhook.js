// Clerk `user.deleted` webhook -> erase that user's synced Library rows.
// Server-to-server only (no CORS). Off until all three server env vars exist:
//   CLERK_WEBHOOK_SIGNING_SECRET  (whsec_..., from the Clerk webhook endpoint)
//   SUPABASE_URL                  (https://<ref>.supabase.co)
//   SUPABASE_SECRET_KEY           (sb_secret_... ; Sensitive, production only, never VITE_)
// The signature is verified (Svix scheme: HMAC-SHA256 over id.timestamp.body,
// five-minute tolerance) before the body is parsed or anything is called.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createNodeCompatibleHandler } from '../_lib/nodeHandler.js';

const TOLERANCE_SECONDS = 5 * 60;
const USER_ID = /^user_[A-Za-z0-9]{1,64}$/;

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

export function verifySvixSignature({ id, timestamp, signatures, body, secret, nowSeconds = Math.floor(Date.now() / 1000) }) {
  if (!id || !timestamp || !signatures || !secret) return false;
  const ts = Number(timestamp);
  if (!Number.isInteger(ts) || Math.abs(nowSeconds - ts) > TOLERANCE_SECONDS) return false;
  let key;
  try { key = Buffer.from(String(secret).replace(/^whsec_/, ''), 'base64'); } catch { return false; }
  if (!key.length) return false;
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest();
  return String(signatures).split(' ').some((part) => {
    const [version, value] = part.split(',');
    if (version !== 'v1' || !value) return false;
    const given = Buffer.from(value, 'base64');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

export async function clerkWebhookHandler(request, { env = process.env, fetchImpl = fetch, nowSeconds } = {}) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  const secret = env.CLERK_WEBHOOK_SIGNING_SECRET;
  const supabaseUrl = String(env.SUPABASE_URL || '').replace(/\/+$/, '');
  const serviceKey = env.SUPABASE_SECRET_KEY;
  if (!secret || !/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(supabaseUrl) || !serviceKey) {
    return json({ error: 'Account sync webhook is not configured.' }, 503);
  }
  const body = await request.text();
  if (body.length > 256 * 1024) return json({ error: 'Payload too large.' }, 413);
  const valid = verifySvixSignature({
    id: request.headers.get('svix-id'),
    timestamp: request.headers.get('svix-timestamp'),
    signatures: request.headers.get('svix-signature'),
    body,
    secret,
    nowSeconds,
  });
  if (!valid) return json({ error: 'Invalid webhook signature.' }, 401);

  let event;
  try { event = JSON.parse(body); } catch { return json({ error: 'Invalid JSON.' }, 400); }
  if (event?.type !== 'user.deleted') return json({ ok: true, ignored: event?.type || 'unknown' });
  const userId = event?.data?.id;
  if (!USER_ID.test(String(userId || ''))) return json({ error: 'Invalid user id.' }, 400);

  const headers = { 'Content-Type': 'application/json', apikey: serviceKey };
  if (String(serviceKey).startsWith('eyJ')) headers.Authorization = `Bearer ${serviceKey}`; // legacy service_role JWT
  let response;
  try {
    response = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/sync_admin_delete_user`, { method: 'POST', headers, body: JSON.stringify({ p_user_id: userId }) });
  } catch {
    return json({ error: 'Could not reach the sync database.', retryable: true }, 502);
  }
  // Non-2xx makes Clerk (Svix) retry with backoff; the delete is idempotent.
  if (!response.ok) return json({ error: 'Sync data deletion failed.', retryable: true }, 502);
  const result = await response.json().catch(() => ({}));
  return json({ ok: true, deleted: { items: Number(result?.items) || 0, conflicts: Number(result?.conflicts) || 0 } });
}

export default createNodeCompatibleHandler((request) => clerkWebhookHandler(request));
