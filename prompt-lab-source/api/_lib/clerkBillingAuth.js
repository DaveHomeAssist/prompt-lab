import { fetchWithTimeout, withTimeout } from './billingNetwork.js';

const DEFAULT_AUTHORIZED_PARTIES = ['https://promptlab.tools'];
const DEFAULT_CLERK_API_URL = 'https://api.clerk.com/v1';

function readStringEnv(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function normalizeOrigin(value) {
  if (!value) return '';
  try {
    return new URL(value).origin;
  } catch {
    return '';
  }
}

function splitCsv(value) {
  return String(value || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
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

function getEmailAddressValue(item) {
  return item?.emailAddress || item?.email_address || item?.email || item?.identifier || '';
}

function getEmailAddressId(item) {
  return String(item?.id || item?.emailAddressId || item?.email_address_id || '').trim();
}

function getEmailAddresses(user) {
  if (Array.isArray(user?.emailAddresses)) return user.emailAddresses;
  if (Array.isArray(user?.email_addresses)) return user.email_addresses;
  return [];
}

function getExternalAccounts(user) {
  if (Array.isArray(user?.externalAccounts)) return user.externalAccounts;
  if (Array.isArray(user?.external_accounts)) return user.external_accounts;
  return [];
}

function getEmailCandidates(user) {
  const primaryId = String(user?.primaryEmailAddressId || user?.primary_email_address_id || '').trim();
  const addresses = getEmailAddresses(user);
  const primary = addresses.find((item) => getEmailAddressId(item) === primaryId);
  const externalAccounts = getExternalAccounts(user);

  return uniqueNormalized([
    getEmailAddressValue(primary),
    ...addresses.map(getEmailAddressValue),
    ...externalAccounts.map(getEmailAddressValue),
  ], normalizeEmail);
}

function getUsernameCandidates(user) {
  const externalAccounts = getExternalAccounts(user);
  return uniqueNormalized([
    user?.username,
    ...externalAccounts.map((item) => item?.username || item?.providerUsername || item?.provider_username),
  ], normalizeUsername);
}

function readBearerToken(request) {
  const header = request.headers.get('authorization') || request.headers.get('Authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

async function fetchClerkUser(userId, config) {
  const response = await fetchWithTimeout(`${config.apiUrl}/users/${encodeURIComponent(userId)}`, {
    headers: {
      Authorization: `Bearer ${config.secretKey}`,
      'Content-Type': 'application/json',
    },
  }, {
    timeoutMessage: 'Clerk user lookup timed out.',
  });
  if (!response.ok) {
    throw new Error('Could not load Clerk user.');
  }
  return response.json();
}

async function loadVerifyToken() {
  const clerkBackend = await import('@clerk/backend');
  if (typeof clerkBackend.verifyToken !== 'function') {
    throw new Error('Clerk token verification is unavailable in this runtime.');
  }
  return clerkBackend.verifyToken;
}

export function buildClerkBillingConfig() {
  return {
    secretKey: readStringEnv('CLERK_SECRET_KEY'),
    jwtKey: readStringEnv('CLERK_JWT_KEY'),
    apiUrl: readStringEnv('CLERK_API_URL') || DEFAULT_CLERK_API_URL,
    authorizedParties: splitCsv(readStringEnv('CLERK_AUTHORIZED_PARTIES')),
  };
}

export function buildAuthorizedParties(request, config = buildClerkBillingConfig()) {
  const parties = new Set([
    ...DEFAULT_AUTHORIZED_PARTIES,
    ...config.authorizedParties,
  ]);

  // Keep the allowlist bound to the deployed app origin plus explicit config.
  // Trusting caller-controlled Origin/Referer headers would re-allow hostile
  // subdomains and defeat Clerk's subdomain leak protection.
  const requestOrigin = normalizeOrigin(request.url);

  if (requestOrigin) parties.add(requestOrigin);

  return Array.from(parties);
}

export async function resolveClerkBillingIdentity(
  request,
  {
    config = buildClerkBillingConfig(),
    verifyTokenFn = loadVerifyToken,
    fetchUserFn = fetchClerkUser,
  } = {},
) {
  const token = readBearerToken(request);
  if (!token) {
    return {
      hasBearerToken: false,
      isAuthenticated: false,
      userId: '',
      customerEmail: '',
    };
  }

  if (!config.secretKey) {
    return {
      hasBearerToken: true,
      isAuthenticated: false,
      userId: '',
      customerEmail: '',
      error: new Error('Clerk billing is not configured.'),
    };
  }

  try {
    const loadedVerifyToken = verifyTokenFn === loadVerifyToken
      ? await withTimeout(() => loadVerifyToken(), {
          timeoutMessage: 'Clerk token verifier load timed out.',
        })
      : verifyTokenFn;

    const verifiedToken = await withTimeout(() => loadedVerifyToken(token, {
      secretKey: config.secretKey,
      ...(config.jwtKey ? { jwtKey: config.jwtKey } : {}),
      authorizedParties: buildAuthorizedParties(request, config),
    }), {
      timeoutMessage: 'Clerk token verification timed out.',
    });

    const userId = String(verifiedToken?.sub || '').trim();
    if (!userId) {
      throw new Error('Clerk token is missing a user id.');
    }

    const clerkUser = await withTimeout(() => fetchUserFn(userId, config), {
      timeoutMessage: 'Clerk user lookup timed out.',
    });
    const emails = getEmailCandidates(clerkUser);
    const usernames = getUsernameCandidates(clerkUser);
    const customerEmail = emails[0] || '';

    return {
      hasBearerToken: true,
      isAuthenticated: true,
      userId,
      customerEmail,
      emails,
      username: usernames[0] || '',
      usernames,
      verifiedToken,
      clerkUser,
    };
  } catch (error) {
    return {
      hasBearerToken: true,
      isAuthenticated: false,
      userId: '',
      customerEmail: '',
      error,
    };
  }
}
