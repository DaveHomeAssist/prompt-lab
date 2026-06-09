const PLAN_PRO = 'pro';
const OWNER_PERIOD = 'owner';

function readListEnv(env, names) {
  const values = [];
  for (const name of names) {
    const raw = env?.[name];
    if (typeof raw !== 'string') continue;
    values.push(...raw.split(/[,\s]+/));
  }
  return values.map((value) => value.trim()).filter(Boolean);
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeId(value) {
  return String(value || '').trim();
}

export function lookupOwnerEntitlement({ clerkUserId = '', clerkEmail = '' } = {}, env = process.env) {
  const ownerIds = new Set(readListEnv(env, [
    'PROMPTLAB_OWNER_CLERK_USER_IDS',
    'PROMPTLAB_OWNER_USER_IDS',
  ]).map(normalizeId));
  const ownerEmails = new Set(readListEnv(env, [
    'PROMPTLAB_OWNER_EMAILS',
    'PROMPTLAB_OWNER_EMAIL',
  ]).map(normalizeEmail));

  const normalizedUserId = normalizeId(clerkUserId);
  const normalizedEmail = normalizeEmail(clerkEmail);
  const matchedByUserId = normalizedUserId && ownerIds.has(normalizedUserId);
  const matchedByEmail = normalizedEmail && ownerEmails.has(normalizedEmail);

  if (!matchedByUserId && !matchedByEmail) return null;

  return {
    plan: PLAN_PRO,
    status: 'active',
    billingPeriod: OWNER_PERIOD,
    productName: 'Prompt Lab Pro',
    customerId: '',
    subscriptionId: '',
    priceId: '',
    customerEmail: normalizedEmail,
    customerName: 'Owner',
    manageUrl: '',
    owner: true,
  };
}
