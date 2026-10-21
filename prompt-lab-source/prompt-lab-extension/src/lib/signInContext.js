// AUD-006: context and redirect targets for the signed-out /app/ sign-in card.
// A visitor who clicked "Go Pro" on the landing page arrives at
// /app/?upgrade=pro&period=<monthly|annual>&source=landing-pricing while
// signed out. The card must say why they are signing in, and every Clerk
// redirect (sign-in, sign-up, extra verification steps) must come back to
// that same URL so App reopens the upgrade dialog with the plan selected.
import { buildLandingIntentRedirectUrl, normalizeLandingIntent } from './landingAttribution.js';
import { PRICE_COPY } from '../../../shared/pricing.js';

const PLAN_COPY = {
  monthly: `the monthly plan (${PRICE_COPY.monthlyPerPeriod})`,
  annual: `the annual plan (${PRICE_COPY.annualPerPeriod})`,
};

export function buildSignInContext(intent) {
  const safeIntent = normalizeLandingIntent(intent);
  if (!safeIntent) {
    return {
      upgrade: false,
      heading: 'Sign in to Prompt Lab',
      body: 'Draft, improve, save and evaluate prompts in one workspace. Signing in keeps your library and billing with your account.',
    };
  }
  return {
    upgrade: true,
    period: safeIntent.period,
    heading: 'Sign in to upgrade to Prompt Lab Pro',
    body: `You chose ${PLAN_COPY[safeIntent.period]}. After you sign in or create an account, Prompt Lab reopens the upgrade options with that plan selected. Nothing is charged until you confirm in Stripe Checkout.`,
  };
}

// The URL Clerk should return to. With an upgrade intent it is the canonical
// intent URL; otherwise the current /app/ URL (without a stale query), so a
// plain sign-in lands in the workspace instead of the marketing page.
export function buildAuthRedirectUrls(href, intent) {
  let appUrl = '';
  try {
    const url = new URL(String(href));
    appUrl = `${url.origin}${url.pathname}`;
  } catch {
    appUrl = '';
  }
  const intentUrl = buildLandingIntentRedirectUrl(href, intent);
  const target = intentUrl || appUrl;
  return {
    forceRedirectUrl: intentUrl || undefined,
    fallbackRedirectUrl: target || undefined,
    signUpForceRedirectUrl: intentUrl || undefined,
    signUpFallbackRedirectUrl: target || undefined,
  };
}
