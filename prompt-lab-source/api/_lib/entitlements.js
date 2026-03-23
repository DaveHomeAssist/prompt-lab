/**
 * Entitlements storage layer.
 *
 * Uses Vercel KV when KV_REST_API_URL + KV_REST_API_TOKEN are set.
 * Falls back to an in-memory map for local dev and test mode.
 *
 * Schema per user:
 * {
 *   plan: 'free' | 'pro',
 *   status: 'active' | 'canceled' | ...,
 *   entitlements: string[],
 *   stripeCustomerId: string,
 *   stripeSubscriptionId: string,
 *   updatedAt: string (ISO-8601),
 * }
 */

const FREE_TIER = {
  plan: 'free',
  status: 'none',
  entitlements: [],
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  updatedAt: null,
};

// ── KV backend selection ────────────────────────────────────────────────────

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const useVercelKV = Boolean(KV_URL && KV_TOKEN);

// In-memory fallback for dev/test
const memoryStore = new Map();

function kvKey(userId) {
  return `pl:entitlements:${userId}`;
}

async function kvGet(userId) {
  if (!useVercelKV) {
    return memoryStore.get(kvKey(userId)) || null;
  }

  const res = await fetch(`${KV_URL}/get/${kvKey(userId)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });

  if (!res.ok) return null;
  const data = await res.json();
  return data?.result ? JSON.parse(data.result) : null;
}

async function kvSet(userId, value) {
  const serialized = JSON.stringify(value);

  if (!useVercelKV) {
    memoryStore.set(kvKey(userId), value);
    return;
  }

  await fetch(`${KV_URL}/set/${kvKey(userId)}/${encodeURIComponent(serialized)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
}

async function kvDel(userId) {
  if (!useVercelKV) {
    memoryStore.delete(kvKey(userId));
    return;
  }

  await fetch(`${KV_URL}/del/${kvKey(userId)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function getEntitlements(userId) {
  if (!userId) return { ...FREE_TIER };

  const stored = await kvGet(userId);
  if (!stored) return { ...FREE_TIER };

  return {
    plan: stored.plan || 'free',
    status: stored.status || 'none',
    entitlements: Array.isArray(stored.entitlements) ? stored.entitlements : [],
    stripeCustomerId: stored.stripeCustomerId || null,
    stripeSubscriptionId: stored.stripeSubscriptionId || null,
    updatedAt: stored.updatedAt || null,
  };
}

export async function writeEntitlements(userId, data) {
  if (!userId) throw new Error('userId is required.');
  await kvSet(userId, data);
}

export async function deleteEntitlements(userId) {
  if (!userId) throw new Error('userId is required.');
  await kvDel(userId);
}
