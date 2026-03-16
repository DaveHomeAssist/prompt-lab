import test from 'node:test';
import assert from 'node:assert/strict';

import { parseEnhancedPayload } from '../src/promptUtils.js';

// ── assumptions field parsing ───────────────────────────────────────────────

test('parseEnhancedPayload extracts assumptions array', () => {
  const payload = parseEnhancedPayload(JSON.stringify({
    enhanced: 'Write a blog post about gardening.',
    variants: [],
    notes: 'Added format and audience.',
    assumptions: ['Medium: blog post', 'Audience: general readers'],
    tags: ['Writing'],
  }));
  assert.deepEqual(payload.assumptions, ['Medium: blog post', 'Audience: general readers']);
});

test('parseEnhancedPayload returns empty array when assumptions missing', () => {
  const payload = parseEnhancedPayload(JSON.stringify({
    enhanced: 'Write about gardening.',
    variants: [],
    notes: '',
    tags: [],
  }));
  assert.deepEqual(payload.assumptions, []);
});

test('parseEnhancedPayload returns empty array when assumptions is null', () => {
  const payload = parseEnhancedPayload(JSON.stringify({
    enhanced: 'Write about gardening.',
    variants: [],
    notes: '',
    assumptions: null,
    tags: [],
  }));
  assert.deepEqual(payload.assumptions, []);
});

test('parseEnhancedPayload filters empty strings from assumptions', () => {
  const payload = parseEnhancedPayload(JSON.stringify({
    enhanced: 'Improved prompt.',
    variants: [],
    notes: '',
    assumptions: ['Added tone: professional', '', '  '],
    tags: [],
  }));
  assert.deepEqual(payload.assumptions, ['Added tone: professional']);
});

test('parseEnhancedPayload coerces non-string assumption entries', () => {
  const payload = parseEnhancedPayload(JSON.stringify({
    enhanced: 'Improved prompt.',
    variants: [],
    notes: '',
    assumptions: ['Valid assumption', 42, { detail: 'object entry' }],
    tags: [],
  }));
  // Non-strings get coerced via coercePromptText
  assert.ok(payload.assumptions.length >= 1);
  assert.equal(payload.assumptions[0], 'Valid assumption');
});

// ── backward compatibility ──────────────────────────────────────────────────

test('older payloads without assumptions field still parse correctly', () => {
  const payload = parseEnhancedPayload(JSON.stringify({
    enhanced: 'Legacy enhanced prompt.',
    variants: [{ label: 'V1', content: 'variant content' }],
    notes: 'Some notes.',
    tags: ['Code'],
  }));
  assert.equal(payload.enhanced, 'Legacy enhanced prompt.');
  assert.equal(payload.variants.length, 1);
  assert.equal(payload.notes, 'Some notes.');
  assert.deepEqual(payload.assumptions, []);
  assert.deepEqual(payload.tags, ['Code']);
});

test('payload with all fields present parses completely', () => {
  const payload = parseEnhancedPayload(JSON.stringify({
    enhanced: 'Full prompt.',
    variants: [{ label: 'Alt', content: 'alternative' }],
    notes: 'Changed tone.',
    assumptions: ['Assumed professional tone'],
    tags: ['Writing'],
  }));
  assert.equal(payload.enhanced, 'Full prompt.');
  assert.equal(payload.notes, 'Changed tone.');
  assert.deepEqual(payload.assumptions, ['Assumed professional tone']);
  assert.deepEqual(payload.tags, ['Writing']);
});
