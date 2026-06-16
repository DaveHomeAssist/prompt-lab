export const config = { runtime: 'nodejs' };

import {
  buildStripeConfig,
  jsonResponse,
  lookupBilling,
  optionsResponse,
  parseJsonBody,
} from '../_lib/stripeBilling.js';
import {
  enforceBillingAvailability,
  enforceBillingRouteControls,
  logBillingRouteResult,
  recordBillingRouteFailure,
} from '../_lib/billingControls.js';
import { isBillingTimeoutError } from '../_lib/billingNetwork.js';
import { resolveClerkBillingIdentity } from '../_lib/clerkBillingAuth.js';
import { createNodeCompatibleHandler } from '../_lib/nodeHandler.js';

function readString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

const AUTH_REQUIRED_MESSAGE = 'Sign in to manage Prompt Lab billing.';
const OWNER_ENTITLEMENT_ID = 'owner-entitlement';
const OWNER_MANAGE_URL = 'https://promptlab.tools/app/';

function splitCsv(value) {
  return String(value || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function readCsvEnv(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === 'string' && value.trim()) return splitCsv(value);
  }
  return [];
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

function uniqueValues(values, normalize) {
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

function resolveOwnerEntitlement(clerkIdentity) {
  const ownerEmails = new Set(
    readCsvEnv('PROMPTLAB_PRO_OWNER_EMAILS', 'PROMPTLAB_OWNER_EMAILS')
      .map(normalizeEmail)
      .filter(Boolean),
  );
  const ownerUserIds = new Set(
    readCsvEnv('PROMPTLAB_PRO_OWNER_CLERK_USER_IDS', 'PROMPTLAB_OWNER_CLERK_USER_IDS')
      .map(readString)
      .filter(Boolean),
  );
  const ownerUsernames = new Set(
    readCsvEnv('PROMPTLAB_PRO_OWNER_USERNAMES', 'PROMPTLAB_OWNER_USERNAMES')
      .map(normalizeUsername)
      .filter(Boolean),
  );
  const emails = uniqueValues([
    clerkIdentity?.customerEmail,
    ...(Array.isArray(clerkIdentity?.emails) ? clerkIdentity.emails : []),
  ], normalizeEmail);
  const usernames = uniqueValues([
    clerkIdentity?.username,
    ...(Array.isArray(clerkIdentity?.usernames) ? clerkIdentity.usernames : []),
  ], normalizeUsername);
  const customerEmail = emails[0] || '';
  const clerkUserId = readString(clerkIdentity?.userId);
  const matchedByEmail = emails.some((email) => ownerEmails.has(email));
  const matchedByUserId = clerkUserId && ownerUserIds.has(clerkUserId);
  const matchedByUsername = usernames.some((username) => ownerUsernames.has(username));

  if (!matchedByEmail && !matchedByUserId && !matchedByUsername) return null;

  return {
    ok: true,
    plan: 'pro',
    status: 'active',
    billingPeriod: 'owner',
    priceId: OWNER_ENTITLEMENT_ID,
    productName: 'Prompt Lab Pro',
    customerId: clerkUserId ? `clerk:${clerkUserId}` : OWNER_ENTITLEMENT_ID,
    customerEmail,
    clerkUserId,
    customerName: 'Owner',
    subscriptionId: OWNER_ENTITLEMENT_ID,
    manageUrl: OWNER_MANAGE_URL,
    entitlement: 'owner',
  };
}

export function createLicenseHandler(
  {
    resolveIdentity = resolveClerkBillingIdentity,
    enforceControls = enforceBillingRouteControls,
    recordRouteFailure = recordBillingRouteFailure,
    logResult = logBillingRouteResult,
    enforceAvailability = enforceBillingAvailability,
  } = {},
) {
  return async function handler(request) {
    if (request.method === 'OPTIONS') return optionsResponse();
    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed.' }, 405);
    }

    const startedAt = Date.now();
    let action = 'unknown';
    let clerkIdentity = null;
    let status = 500;
    let timeout = false;
    let note = '';
    let controlState = { requestId: '', clientIp: '' };
    try {
      const body = await parseJsonBody(request);
      action = readString(body?.action).toLowerCase();

      if (!['activate', 'deactivate', 'validate'].includes(action)) {
        status = 400;
        note = 'invalid-action';
        return jsonResponse({ error: 'Unknown billing action.' }, 400);
      }

      clerkIdentity = await resolveIdentity(request);
      if (!clerkIdentity.isAuthenticated) {
        status = 401;
        note = 'auth-required';
        return jsonResponse({ error: AUTH_REQUIRED_MESSAGE }, 401);
      }

      if (action === 'deactivate') {
        status = 200;
        return jsonResponse({
          ok: true,
          deactivated: true,
        });
      }

      const ownerEntitlement = resolveOwnerEntitlement(clerkIdentity);
      if (ownerEntitlement) {
        status = 200;
        note = 'owner-entitlement';
        return jsonResponse(ownerEntitlement);
      }

      controlState = await enforceAvailability({
        request,
        route: 'license',
      });
      if (controlState.response) {
        status = controlState.status;
        note = 'guard-blocked';
        return controlState.response;
      }

      controlState = await enforceControls({
        request,
        route: 'license',
        action,
        identity: clerkIdentity,
      });
      if (controlState.response) {
        status = controlState.status;
        note = status === 429 ? 'rate-limited' : 'guard-blocked';
        return controlState.response;
      }

      const payload = await lookupBilling(buildStripeConfig(), {
        customerEmail: clerkIdentity.customerEmail,
        customerId: '',
      });

      if (action === 'activate' && payload.plan !== 'pro') {
        status = 404;
        note = 'no-active-plan';
        return jsonResponse({ error: 'No active Prompt Lab Pro subscription was found for this account.' }, 404);
      }

      status = 200;
      return jsonResponse({
        ok: true,
        ...payload,
      });
    } catch (error) {
      const message = error.message || 'Billing request failed.';
      timeout = isBillingTimeoutError(error);
      if (timeout) {
        await recordRouteFailure({ route: 'license', error });
        status = 504;
        note = 'timeout';
        return jsonResponse({ error: message }, 504);
      }
      status = /No active Prompt Lab Pro subscription/i.test(message) ? 404 : 400;
      note = status === 404 ? 'no-active-plan' : 'request-failed';
      return jsonResponse({ error: message }, status);
    } finally {
      logResult({
        route: 'license',
        action,
        identity: clerkIdentity,
        status,
        startedAt,
        timeout,
        requestId: controlState.requestId,
        clientIp: controlState.clientIp,
        note,
      });
    }
  };
}

export default createNodeCompatibleHandler(createLicenseHandler());
