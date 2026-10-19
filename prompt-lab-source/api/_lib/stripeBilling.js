import { fetchWithTimeout, readBoundedIntEnv } from './runtimeSafety.js';

const STRIPE_API_BASE = 'https://api.stripe.com/v1';
const DEFAULT_SUCCESS_URL = 'https://promptlab.tools/app/?billing=success';
const DEFAULT_CANCEL_URL = 'https://promptlab.tools/app/?billing=cancelled';
const DEFAULT_PORTAL_RETURN_URL = 'https://promptlab.tools/app/';
const DEFAULT_STORAGE_PREFIX = 'promptlab:stripe';
const ACTIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing', 'past_due']);
// Statuses that still grant Pro or can still be charged. A disputed customer's
// Prompt Lab subscriptions in these states are canceled (docs/billing-policy.md).
const DISPUTE_CANCELABLE_STATUSES = new Set(['active', 'trialing', 'past_due', 'unpaid', 'incomplete']);
const STRIPE_TIMEOUT_MS = 5000;
const REDIS_TIMEOUT_MS = 2000;
// Waits after an in-flight 409: about 3.75s in total, which covers a slow
// winning create while staying inside the billing routes' 10s limit.
const CUSTOMER_CREATE_RETRY_DELAYS_MS = [250, 500, 1000, 2000];

function readStringEnv(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function readBooleanEnv(name, fallback = false) {
  const value = readStringEnv(name);
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export function createCorsHeaders(extraHeaders = {}) {
  const origin = readStringEnv('PROMPTLAB_WEB_ORIGIN', 'VITE_PROMPTLAB_WEB_ORIGIN') || 'https://promptlab.tools';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Stripe-Signature',
    Vary: 'Origin',
    ...extraHeaders,
  };
}

function requestOrigin(request) {
  if (typeof request?.headers?.get !== 'function') return '';
  return String(request.headers.get('Origin') || request.headers.get('origin') || '').trim();
}

export function isAllowedCorsOrigin(origin) {
  const value = String(origin || '').trim();
  if (!value) return true;
  const productionOrigin = readStringEnv('PROMPTLAB_WEB_ORIGIN', 'VITE_PROMPTLAB_WEB_ORIGIN') || 'https://promptlab.tools';
  if (value === productionOrigin) return true;
  if (value.startsWith('chrome-extension://')) return true;
  if (process.env.NODE_ENV !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(value)) return true;
  return false;
}

function corsHeadersForRequest(request, extraHeaders = {}) {
  const origin = requestOrigin(request);
  return createCorsHeaders({
    ...(origin && isAllowedCorsOrigin(origin) ? { 'Access-Control-Allow-Origin': origin } : {}),
    ...extraHeaders,
  });
}

export function corsRejectionResponse(request) {
  const origin = requestOrigin(request);
  if (isAllowedCorsOrigin(origin)) return null;
  return new Response(JSON.stringify({ error: 'Origin is not allowed.' }), {
    status: 403,
    headers: {
      'Content-Type': 'application/json',
      ...createCorsHeaders({ 'Access-Control-Allow-Origin': 'null' }),
    },
  });
}

export function jsonResponse(body, status = 200, extraHeaders = {}, request = null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...(request ? corsHeadersForRequest(request, extraHeaders) : createCorsHeaders(extraHeaders)),
    },
  });
}

export function optionsResponse(request = null) {
  const rejection = request ? corsRejectionResponse(request) : null;
  if (rejection) return rejection;
  return new Response(null, {
    status: 204,
    headers: request ? corsHeadersForRequest(request) : createCorsHeaders(),
  });
}

