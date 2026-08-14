import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const script = readFileSync(resolve(
  process.cwd(),
  '../prompt-lab-web/public/google-analytics.js',
), 'utf8');
const measurementId = 'G-NDPSYQES8R';
const globalKeys = [
  'PromptLabGoogleAnalytics',
  'dataLayer',
  'gtag',
  `ga-disable-${measurementId}`,
];

function loadGoogleAnalytics() {
  window.eval(script);
}

function dataLayerEntries() {
  return window.dataLayer.map((entry) => Array.from(entry));
}

afterEach(() => {
  localStorage.clear();
  document.getElementById('promptlab-google-analytics')?.remove();
  globalKeys.forEach((key) => delete window[key]);
});

describe('Prompt Lab Google Analytics loader', () => {
  it('blocks the tag until consent is granted, then configures the configured stream', () => {
    loadGoogleAnalytics();

    expect(document.getElementById('promptlab-google-analytics')).toBeNull();
    expect(window[`ga-disable-${measurementId}`]).toBe(true);
    expect(dataLayerEntries()).toContainEqual([
      'consent',
      'default',
      expect.objectContaining({ analytics_storage: 'denied' }),
    ]);

    window.PromptLabGoogleAnalytics.setConsent(true);

    expect(window[`ga-disable-${measurementId}`]).toBe(false);
    expect(document.getElementById('promptlab-google-analytics')).toHaveAttribute(
      'src',
      `https://www.googletagmanager.com/gtag/js?id=${measurementId}`,
    );
    expect(dataLayerEntries()).toContainEqual([
      'config',
      measurementId,
    ]);
  });

  it('uses previously granted consent when the page loads', () => {
    localStorage.setItem('pl_telemetry_consent', 'granted');

    loadGoogleAnalytics();

    expect(document.getElementById('promptlab-google-analytics')).not.toBeNull();
    expect(window[`ga-disable-${measurementId}`]).toBe(false);
    expect(dataLayerEntries()).toContainEqual([
      'consent',
      'update',
      expect.objectContaining({ analytics_storage: 'granted' }),
    ]);
  });
});
