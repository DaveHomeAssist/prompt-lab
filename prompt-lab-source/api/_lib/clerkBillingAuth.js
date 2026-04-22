import { verifyToken } from '@clerk/backend';
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

function getPrimaryEmail(user) {
  const primaryId = String(user?.primaryEmailAddressId || '').trim();
  const addresses = Array.isArray(user?.emailAddresses) ? user.emailAddresses : [];
  const primary =
    addresses.find((item) => String(item?.id || '').trim() === primaryId)
    || addresses.find((item) => normalizeEmail(item?.emailAddress));
  return normalizeEmail(primary?.emailAddress || '');
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
    verifyTokenFn = verifyToken,
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
    const verifiedToken = await withTimeout(() => verifyTokenFn(token, {
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
    const customerEmail = getPrimaryEmail(clerkUser);
    if (!customerEmail) {
      throw new Error('Clerk user does not have a primary email address.');
    }

    return {
      hasBearerToken: true,
      isAuthenticated: true,
      userId,
      customerEmail,
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
