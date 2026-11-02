import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeTelemetryEventContext } from '../shared/telemetrySchema.js';

test('landing.demo_completed accepts the redesigned sample strategies', () => {
  const now = Date.now();
  for (const demoMode of ['expanded', 'refined', 'rebuilt', 'balanced']) {
    const out = sanitizeTelemetryEventContext('landing.demo_completed', {
      attributionVersion: 1, placement: 'demo', intent: 'sample', destination: 'demo', demoMode, resultCount: 1, timestamp: now,
    }, { now });
    assert.equal(out.demoMode, demoMode);
  }
});
