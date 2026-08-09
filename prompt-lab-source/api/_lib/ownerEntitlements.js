const PLAN_PRO = 'pro';
const OWNER_PERIOD = 'owner';
const OWNER_ENTITLEMENT_ID = 'owner-entitlement';

function readListEnv(env, names) {
  const values = [];
  for (const name of names) {
    const raw = env?.[name];
    if (typeof raw !== 'string') continue;
    values.push(...raw.split(/[,\s]+/));
  }
  return values.map((value) => value.trim()).filter(Boolean);
}

function normalizeId(value) {
  return String(value || '').trim();
}

export function lookupOwnerEntitlement({ clerkUserId = '', clerkEmail = '' } = {}, env = process.env) {
  const normalizedUserId = normalizeId(clerkUserId);
  if (!normalizedUserId) return null;

  const ownerIds = new Set(readListEnv(env, [
    'PROMPTLAB_PRO_OWNER_CLERK_USER_IDS',
    'PROMPTLAB_OWNER_CLERK_USER_IDS',
    'PROMPTLAB_PRO_OWNER_USER_IDS',
    'PROMPTLAB_OWNER_USER_IDS',
  ]).map(normalizeId));

  if (!ownerIds.has(normalizedUserId)) return null;

  return {
    plan: PLAN_PRO,
    status: 'active',
    billingPeriod: OWNER_PERIOD,
    productName: 'Prompt Lab Pro',
    customerId: `clerk:${normalizedUserId}`,
    subscriptionId: OWNER_ENTITLEMENT_ID,
    priceId: '',
    customerEmail: String(clerkEmail || '').trim().toLowerCase(),
    clerkUserId: normalizedUserId,
    customerName: 'Owner',
    manageUrl: '',
    owner: true,
  };
}
