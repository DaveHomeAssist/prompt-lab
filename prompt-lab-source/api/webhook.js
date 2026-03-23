import { json } from './_lib/http.js';
import { getStripeClient, getStripeConfig } from './_lib/stripeBilling.js';
import { writeEntitlements, deleteEntitlements } from './_lib/entitlements.js';

export const config = { runtime: 'edge' };

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

const PLAN_ENTITLEMENTS = {
  pro: [
    'unlimited_library',
    'advanced_compare',
    'version_history',
    'import_export',
    'advanced_variables',
  ],
};

function resolveEntitlements(subscription) {
  if (!subscription || subscription.status !== 'active') {
    return [];
  }
  return PLAN_ENTITLEMENTS.pro || [];
}

function extractClerkUserId(obj) {
  return obj?.metadata?.clerkUserId || null;
}

export default async function handler(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed.' }, 405);
  }

  if (!WEBHOOK_SECRET) {
    return json({ error: 'Webhook secret not configured.' }, 503);
  }

  const { secretKey } = getStripeConfig();
  if (!secretKey) {
    return json({ error: 'Stripe not configured.' }, 503);
  }

  const body = await request.text();
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    return json({ error: 'Missing stripe-signature header.' }, 400);
  }

  let event;
  try {
    const stripe = getStripeClient();
    event = await stripe.webhooks.constructEventAsync(body, signature, WEBHOOK_SECRET);
  } catch (err) {
    return json({ error: `Webhook signature verification failed: ${err.message}` }, 400);
  }

  const handled = new Set([
    'customer.subscription.created',
    'customer.subscription.updated',
    'customer.subscription.deleted',
  ]);

  if (!handled.has(event.type)) {
    return json({ ok: true, ignored: true, type: event.type }, 200);
  }

  const subscription = event.data.object;
  const clerkUserId = extractClerkUserId(subscription);

  if (!clerkUserId) {
    return json({ error: 'No clerkUserId in subscription metadata.' }, 400);
  }

  try {
    if (event.type === 'customer.subscription.deleted') {
      await deleteEntitlements(clerkUserId);
    } else {
      const entitlements = resolveEntitlements(subscription);
      await writeEntitlements(clerkUserId, {
        plan: entitlements.length > 0 ? 'pro' : 'free',
        status: subscription.status,
        entitlements,
        stripeCustomerId: subscription.customer,
        stripeSubscriptionId: subscription.id,
        updatedAt: new Date().toISOString(),
      });
    }

    return json({ ok: true, type: event.type, clerkUserId }, 200);
  } catch (err) {
    return json({ error: `Entitlement update failed: ${err.message}` }, 500);
  }
}
