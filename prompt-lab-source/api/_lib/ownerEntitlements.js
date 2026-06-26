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

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeId(value) {
  return String(value || '').trim();
}

function normalizeUsername(value) {
  return String(value || '')
    .trim()
    .replace(/^@+/, '')
    .toLowerCase();
}

function uniqueNormalized(values, normalize) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const normalized = normalize(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
}

function listFromClaims(claims, keys, normalize) {
  const values = [];
  for (const key of keys) {
    const value = claims?.[key];
    if (Array.isArray(value)) {
      values.push(...value);
    } else if (value) {
      values.push(value);
    }
  }
  return uniqueNormalized(values, normalize);
}

export function lookupOwnerEntitlement({ clerkUserId = '', clerkEmail = '', clerkClaims = {} } = {}, env = process.env) {
  const ownerIds = new Set(readListEnv(env, [
    'PROMPTLAB_PRO_OWNER_CLERK_USER_IDS',
    'PROMPTLAB_OWNER_CLERK_USER_IDS',
    'PROMPTLAB_PRO_OWNER_USER_IDS',
    'PROMPTLAB_OWNER_USER_IDS',
  ]).map(normalizeId));
  const ownerEmails = new Set(readListEnv(env, [
    'PROMPTLAB_PRO_OWNER_EMAILS',
    'PROMPTLAB_OWNER_EMAILS',
    'PROMPTLAB_PRO_OWNER_EMAIL',
    'PROMPTLAB_OWNER_EMAIL',
  ]).map(normalizeEmail));
  const ownerUsernames = new Set(readListEnv(env, [
    'PROMPTLAB_PRO_OWNER_USERNAMES',
    'PROMPTLAB_OWNER_USERNAMES',
    'PROMPTLAB_PRO_OWNER_USERNAME',
    'PROMPTLAB_OWNER_USERNAME',
  ]).map(normalizeUsername));

  const normalizedUserId = normalizeId(clerkUserId);
  const emails = uniqueNormalized([
    clerkEmail,
    ...listFromClaims(clerkClaims, [
      'email',
      'email_address',
      'primary_email_address',
      'emails',
      'email_addresses',
    ], normalizeEmail),
  ], normalizeEmail);
  const usernames = uniqueNormalized([
    clerkClaims?.username,
    clerkClaims?.public_metadata?.username,
    clerkClaims?.unsafe_metadata?.username,
    ...listFromClaims(clerkClaims, [
      'usernames',
      'preferred_username',
      'nickname',
    ], normalizeUsername),
  ], normalizeUsername);
  const normalizedEmail = emails[0] || normalizeEmail(clerkEmail);
  const matchedByUserId = normalizedUserId && ownerIds.has(normalizedUserId);
  const matchedByEmail = emails.some((email) => ownerEmails.has(email));
  const matchedByUsername = usernames.some((username) => ownerUsernames.has(username));

  if (!matchedByUserId && !matchedByEmail && !matchedByUsername) return null;

  return {
    plan: PLAN_PRO,
    status: 'active',
    billingPeriod: OWNER_PERIOD,
    productName: 'Prompt Lab Pro',
    customerId: normalizedUserId ? `clerk:${normalizedUserId}` : OWNER_ENTITLEMENT_ID,
    subscriptionId: OWNER_ENTITLEMENT_ID,
    priceId: '',
    customerEmail: normalizedEmail,
    clerkUserId: normalizedUserId,
    customerName: 'Owner',
    manageUrl: '',
    owner: true,
  };
}
