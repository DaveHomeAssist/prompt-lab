// Clerk `user.deleted` webhook -> erase that user's synced Library rows.
// Server-to-server only (no CORS). Off until all three server env vars exist:
//   CLERK_WEBHOOK_SIGNING_SECRET  (whsec_..., from the Clerk webhook endpoint)
//   SUPABASE_URL                  (https://<ref>.supabase.co)
//   SUPABASE_SECRET_KEY           (sb_secret_... ; Sensitive, production only, never VITE_)
// The signature is verified (Svix scheme: HMAC-SHA256 over id.timestamp.body,
// five-minute tolerance) over the exact raw request bytes, before the body is
// parsed or anything is called. The Node entry point reads the raw stream
// itself and never verifies a re-serialized, framework-parsed body.
import { createHmac, timingSafeEqual } from 'node:crypto';

const TOLERANCE_SECONDS = 5 * 60;
const MAX_BODY_BYTES = 256 * 1024;

// Body parsing off for runtimes that honor this flag (Next.js-style API
// routes). The default export below does not depend on it: it reads raw bytes.
export const config = { api: { bodyParser: false } };
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
  const raw = Buffer.isBuffer(body) ? body : Buffer.from(String(body ?? ''), 'utf8');
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.`).update(raw).digest();
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
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return json({ error: 'Payload too large.' }, 413);
  const raw = Buffer.from(await request.arrayBuffer());
  if (raw.length > MAX_BODY_BYTES) return json({ error: 'Payload too large.' }, 413);
  const body = raw.toString('utf8');
  const valid = verifySvixSignature({
    id: request.headers.get('svix-id'),
    timestamp: request.headers.get('svix-timestamp'),
    signatures: request.headers.get('svix-signature'),
    body: raw,
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

/**
 * Raw request bytes from a Node (Vercel) request. Reads the stream first. If a
 * runtime already drained it, accepts only an unparsed Buffer or string body;
 * a parsed object is refused (null), because re-serializing it would change
 * the bytes the signature covers.
 */
export async function readRawNodeBody(req, limit = MAX_BODY_BYTES) {
  const chunks = [];
  let size = 0;
  if (typeof req?.on === 'function' && !req.readableEnded) {
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > limit) return { tooLarge: true };
      chunks.push(buffer);
    }
  }
  if (size > 0) return { raw: Buffer.concat(chunks) };
  const pre = req?.rawBody ?? req?.body;
  if (Buffer.isBuffer(pre)) return pre.length > limit ? { tooLarge: true } : { raw: pre };
  if (typeof pre === 'string') return Buffer.byteLength(pre) > limit ? { tooLarge: true } : { raw: Buffer.from(pre, 'utf8') };
  if (pre && typeof pre === 'object') return { raw: null };
  return { raw: Buffer.alloc(0) };
}

function nodeHeaders(req) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req?.headers || {})) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(key, item));
    else if (value != null) headers.set(key, String(value));
  }
  headers.delete('content-length'); // recomputed from the raw bytes
  return headers;
}

export default async function clerkWebhookNodeHandler(req, res, options) {
  if (typeof Request !== 'undefined' && req instanceof Request) return clerkWebhookHandler(req, options);
  const send = async (response) => {
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.end(Buffer.from(await response.arrayBuffer()));
  };
  try {
    const method = String(req?.method || 'GET').toUpperCase();
    if (method !== 'POST') return send(json({ error: 'Method not allowed.' }, 405));
    const { raw, tooLarge } = await readRawNodeBody(req);
    if (tooLarge) return send(json({ error: 'Payload too large.' }, 413));
    if (raw === null) return send(json({ error: 'Raw request body unavailable; cannot verify the signature.' }, 400));
    const request = new Request(`https://${req?.headers?.host || 'promptlab.tools'}${req?.url || '/api/sync/clerk-webhook'}`, {
      method, headers: nodeHeaders(req), body: raw,
    });
    return send(await clerkWebhookHandler(request, options));
  } catch {
    return send(json({ error: 'Internal server error.' }, 500));
  }
}
