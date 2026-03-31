const LEMON_API_BASE = 'https://api.lemonsqueezy.com/v1';
const DEFAULT_PORTAL_URL = 'https://app.lemonsqueezy.com/my-orders';

function readStringEnv(name, fallback = '') {
  const value = process.env[name];
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function readBooleanEnv(name, fallback = false) {
  const value = readStringEnv(name);
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export function createCorsHeaders(extraHeaders = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    ...extraHeaders,
  };
}

export function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...createCorsHeaders(extraHeaders),
    },
  });
}

export function optionsResponse() {
  return new Response(null, {
    status: 204,
    headers: createCorsHeaders(),
  });
}

export function buildBillingConfig() {
  const storeUrl = readStringEnv('LEMON_SQUEEZY_STORE_URL');
  const portalUrl = readStringEnv('LEMON_SQUEEZY_PORTAL_URL')
    || (storeUrl ? `${storeUrl.replace(/\/+$/, '')}/billing` : DEFAULT_PORTAL_URL);

  return {
    apiKey: readStringEnv('LEMON_SQUEEZY_API_KEY'),
    storeId: readStringEnv('LEMON_SQUEEZY_STORE_ID'),
    monthlyVariantId: readStringEnv('LEMON_SQUEEZY_MONTHLY_VARIANT_ID'),
    yearlyVariantId: readStringEnv('LEMON_SQUEEZY_YEARLY_VARIANT_ID'),
    redirectUrl: readStringEnv('LEMON_SQUEEZY_REDIRECT_URL', 'https://promptlab.tools/app/'),
    portalUrl,
    testMode: readBooleanEnv('LEMON_SQUEEZY_TEST_MODE'),
  };
}

export function getAllowedVariantMap(config = buildBillingConfig()) {
  return new Map(
    [
      [config.monthlyVariantId, 'monthly'],
      [config.yearlyVariantId, 'annual'],
    ].filter(([variantId]) => Boolean(variantId)),
  );
}

export function resolveCheckoutVariantId(config, period) {
  if (period === 'annual') return config.yearlyVariantId;
  if (period === 'monthly') return config.monthlyVariantId;
  return '';
}

export function extractJsonApiError(payload, fallback = 'Billing request failed.') {
  const firstError = payload?.errors?.[0];
  if (typeof firstError?.detail === 'string' && firstError.detail.trim()) return firstError.detail.trim();
  if (typeof firstError?.title === 'string' && firstError.title.trim()) return firstError.title.trim();
  if (typeof payload?.error === 'string' && payload.error.trim()) return payload.error.trim();
  return fallback;
}

export async function parseJsonBody(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

async function parseJsonSafe(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function createCheckout(config, {
  period = 'monthly',
  email = '',
  name = '',
  source = 'app',
  deviceId = '',
  sessionId = '',
  surface = '',
  contactEmail = '',
} = {}) {
  if (!config.apiKey || !config.storeId) {
    throw new Error('Lemon Squeezy billing is not configured.');
  }

  const variantId = resolveCheckoutVariantId(config, period);
  if (!variantId) {
    throw new Error(`No Lemon Squeezy variant is configured for "${period}".`);
  }

  const checkoutPayload = {
    data: {
      type: 'checkouts',
      attributes: {
        product_options: {
          enabled_variants: [Number(variantId)],
          redirect_url: config.redirectUrl,
        },
        checkout_options: {
          embed: false,
        },
        checkout_data: {
          ...(email ? { email } : {}),
          ...(name ? { name } : {}),
          custom: {
            app: 'prompt-lab',
            source,
            plan: period,
            ...(deviceId ? { device_id: deviceId } : {}),
            ...(sessionId ? { session_id: sessionId } : {}),
            ...(surface ? { surface } : {}),
            ...(contactEmail ? { contact_email: contactEmail } : {}),
          },
        },
        test_mode: config.testMode,
      },
      relationships: {
        store: {
          data: {
            type: 'stores',
            id: String(config.storeId),
          },
        },
        variant: {
          data: {
            type: 'variants',
            id: String(variantId),
          },
        },
      },
    },
  };

  const response = await fetch(`${LEMON_API_BASE}/checkouts`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.api+json',
      'Content-Type': 'application/vnd.api+json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(checkoutPayload),
  });

  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(extractJsonApiError(payload, 'Lemon Squeezy checkout creation failed.'));
  }

  return {
    checkoutUrl: payload?.data?.attributes?.url || '',
    variantId: String(variantId),
    period,
  };
}

export async function callLicenseApi(action, body) {
  const endpoint = (() => {
    switch (action) {
      case 'activate':
        return 'activate';
      case 'deactivate':
        return 'deactivate';
      case 'validate':
        return 'validate';
      default:
        throw new Error('Unknown billing action.');
    }
  })();

  const response = await fetch(`${LEMON_API_BASE}/licenses/${endpoint}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
    },
    body: new URLSearchParams(body).toString(),
  });

  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(extractJsonApiError(payload, 'Lemon Squeezy license request failed.'));
  }

  return payload;
}

export function normalizeLicenseRecord(payload, config = buildBillingConfig()) {
  const allowedVariants = getAllowedVariantMap(config);
  const meta = payload?.meta || {};
  const license = payload?.license_key || {};
  const instance = payload?.instance || null;
  const variantId = String(meta.variant_id || '');
  const billingPeriod = allowedVariants.get(variantId);

  if (!billingPeriod) {
    throw new Error('This license key does not match the configured Prompt Lab Pro plans.');
  }

  const status = String(license.status || (payload?.valid || payload?.activated ? 'active' : 'invalid')).toLowerCase();
  const isRevoked = status === 'expired' || status === 'disabled';
  const isValid = Boolean(payload?.valid || payload?.activated);

  return {
    valid: isValid,
    plan: isValid && !isRevoked ? 'pro' : 'free',
    status,
    billingPeriod,
    licenseKey: String(license.key || ''),
    instanceId: String(instance?.id || ''),
    instanceName: String(instance?.name || ''),
    customerEmail: String(meta.customer_email || ''),
    customerName: String(meta.customer_name || ''),
    productName: String(meta.product_name || ''),
    variantId,
    manageUrl: config.portalUrl,
    error: typeof payload?.error === 'string' ? payload.error : '',
  };
}
