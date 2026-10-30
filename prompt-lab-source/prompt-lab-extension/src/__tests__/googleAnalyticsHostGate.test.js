/**
 * @vitest-environment jsdom
 * @vitest-environment-options {"url": "https://prompt-lab-git-branch-example.vercel.app/"}
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// AN-04: Vercel previews (and localhost or QA hosts) never load the GA4 tag or
// send a config hit, even after the visitor allows analytics.
const script = readFileSync(resolve(process.cwd(), '../prompt-lab-web/public/google-analytics.js'), 'utf8');
const measurementId = 'G-NDPSYQES8R';

afterEach(() => {
  localStorage.clear();
  document.getElementById('promptlab-google-analytics')?.remove();
  document.getElementById('promptlab-analytics-consent')?.remove();
  document.getElementById('promptlab-analytics-consent-style')?.remove();
  ['PromptLabGoogleAnalytics', 'dataLayer', 'gtag', `ga-disable-${measurementId}`].forEach((key) => delete window[key]);
});

describe('Google Analytics on a non-production host', () => {
  it('records the consent choice but never loads the tag or configures the stream', () => {
    localStorage.setItem('pl_telemetry_consent', 'granted');
    window.eval(script);
    window.PromptLabGoogleAnalytics.setConsent(true);

    expect(window.location.hostname).toBe('prompt-lab-git-branch-example.vercel.app');
    expect(document.getElementById('promptlab-google-analytics')).toBeNull();
    const entries = window.dataLayer.map((entry) => Array.from(entry));
    expect(entries.some((entry) => entry[0] === 'config')).toBe(false);
  });
});
