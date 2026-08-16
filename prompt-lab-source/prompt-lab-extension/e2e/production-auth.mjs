const PRODUCTION_APP_URL = 'https://promptlab.tools/app/';

function requiredEnv(env, name) {
  const value = String(env?.[name] || '').trim();
  if (!value) throw new Error(`${name} must be configured for the production Free-account smoke.`);
  return value;
}

function productionAppUrl(value) {
  const url = new URL(value || PRODUCTION_APP_URL);
  if (url.origin !== 'https://promptlab.tools' || url.pathname !== '/app/') {
    throw new Error('PROMPT_LAB_PRODUCTION_URL must be exactly https://promptlab.tools/app/.');
  }
  return url;
}

export function readProductionFreeSmokeConfig(env = process.env) {
  const appUrl = productionAppUrl(env.PROMPT_LAB_PRODUCTION_URL);
  const clerkUserId = requiredEnv(env, 'PROMPTLAB_QA_FREE_USER_ID');
  if (!/^user_[A-Za-z0-9]+$/.test(clerkUserId)) {
    throw new Error('PROMPTLAB_QA_FREE_USER_ID must be a Clerk user ID for the dedicated Free QA account.');
  }

  return {
    appUrl,
    clerkSecretKey: requiredEnv(env, 'CLERK_SECRET_KEY'),
    clerkUserId,
  };
}

export function forbiddenRequestCategory(rawUrl) {
  const url = new URL(rawUrl);
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();

  if (host === 'api.anthropic.com' || host.endsWith('.anthropic.com')) return 'provider';
  if (host === 'stripe.com' || host.endsWith('.stripe.com') || host.endsWith('.stripe.network')) return 'Stripe';
  if (/\/api\/billing\/(checkout|portal)(?:\/|$)/.test(path)) return 'billing';
  if (/\/api\/(proxy|telemetry)(?:\/|$)/.test(path)) return path.includes('telemetry') ? 'telemetry' : 'provider proxy';
  if (
    host.includes('telemetry')
    || host.includes('google-analytics')
    || host.includes('googletagmanager')
    || host.includes('posthog')
    || host.includes('sentry')
    || host.includes('vercel-insights')
    || path.includes('/_vercel/insights')
    || path.includes('/_vercel/speed-insights')
  ) return 'telemetry';

  return null;
}

export function isProductionLicenseResponse(rawUrl, productionOrigin) {
  const url = new URL(rawUrl);
  return url.origin === productionOrigin && url.pathname === '/api/billing/license';
}
