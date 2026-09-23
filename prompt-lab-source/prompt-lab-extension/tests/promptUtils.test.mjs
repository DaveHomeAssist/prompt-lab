import test from 'node:test';
import assert from 'node:assert/strict';

import {
  scorePrompt,
  extractVars,
  parseEnhancedPayload,
  isTransientError,
  looksSensitive,
} from '../src/promptUtils.js';

import {
  normalizeEntry,
  normalizeLibrary,
  suggestTitleFromText,
} from '../src/lib/promptSchema.js';

test('scorePrompt handles non-string safely', () => {
  assert.equal(scorePrompt(null), null);
  assert.equal(scorePrompt({}), null);
  assert.equal(scorePrompt(''), null);
});

test('extractVars returns empty array on invalid input', () => {
  assert.deepEqual(extractVars(undefined), []);
  assert.deepEqual(extractVars(null), []);
  assert.deepEqual(extractVars(42), []);
});

test('extractVars parses template variables from strings', () => {
  assert.deepEqual(extractVars('Hello {{name}} in {{city}} and {{name}}'), ['name', 'city']);
});

test('normalizeEntry rejects empty content and normalizes valid fields', () => {
  assert.equal(normalizeEntry({ title: 'x' }), null);
  const e = normalizeEntry({ title: '  ', original: 'raw', enhanced: '', tags: ['A', 1], useCount: -2 });
  assert.ok(e);
  assert.equal(e.title.length > 0, true);
  assert.equal(e.enhanced, 'raw');
  assert.deepEqual(e.tags, ['A']);
  assert.equal(e.useCount, 0);
});

test('normalizeLibrary removes invalid entries and de-duplicates ids', () => {
  const list = normalizeLibrary([
    { id: 'dup', original: 'a', enhanced: 'a' },
    { id: 'dup', original: 'b', enhanced: 'b' },
    { foo: 'bar' },
  ]);
  assert.equal(list.length, 2);
  assert.notEqual(list[0].id, list[1].id);
});

test('suggestTitleFromText trims and bounds long text', () => {
  const title = suggestTitleFromText('   This is a very long prompt title '.repeat(6));
  assert.ok(title.length <= 73);
});

test('parseEnhancedPayload handles fenced JSON and noisy wrappers', () => {
  const payload1 = parseEnhancedPayload('```json {"enhanced":"ok"} ```');
  assert.equal(payload1.enhanced, 'ok');
  const payload2 = parseEnhancedPayload('noise {"enhanced":"x"} trailing');
  assert.equal(payload2.enhanced, 'x');
});

test('parseEnhancedPayload coerces structured prompt fields to text', () => {
  const payload = parseEnhancedPayload(JSON.stringify({
    enhanced: {
      role: 'designer',
      task: 'visualize',
      clarity_specificity: 'high',
      format: 'brief',
      constraints: 'strict',
    },
    variants: [
      {
        label: 'Blueprint',
        content: {
          role: 'draftsman',
          task: 'diagram',
        },
      },
    ],
    notes: { source: 'gemini' },
    tags: ['Creative', { name: 'Other' }],
  }));

  assert.match(payload.enhanced, /role: designer/);
  assert.match(payload.enhanced, /task: visualize/);
  assert.match(payload.enhanced, /format: brief/);
  assert.match(payload.enhanced, /constraints: strict/);
  assert.match(payload.enhanced, /clarity_specificity: high/);
  assert.equal(payload.variants[0].label, 'Blueprint');
  assert.match(payload.variants[0].content, /role: draftsman/);
  assert.match(payload.variants[0].content, /task: diagram/);
  assert.match(payload.notes, /source: gemini/);
  assert.equal(payload.tags[0], 'Creative');
  assert.match(payload.tags[1], /name: Other/);
});

test('parseEnhancedPayload unwraps JSON string in enhanced field', () => {
  const inner = JSON.stringify({
    role: 'You are an expert content creator',
    task: 'Create a blog post',
    format: 'Markdown',
    constraints: ['1000 words', 'Include a CTA'],
  });
  const payload = parseEnhancedPayload(JSON.stringify({
    enhanced: inner,
    variants: [],
    notes: '',
    tags: [],
  }));

  assert.match(payload.enhanced, /role: You are an expert content creator/);
  assert.match(payload.enhanced, /task: Create a blog post/);
  assert.match(payload.enhanced, /format: Markdown/);
  assert.match(payload.enhanced, /constraints: 1000 words; Include a CTA/);
  assert.ok(!payload.enhanced.includes('{'));
});

test('isTransientError detects retryable conditions', () => {
  assert.equal(isTransientError(new Error('429 rate limit')), false);
  assert.equal(isTransientError(new Error('Network timeout')), true);
  assert.equal(isTransientError(new Error('Bad request')), false);
});

test('looksSensitive catches common secret markers', () => {
  assert.equal(looksSensitive('my sk-ant-123 key'), true);
  assert.equal(looksSensitive('just a normal sentence'), false);
});
