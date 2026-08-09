import { describe, expect, it, vi } from 'vitest';
import {
  LANDING_ATTRIBUTION_EVENT_LIMIT,
  LANDING_ATTRIBUTION_STORAGE_KEY,
  buildLandingIntentRedirectUrl,
  buildLandingTelemetryEvents,
  clearLandingAttribution,
  parseLandingIntent,
  readLandingAttribution,
  sanitizeLandingAttribution,
  stripLandingIntentParams,
} from '../lib/landingAttribution.js';

const NOW = Date.UTC(2026, 7, 6, 12, 0, 0);

function pricingIntent(period) {
  return {
    upgrade: 'pro',
    period,
    source: 'landing-pricing',
  };
}

function ctaEvent(overrides = {}) {
  return {
    event: 'landing.cta_clicked',
    placement: 'pricing_pro',
    intent: 'upgrade',
    destination: 'app',
    period: 'monthly',
    timestamp: NOW,
    ...overrides,
  };
}

describe('landing pricing intent', () => {
  it.each(['monthly', 'annual'])('accepts the allowlisted %s pricing intent', (period) => {
    expect(parseLandingIntent(`?upgrade=pro&period=${period}&source=landing-pricing`)).toEqual(
      pricingIntent(period),
    );
  });

  it.each([
    '',
    '?upgrade=free&period=monthly&source=landing-pricing',
    '?upgrade=pro&period=weekly&source=landing-pricing',
    '?upgrade=pro&period=annual&source=campaign',
    '?upgrade=pro&period=annual&period=monthly&source=landing-pricing',
    '?upgrade=pro&period=annual',
  ])('ignores invalid or ambiguous intent: %s', (search) => {
    expect(parseLandingIntent(search)).toBeNull();
  });

  it('builds a same-page Clerk redirect from allowlisted values only', () => {
    expect(buildLandingIntentRedirectUrl(
      'https://promptlab.tools/app?return=library#saved',
      pricingIntent('annual'),
    )).toBe('https://promptlab.tools/app?return=library&upgrade=pro&period=annual&source=landing-pricing#saved');

    expect(buildLandingIntentRedirectUrl(
      'https://promptlab.tools/app',
      { upgrade: 'pro', period: 'javascript:alert(1)', source: 'landing-pricing' },
    )).toBe('');
  });

  it('removes only consumed landing-intent parameters', () => {
    expect(stripLandingIntentParams(
      'https://promptlab.tools/app?upgrade=pro&period=monthly&source=landing-pricing&return=library#saved',
    )).toBe('/app?return=library#saved');
  });
});

