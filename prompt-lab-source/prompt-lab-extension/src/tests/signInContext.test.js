import { describe, expect, it } from 'vitest';
import { buildAuthRedirectUrls, buildSignInContext } from '../lib/signInContext.js';

const annual = { upgrade: 'pro', period: 'annual', source: 'landing-pricing' };

describe('signed-out sign-in context (AUD-006)', () => {
  it('explains an upgrade sign-in and names the chosen plan', () => {
    const context = buildSignInContext(annual);
    expect(context.upgrade).toBe(true);
    expect(context.heading).toBe('Sign in to upgrade to Prompt Lab Pro');
    expect(context.body).toContain('annual plan ($79/year)');
    expect(context.body).toContain('Nothing is charged until you confirm in Stripe Checkout');
    expect(buildSignInContext({ ...annual, period: 'monthly' }).body).toContain('monthly plan ($9/month)');
  });

  it('falls back to a plain sign-in message without a valid intent', () => {
    for (const intent of [null, {}, { ...annual, source: 'elsewhere' }, { ...annual, period: 'weekly' }]) {
      const context = buildSignInContext(intent);
      expect(context.upgrade).toBe(false);
      expect(context.heading).toBe('Sign in to Prompt Lab');
    }
  });

  it('returns every Clerk redirect to /app/ with the upgrade intent', () => {
    const urls = buildAuthRedirectUrls('https://promptlab.tools/app/?upgrade=pro&period=annual&source=landing-pricing&extra=1#/create', annual);
    const expected = 'https://promptlab.tools/app/?extra=1&upgrade=pro&period=annual&source=landing-pricing#/create';
    expect(urls.forceRedirectUrl).toBe(expected);
    expect(urls.signUpForceRedirectUrl).toBe(expected);
    expect(urls.fallbackRedirectUrl).toBe(expected);
    expect(urls.signUpFallbackRedirectUrl).toBe(expected);
  });

  it('returns a plain sign-in to /app/ instead of the marketing page', () => {
    const urls = buildAuthRedirectUrls('https://promptlab.tools/app/?stale=1', null);
    expect(urls.forceRedirectUrl).toBeUndefined();
    expect(urls.signUpForceRedirectUrl).toBeUndefined();
    expect(urls.fallbackRedirectUrl).toBe('https://promptlab.tools/app/');
    expect(urls.signUpFallbackRedirectUrl).toBe('https://promptlab.tools/app/');
  });

  it('keeps a Stripe return outcome through the sign-in redirect', () => {
    const success = buildAuthRedirectUrls('https://promptlab.tools/app/?billing=success&stale=1', null);
    expect(success.forceRedirectUrl).toBeUndefined();
    expect(success.fallbackRedirectUrl).toBe('https://promptlab.tools/app/?billing=success');
    expect(success.signUpFallbackRedirectUrl).toBe('https://promptlab.tools/app/?billing=success');
    const cancelled = buildAuthRedirectUrls('https://promptlab.tools/app/?billing=canceled', null);
    expect(cancelled.fallbackRedirectUrl).toBe('https://promptlab.tools/app/?billing=cancelled');
    const ignored = buildAuthRedirectUrls('https://promptlab.tools/app/?billing=evil', null);
    expect(ignored.fallbackRedirectUrl).toBe('https://promptlab.tools/app/');
  });
});