export async function parseJsonBody(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function buildStripeStorageConfig() {
  return {
    redisUrl: readStringEnv('KV_REST_API_URL', 'UPSTASH_REDIS_REST_URL').replace(/\/+$/, ''),
    redisToken: readStringEnv('KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_TOKEN'),
    storagePrefix: readStringEnv('PROMPTLAB_BILLING_PREFIX') || DEFAULT_STORAGE_PREFIX,
    consoleFallback: readBooleanEnv('PROMPTLAB_BILLING_CONSOLE_FALLBACK', false),
  };
}

export function buildStripeConfig() {
  return {
    secretKey: readStringEnv('STRIPE_SECRET_KEY'),
    webhookSecret: readStringEnv('STRIPE_WEBHOOK_SECRET'),
    monthlyPriceId: readStringEnv('STRIPE_MONTHLY_PRICE_ID', 'STRIPE_PRICE_ID_MONTHLY', 'STRIPE_PRICE_ID'),
    yearlyPriceId: readStringEnv('STRIPE_YEARLY_PRICE_ID', 'STRIPE_PRICE_ID_YEARLY', 'STRIPE_ANNUAL_PRICE_ID'),
    // Earlier annual prices (USD 99 before the 2026-10 change). They still grant
    // Pro to existing subscribers but are never offered at checkout.
    legacyYearlyPriceIds: readStringEnv('STRIPE_LEGACY_YEARLY_PRICE_IDS')
      .split(',')
      .map((priceId) => priceId.trim())
      .filter(Boolean),
    successUrl: readStringEnv('STRIPE_CHECKOUT_SUCCESS_URL', 'STRIPE_SUCCESS_URL') || DEFAULT_SUCCESS_URL,
    cancelUrl: readStringEnv('STRIPE_CHECKOUT_CANCEL_URL', 'STRIPE_CANCEL_URL') || DEFAULT_CANCEL_URL,
    portalReturnUrl: readStringEnv('STRIPE_PORTAL_RETURN_URL') || DEFAULT_PORTAL_RETURN_URL,
    ...buildStripeStorageConfig(),
  };
}

export function getAllowedPriceMap(config = buildStripeConfig()) {
  return new Map(
    [
      [config.monthlyPriceId, 'monthly'],
      [config.yearlyPriceId, 'annual'],
      ...(Array.isArray(config.legacyYearlyPriceIds) ? config.legacyYearlyPriceIds : [])
        .map((priceId) => [priceId, 'annual']),
    ].filter(([priceId]) => Boolean(priceId)),
  );
}

export function resolveCheckoutPriceId(config, period) {
  if (period === 'annual') return config.yearlyPriceId;
  return config.monthlyPriceId;
}

function hasRedis(config) {
  return Boolean(config.redisUrl && config.redisToken);
}

async function redisCommand(config, command, args = [], bodyValue = null) {
  const path = [command.toLowerCase(), ...args.map((value) => encodeURIComponent(String(value)))].join('/');
  const url = `${config.redisUrl}/${path}`;
  const response = await fetchWithTimeout(url, {
    method: bodyValue == null ? 'GET' : 'POST',
    headers: {
      Authorization: `Bearer ${config.redisToken}`,
      ...(bodyValue == null ? {} : { 'Content-Type': 'text/plain;charset=UTF-8' }),
    },
    ...(bodyValue == null ? {} : { body: String(bodyValue) }),
  }, {
    service: 'Redis',
    timeoutMs: readBoundedIntEnv('PROMPTLAB_REDIS_TIMEOUT_MS', REDIS_TIMEOUT_MS, { max: 5000 }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.error) {
    throw new Error(payload?.error || `Redis ${command} failed.`);
  }
  return payload?.result;
}

async function parseJsonSafe(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function extractStripeError(payload, fallback = 'Stripe request failed.') {
  if (typeof payload?.error?.message === 'string' && payload.error.message.trim()) return payload.error.message.trim();
  if (typeof payload?.error?.code === 'string' && payload.error.code.trim()) return payload.error.code.trim();
  if (typeof payload?.message === 'string' && payload.message.trim()) return payload.message.trim();
  return fallback;
}

async function stripeRequest(config, path, { method = 'GET', body = null, idempotencyKey = '' } = {}) {
  if (!config.secretKey) {
    throw new Error('Stripe billing is not configured.');
  }

  const response = await fetchWithTimeout(`${STRIPE_API_BASE}/${path.replace(/^\/+/, '')}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.secretKey}`,
      ...(body == null ? {} : { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' }),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    ...(body == null ? {} : {
      body: body instanceof URLSearchParams ? body.toString() : String(body),
    }),
  }, {
    service: 'Stripe',
    timeoutMs: readBoundedIntEnv('PROMPTLAB_STRIPE_TIMEOUT_MS', STRIPE_TIMEOUT_MS, { max: 8000 }),
  });

  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    const error = new Error(extractStripeError(payload, 'Stripe request failed.'));
    error.status = response.status;
    throw error;
  }
  return payload;
}

export async function createCheckout(config, {
  period = 'monthly',
  email = '',
  source = 'app',
  clerkUserId = '',
  deviceId = '',
  sessionId = '',
  surface = '',
  contactEmail = '',
} = {}) {
  const priceId = resolveCheckoutPriceId(config, period);
  if (!priceId) {
    throw new Error(`No Stripe price is configured for "${period}".`);
  }

  const params = new URLSearchParams();
  params.set('mode', 'subscription');
  params.set('success_url', config.successUrl);
  params.set('cancel_url', config.cancelUrl);
  params.set('billing_address_collection', 'auto');
  params.set('allow_promotion_codes', 'true');
  params.set('line_items[0][price]', priceId);
  params.set('line_items[0][quantity]', '1');
  params.set('client_reference_id', deviceId || sessionId || source || 'prompt-lab');

  // License refresh and the portal resolve this same Clerk-bound customer.
  // customer_email alone lets Checkout create a second, unbound customer.
  const customer = await getOrCreateStripeCustomer(config, { clerkUserId, clerkEmail: email });
  params.set('customer', customer.id);

  const metadata = {
    app: 'prompt-lab',
    source,
    surface,
    billing_period: period,
    ...(deviceId ? { device_id: deviceId } : {}),
    ...(sessionId ? { session_id: sessionId } : {}),
    ...(contactEmail ? { contact_email: contactEmail } : {}),
    ...(clerkUserId ? { clerk_user_id: clerkUserId } : {}),
  };

  for (const [key, value] of Object.entries(metadata)) {
    if (!value) continue;
    params.set(`metadata[${key}]`, value);
    params.set(`subscription_data[metadata][${key}]`, value);
  }

  const payload = await stripeRequest(config, 'checkout/sessions', {
    method: 'POST',
    body: params,
  });

  return {
    checkoutUrl: payload?.url || '',
    checkoutSessionId: payload?.id || '',
    customerId: customer.id,
    priceId,
    period,
  };
}

export async function findCustomerByEmail(config, customerEmail) {
  const email = normalizeEmail(customerEmail);
  if (!email) return null;
  const payload = await stripeRequest(config, `customers?limit=1&email=${encodeURIComponent(email)}`);
  return payload?.data?.find((customer) => !customer?.deleted) || null;
}

function escapeStripeSearchValue(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function customerMatchesClerkUser(customer, clerkUserId) {
  const id = String(clerkUserId || '').trim();
  if (!id) return false;
  const metadata = customer?.metadata || {};
  return metadata.clerkUserId === id || metadata.clerk_user_id === id;
}

export async function findCustomerByClerkUserId(config, clerkUserId) {
  const id = String(clerkUserId || '').trim();
  if (!id) return null;
  const query = `metadata['clerkUserId']:'${escapeStripeSearchValue(id)}' OR metadata['clerk_user_id']:'${escapeStripeSearchValue(id)}'`;
  const payload = await stripeRequest(config, `customers/search?limit=1&query=${encodeURIComponent(query)}`);
  return payload?.data?.find((customer) => !customer?.deleted && customerMatchesClerkUser(customer, id)) || null;
}

async function updateCustomerClerkMetadata(config, customer, clerkUserId) {
  if (!customer?.id || !clerkUserId || customerMatchesClerkUser(customer, clerkUserId)) return customer;
  const params = new URLSearchParams();
  params.set('metadata[clerkUserId]', clerkUserId);
  params.set('metadata[clerk_user_id]', clerkUserId);
  return stripeRequest(config, `customers/${encodeURIComponent(customer.id)}`, {
    method: 'POST',
    body: params,
  });
}

async function createStripeCustomer(config, { clerkUserId = '', clerkEmail = '' } = {}) {
  const email = normalizeEmail(clerkEmail);
  const id = String(clerkUserId || '').trim();
  if (!id || !email) {
    throw new Error('A verified Clerk user and email are required to create a Stripe customer.');
  }

  const params = new URLSearchParams();
  params.set('email', email);
  params.set('metadata[clerkUserId]', id);
  params.set('metadata[clerk_user_id]', id);

  // The first license check, a checkout click and a second tab can all miss a
  // customer that Stripe Search has not indexed yet. One key per identity makes
  // Stripe return the same customer to each of them instead of creating more.
  const idempotencyKey = `promptlab-customer:${id}:${(await sha256Hex(email)).slice(0, 32)}`;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await stripeRequest(config, 'customers', {
        method: 'POST',
        body: params,
        idempotencyKey,
      });
    } catch (error) {
      // 409 means the same key is still in flight; once it finishes, a retry
      // replays its saved customer.
      if (error.status !== 409 || attempt >= CUSTOMER_CREATE_RETRY_DELAYS_MS.length) throw error;
      await new Promise((resolve) => setTimeout(resolve, CUSTOMER_CREATE_RETRY_DELAYS_MS[attempt]));
    }
  }
}

export async function getOrCreateStripeCustomer(config, { clerkUserId = '', clerkEmail = '' } = {}) {
  const id = String(clerkUserId || '').trim();
  const email = normalizeEmail(clerkEmail);
  if (!id) {
    throw new Error('A verified Clerk identity is required for billing.');
  }

  // Social logins (e.g. GitHub) can withhold the account email, so resolve by
  // Clerk user-id metadata before requiring an email at all.
  const metadataCustomer = await findCustomerByClerkUserId(config, id);
  if (metadataCustomer) return metadataCustomer;

  if (!email) {
    throw new Error('This sign-in method does not share an email address, so billing could not be linked. Add a verified email to your account and retry.');
  }

  const emailCustomer = await findCustomerByEmail(config, email);
  if (emailCustomer) {
    return updateCustomerClerkMetadata(config, emailCustomer, id);
  }

  return createStripeCustomer(config, { clerkUserId: id, clerkEmail: email });
}

export async function getCustomerById(config, customerId) {
  const id = String(customerId || '').trim();
  if (!id) return null;
  try {
    const payload = await stripeRequest(config, `customers/${encodeURIComponent(id)}`);
    return payload?.deleted ? null : payload;
  } catch (error) {
    if (/No such customer/i.test(error.message || '')) return null;
    throw error;
  }
}

export async function listSubscriptions(config, customerId) {
  const id = String(customerId || '').trim();
  if (!id) return [];
  const payload = await stripeRequest(
    config,
    `subscriptions?customer=${encodeURIComponent(id)}&status=all&limit=100`,
  );
  return Array.isArray(payload?.data) ? payload.data : [];
}

function buildSubscriptionCandidate(subscription, allowedPriceMap) {
  const items = Array.isArray(subscription?.items?.data) ? subscription.items.data : [];
  const matchedItem = items.find((item) => allowedPriceMap.has(String(item?.price?.id || '')));
  if (!matchedItem) return null;
  const priceId = String(matchedItem?.price?.id || '');
  return {
    id: String(subscription?.id || ''),
    status: String(subscription?.status || '').trim().toLowerCase(),
    priceId,
    billingPeriod: allowedPriceMap.get(priceId) || '',
  };
}

function rankSubscriptionStatus(status) {
  switch (status) {
    case 'active':
      return 0;
    case 'trialing':
      return 1;
    case 'past_due':
      return 2;
    case 'incomplete':
      return 3;
    case 'unpaid':
      return 4;
    case 'canceled':
      return 5;
    default:
      return 6;
  }
}

function pickBestSubscription(subscriptions, allowedPriceMap) {
  const candidates = subscriptions
    .map((subscription) => buildSubscriptionCandidate(subscription, allowedPriceMap))
    .filter(Boolean);

  if (candidates.length === 0) return null;
  return candidates.sort((left, right) => rankSubscriptionStatus(left.status) - rankSubscriptionStatus(right.status))[0];
}

export function normalizeBillingRecord({ customer = null, subscriptions = [], config = buildStripeConfig() }) {
  const allowedPriceMap = getAllowedPriceMap(config);
  const activeSubscription = pickBestSubscription(subscriptions, allowedPriceMap);
  const status = activeSubscription?.status || (customer ? 'inactive' : 'free');
  const plan = activeSubscription && ACTIVE_SUBSCRIPTION_STATUSES.has(status) ? 'pro' : 'free';
  return {
    ok: true,
    plan,
    status,
    billingPeriod: activeSubscription?.billingPeriod || '',
    priceId: activeSubscription?.priceId || '',
    productName: activeSubscription ? 'Prompt Lab Pro' : '',
    customerId: String(customer?.id || ''),
    customerEmail: normalizeEmail(customer?.email || ''),
    customerName: String(customer?.name || '').trim(),
    subscriptionId: String(activeSubscription?.id || ''),
    manageUrl: config.portalReturnUrl,
  };
}

export async function lookupBilling(config, { customerId = '', customerEmail = '' } = {}) {
  let customer = await getCustomerById(config, customerId);
  if (!customer && customerEmail) {
    customer = await findCustomerByEmail(config, customerEmail);
  }
  if (!customer) {
    return normalizeBillingRecord({ customer: null, subscriptions: [], config });
  }

  const subscriptions = await listSubscriptions(config, customer.id);
  return normalizeBillingRecord({ customer, subscriptions, config });
}

export async function lookupBillingForClerk(config, { clerkUserId = '', clerkEmail = '' } = {}) {
  const customer = await getOrCreateStripeCustomer(config, { clerkUserId, clerkEmail });
  const subscriptions = await listSubscriptions(config, customer.id);
  return normalizeBillingRecord({ customer, subscriptions, config });
}

export async function createPortalSession(config, { customerId = '', customerEmail = '' } = {}) {
  const customer = await getCustomerById(config, customerId) || await findCustomerByEmail(config, customerEmail);
  if (!customer?.id) {
    throw new Error('No Stripe customer was found for this billing email.');
  }

  const params = new URLSearchParams();
  params.set('customer', customer.id);
  params.set('return_url', config.portalReturnUrl);

  const payload = await stripeRequest(config, 'billing_portal/sessions', {
    method: 'POST',
    body: params,
  });

  return {
    url: payload?.url || '',
    customerId: customer.id,
    customerEmail: normalizeEmail(customer.email || customerEmail),
  };
}

export async function createPortalSessionForClerk(config, { clerkUserId = '', clerkEmail = '' } = {}) {
  // Stripe Search can lag a newly created customer. The email list is a
  // fallback only when its customer is already bound to this Clerk identity.
  const customer = await findCustomerByClerkUserId(config, clerkUserId)
    || (clerkEmail ? await findCustomerByEmail(config, clerkEmail) : null);
  if (!customer?.id || !customerMatchesClerkUser(customer, clerkUserId)) {
    throw new Error('No Stripe customer is bound to this signed-in account.');
  }

  const params = new URLSearchParams();
  params.set('customer', customer.id);
  params.set('return_url', config.portalReturnUrl);

  const payload = await stripeRequest(config, 'billing_portal/sessions', {
    method: 'POST',
    body: params,
  });

  return {
    url: payload?.url || '',
    customerId: customer.id,
    customerEmail: normalizeEmail(customer.email || clerkEmail),
  };
}

export async function verifyStripeSignature(rawBody, signatureHeader, secret, toleranceSeconds = 300) {
  if (!secret) return false;
  const header = String(signatureHeader || '').trim();
  if (!header) return false;

  const timestampMatch = header.match(/(?:^|,)\s*t=(\d+)/);
  const signatures = Array.from(header.matchAll(/(?:^|,)\s*v1=([0-9a-fA-F]+)/g)).map((match) => match[1]);
  if (!timestampMatch || signatures.length === 0) return false;

  const timestamp = Number(timestampMatch[1]);
  if (!Number.isFinite(timestamp)) return false;
  if (Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${rawBody}`));
  const digest = Array.from(new Uint8Array(signatureBuffer))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');

  return signatures.some((value) => value.toLowerCase() === digest.toLowerCase());
}

export function buildStripeWebhookRecord(payload = {}, config = buildStripeConfig()) {
  const eventType = String(payload?.type || 'billing.webhook.received').trim().toLowerCase();
  const object = payload?.data?.object || {};
  const allowedPriceMap = getAllowedPriceMap(config);
  const priceId = String(
    object?.items?.data?.[0]?.price?.id ||
    object?.plan?.id ||
    object?.metadata?.price_id ||
    '',
  );
  const customerEmail = normalizeEmail(
    object?.customer_details?.email ||
    object?.customer_email ||
    object?.email ||
    object?.metadata?.contact_email ||
    '',
  );
  return {
    type: eventType,
    occurredAt: new Date().toISOString(),
    customerId: String(object?.customer || object?.id || '').trim(),
    customerEmail,
    customerName: String(
      object?.customer_details?.name ||
      object?.name ||
      object?.metadata?.customer_name ||
      '',
    ).trim(),
    subscriptionId: String(object?.subscription || object?.id || '').trim(),
    status: String(object?.status || '').trim().toLowerCase(),
    billingPeriod: allowedPriceMap.get(priceId) || String(object?.metadata?.billing_period || '').trim().toLowerCase(),
    priceId,
    rawType: String(payload?.type || ''),
    payload,
  };
}

function objectId(value) {
  if (typeof value === 'string') return value.trim();
  return String(value?.id || '').trim();
}

function isAlreadyCanceledError(error) {
  return (error?.status === 400 || error?.status === 404)
    && /already been canceled|already canceled|No such subscription/i.test(error?.message || '');
}

function invoiceSubscriptionId(invoice) {
  const direct = objectId(invoice?.subscription)
    || objectId(invoice?.parent?.subscription_details?.subscription);
  if (direct) return direct;
  const lines = Array.isArray(invoice?.lines?.data) ? invoice.lines.data : [];
  for (const line of lines) {
    const fromLine = objectId(line?.subscription)
      || objectId(line?.parent?.subscription_item_details?.subscription);
    if (fromLine) return fromLine;
  }
  return '';
}

function invoicePriceIds(invoice) {
  const lines = Array.isArray(invoice?.lines?.data) ? invoice.lines.data : [];
  return lines
    .map((line) => objectId(line?.price) || objectId(line?.pricing?.price_details?.price))
    .filter(Boolean);
}

// Resolve the disputed charge and the invoice it paid, so the policy only acts
// on disputes of Prompt Lab subscription payments. Older Stripe API versions put
// the invoice on the charge; from 2025-03-31 it is found through the charge's
// PaymentIntent in /v1/invoice_payments. No expansion is requested, so the
// lookup works whatever API version the account defaults to.
async function resolveDisputedPayment(config, dispute) {
  let charge = dispute?.charge && typeof dispute.charge === 'object' ? dispute.charge : null;
  if (!charge) {
    const chargeId = objectId(dispute?.charge);
    if (!chargeId) return { charge: null, invoice: null };
    charge = await stripeRequest(config, `charges/${encodeURIComponent(chargeId)}`);
  }
  let invoice = charge?.invoice && typeof charge.invoice === 'object' ? charge.invoice : null;
  let invoiceId = invoice ? '' : objectId(charge?.invoice);
  const paymentIntentId = objectId(charge?.payment_intent);
  if (!invoice && !invoiceId && paymentIntentId) {
    const params = new URLSearchParams({
      'payment[type]': 'payment_intent',
      'payment[payment_intent]': paymentIntentId,
      limit: '1',
    });
    try {
      const payments = await stripeRequest(config, `invoice_payments?${params.toString()}`);
      invoiceId = objectId(payments?.data?.[0]?.invoice);
    } catch (error) {
      // Accounts on API versions without invoice payments answer 400/404; the
      // charge then has no invoice to find.
      if (error?.status !== 400 && error?.status !== 404) throw error;
    }
  }
  if (!invoice && invoiceId) {
    invoice = await stripeRequest(config, `invoices/${encodeURIComponent(invoiceId)}`);
  }
  return { charge, invoice };
}

// Billing policy (docs/billing-policy.md): when a customer opens a card dispute
// (chargeback or inquiry) on a Prompt Lab subscription payment, that Prompt Lab
// subscription is canceled immediately, which ends Pro on the next license check
// and stops further charges. The disputed charge must have paid an invoice for
// a configured Prompt Lab price or subscription; disputes of other charges on
// the same Stripe customer change nothing. Only subscriptions that existed when
// the dispute was opened are touched, so a later resubscription survives a
// delayed or retried delivery of the same event. All other events are recorded
// only; refunds do not change access by themselves.
export async function applyWebhookAccessPolicy(payload = {}, config = buildStripeConfig()) {
  const eventType = String(payload?.type || '').trim().toLowerCase();
  if (eventType !== 'charge.dispute.created') return { action: 'none' };

  const dispute = payload?.data?.object || {};
  const disputeId = objectId(dispute);
  if (!objectId(dispute?.charge)) return { action: 'none', reason: 'dispute has no charge' };
  const { charge, invoice } = await resolveDisputedPayment(config, dispute);
  const customerId = objectId(charge?.customer);
  if (!customerId) return { action: 'none', reason: 'disputed charge has no customer' };
  if (!invoice) {
    return { action: 'none', reason: 'disputed charge is not a subscription payment', customerId };
  }

  const allowedPriceMap = getAllowedPriceMap(config);
  const disputedSubscriptionId = invoiceSubscriptionId(invoice);
  const paidPromptLabPrice = invoicePriceIds(invoice).some((priceId) => allowedPriceMap.has(priceId));

  const disputeCreated = Number(dispute?.created);
  const subscriptions = await listSubscriptions(config, customerId);
  const promptLabSubscriptions = subscriptions.filter((subscription) => {
    const candidate = buildSubscriptionCandidate(subscription, allowedPriceMap);
    if (!candidate || !DISPUTE_CANCELABLE_STATUSES.has(candidate.status)) return false;
    const subscriptionCreated = Number(subscription?.created);
    return !Number.isFinite(disputeCreated) || !Number.isFinite(subscriptionCreated)
      || subscriptionCreated <= disputeCreated;
  });
  // Cancel the subscription the disputed invoice belongs to. Only when the
  // invoice names no subscription but did pay a Prompt Lab price, fall back to
  // the customer's live Prompt Lab subscriptions.
  const targets = disputedSubscriptionId
    ? promptLabSubscriptions.filter((subscription) => String(subscription?.id) === disputedSubscriptionId)
    : (paidPromptLabPrice ? promptLabSubscriptions : []);
  if (targets.length === 0) {
    return {
      action: 'none',
      reason: disputedSubscriptionId || paidPromptLabPrice
        ? 'no cancelable Prompt Lab subscription'
        : 'disputed charge is not a Prompt Lab payment',
      customerId,
    };
  }

  const canceled = [];
  for (const subscription of targets) {
    const params = new URLSearchParams();
    params.set('cancellation_details[comment]', `prompt-lab billing policy: payment disputed (${disputeId || 'dispute'})`);
    try {
      await stripeRequest(config, `subscriptions/${encodeURIComponent(subscription.id)}?${params.toString()}`, {
        method: 'DELETE',
      });
    } catch (error) {
      if (!isAlreadyCanceledError(error)) throw error;
    }
    canceled.push(String(subscription.id));
  }

  return { action: 'canceled', reason: 'payment disputed', customerId, subscriptionIds: canceled };
}

export async function persistStripeWebhookRecord(record, config = buildStripeConfig()) {
  const serialized = JSON.stringify({
    type: record.type,
    occurredAt: record.occurredAt,
    customerId: record.customerId,
    customerEmail: record.customerEmail,
    customerName: record.customerName,
    subscriptionId: record.subscriptionId,
    status: record.status,
    billingPeriod: record.billingPeriod,
    priceId: record.priceId,
    rawType: record.rawType,
  });

  if (hasRedis(config)) {
    const prefix = config.storagePrefix;
    await redisCommand(config, 'rpush', [`${prefix}:events`], serialized);

    if (record.customerId) {
      await redisCommand(config, 'set', [`${prefix}:customer:${record.customerId}`], serialized);
      await redisCommand(config, 'sadd', [`${prefix}:customers`, record.customerId]);
    }
    if (record.customerEmail) {
      await redisCommand(config, 'set', [`${prefix}:email:${record.customerEmail}`], serialized);
      await redisCommand(config, 'sadd', [`${prefix}:emails`, record.customerEmail]);
    }
    if (record.subscriptionId) {
      await redisCommand(config, 'set', [`${prefix}:subscription:${record.subscriptionId}`], serialized);
      await redisCommand(config, 'sadd', [`${prefix}:subscriptions`, record.subscriptionId]);
    }
    return { ok: true, mode: 'redis' };
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('Durable billing storage is required in production. Configure KV_REST_API_URL/KV_REST_API_TOKEN or UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN.');
  }

  if (config.consoleFallback) {
    console.log('[promptlab.billing.webhook]', serialized);
    return { ok: true, mode: 'console' };
  }

  return { ok: true, mode: 'noop' };
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}