describe('landing attribution handoff', () => {
  it('keeps only allowlisted, content-free fields', () => {
    const result = sanitizeLandingAttribution({
      version: 1,
      events: [{
        ...ctaEvent(),
        prompt: 'private prompt text',
        output: 'private model output',
        search: 'private docs query',
        email: 'person@example.com',
        apiKey: 'sk-secret',
        arbitraryUrl: 'https://example.com/private',
      }],
    }, { now: NOW });

    expect(result).toEqual({
      version: 1,
      events: [ctaEvent()],
    });
    expect(JSON.stringify(result)).not.toMatch(/private|example\.com|sk-secret|person@/);
  });

  it('round-trips every captured measurement event without visitor content', () => {
    const plannedEvents = [
      {
        event: 'landing.cta_clicked',
        placement: 'privacy',
        intent: 'open',
        destination: 'privacy',
        timestamp: NOW - 5,
      },
      {
        event: 'landing.demo_completed',
        placement: 'demo',
        intent: 'sample',
        destination: 'demo',
        demoMode: 'concise',
        resultCount: 1,
        timestamp: NOW - 4,
      },
      {
        event: 'landing.surface_selected',
        placement: 'surface_extension',
        intent: 'open',
        destination: 'setup',
        timestamp: NOW - 3,
      },
      {
        event: 'landing.pricing_period_selected',
        placement: 'pricing_pro',
        intent: 'upgrade',
        period: 'annual',
        timestamp: NOW - 2,
      },
      {
        event: 'landing.docs_result_selected',
        placement: 'docs_search',
        intent: 'open',
        destination: 'guide',
        resultCount: 3,
        timestamp: NOW - 1,
      },
    ].map((event) => ({
      ...event,
      prompt: 'private prompt',
      output: 'private output',
      search: 'private search',
      email: 'private@example.com',
      apiKey: 'sk-private',
    }));

    const sanitized = sanitizeLandingAttribution({ version: 1, events: plannedEvents }, { now: NOW });
    const telemetryEvents = buildLandingTelemetryEvents({
      landingAttribution: sanitized,
      now: NOW,
    });

    expect(telemetryEvents.map(({ event }) => event)).toEqual([
      'landing.referral_opened',
      'landing.cta_clicked',
      'landing.demo_completed',
      'landing.surface_selected',
      'landing.pricing_period_selected',
      'landing.docs_result_selected',
    ]);
    expect(JSON.stringify(telemetryEvents)).not.toMatch(/private|sk-private|person@/);
  });

  it('drops stale, unknown, and non-allowlisted events', () => {
    expect(sanitizeLandingAttribution({
      version: 1,
      events: [
        ctaEvent({ timestamp: NOW - (25 * 60 * 60 * 1000) }),
        ctaEvent({ timestamp: String(NOW) }),
        ctaEvent({ placement: 'visitor-authored-value' }),
        { event: 'landing.prompt_captured', prompt: 'do not keep me', timestamp: NOW },
      ],
    }, { now: NOW })).toBeNull();
  });

  it('bounds the stored queue and reportable event count', () => {
    const events = Array.from({ length: LANDING_ATTRIBUTION_EVENT_LIMIT + 5 }, (_, index) => (
      ctaEvent({ timestamp: NOW - index })
    ));
    const attribution = sanitizeLandingAttribution({ version: 1, events }, { now: NOW });

    expect(attribution.events).toHaveLength(LANDING_ATTRIBUTION_EVENT_LIMIT);
    expect(buildLandingTelemetryEvents({
      landingAttribution: attribution,
      now: NOW,
    })).toHaveLength(LANDING_ATTRIBUTION_EVENT_LIMIT);
  });

  it('retains the latest CTA when adding the referral event to a full queue', () => {
    const demoEvents = Array.from({ length: LANDING_ATTRIBUTION_EVENT_LIMIT - 1 }, (_, index) => ({
      event: 'landing.demo_completed',
      placement: 'demo',
      intent: 'sample',
      destination: 'demo',
      demoMode: 'balanced',
      resultCount: 1,
      timestamp: NOW - (LANDING_ATTRIBUTION_EVENT_LIMIT - index),
    }));
    const events = buildLandingTelemetryEvents({
      landingAttribution: {
        version: 1,
        events: [...demoEvents, ctaEvent()],
      },
      now: NOW,
    });

    expect(events).toHaveLength(LANDING_ATTRIBUTION_EVENT_LIMIT);
    expect(events.at(-1)).toMatchObject({
      event: 'landing.cta_clicked',
      context: { placement: 'pricing_pro', period: 'monthly' },
    });
  });

  it('adds referral and pricing CTA events with sanitized period context', () => {
    expect(buildLandingTelemetryEvents({
      landingIntent: pricingIntent('annual'),
      now: NOW,
    })).toEqual([
      {
        event: 'landing.referral_opened',
        context: {
          attributionVersion: 1,
          placement: 'pricing_pro',
          intent: 'upgrade',
          destination: 'app',
          period: 'annual',
        },
      },
      {
        event: 'landing.cta_clicked',
        context: {
          attributionVersion: 1,
          placement: 'pricing_pro',
          intent: 'upgrade',
          destination: 'app',
          period: 'annual',
        },
      },
    ]);
  });

  it('uses the validated URL period as pricing intent source of truth', () => {
    const events = buildLandingTelemetryEvents({
      landingIntent: pricingIntent('annual'),
      landingAttribution: { version: 1, events: [ctaEvent({ period: 'monthly' })] },
      now: NOW,
    });

    expect(events.find(({ event }) => event === 'landing.cta_clicked')).toMatchObject({
      context: { placement: 'pricing_pro', period: 'annual' },
    });
  });

  it('reads and clears the exact same-origin sessionStorage key safely', () => {
    const storage = {
      getItem: vi.fn(() => JSON.stringify({ version: 1, events: [ctaEvent()] })),
      removeItem: vi.fn(),
    };

    expect(readLandingAttribution(storage, { now: NOW })).toEqual({
      version: 1,
      events: [ctaEvent()],
    });
    expect(storage.getItem).toHaveBeenCalledWith(LANDING_ATTRIBUTION_STORAGE_KEY);
    expect(clearLandingAttribution(storage)).toBe(true);
    expect(storage.removeItem).toHaveBeenCalledWith(LANDING_ATTRIBUTION_STORAGE_KEY);
  });
});
