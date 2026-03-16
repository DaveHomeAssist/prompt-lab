import test from 'node:test';
import assert from 'node:assert/strict';

import { MODES, INTENT_POLICY, buildSystemPrompt } from '../src/constants.js';

// ── INTENT_POLICY exists and is substantive ─────────────────────────────────

test('INTENT_POLICY is a non-empty string', () => {
  assert.equal(typeof INTENT_POLICY, 'string');
  assert.ok(INTENT_POLICY.length > 50, 'Policy should be substantive');
});

test('INTENT_POLICY guards against medium fabrication', () => {
  assert.ok(INTENT_POLICY.includes('medium'), 'Should mention medium');
});

test('INTENT_POLICY guards against audience fabrication', () => {
  assert.ok(INTENT_POLICY.includes('audience'), 'Should mention audience');
});

test('INTENT_POLICY preserves contextual references', () => {
  assert.match(INTENT_POLICY, /the.*this.*that/i, 'Should mention contextual pronouns');
});

test('INTENT_POLICY does not reward verbosity', () => {
  assert.match(INTENT_POLICY, /shorter/i, 'Should note short prompts are not worse');
});

// ── Mode definitions are well-formed ────────────────────────────────────────

test('all modes have id, label, and sys fields', () => {
  for (const mode of MODES) {
    assert.ok(mode.id, `mode missing id`);
    assert.ok(mode.label, `${mode.id} missing label`);
    assert.ok(mode.sys, `${mode.id} missing sys`);
    assert.ok(mode.sys.length > 20, `${mode.id} sys too short to be useful`);
  }
});

test('exactly 7 modes defined', () => {
  assert.equal(MODES.length, 7);
});

test('mode IDs are unique', () => {
  const ids = MODES.map(m => m.id);
  assert.equal(new Set(ids).size, ids.length);
});

// ── Balanced mode ───────────────────────────────────────────────────────────

test('balanced: qualifies when to add structure', () => {
  const balanced = MODES.find(m => m.id === 'balanced');
  assert.match(balanced.sys, /genuinely|needed|necessary/i,
    'Should qualify additions as genuinely needed');
});

test('balanced: prefers minimal intervention', () => {
  const balanced = MODES.find(m => m.id === 'balanced');
  assert.match(balanced.sys, /minimal|light/i,
    'Should prefer light touch over aggressive restructuring');
});

// ── Concise mode ────────────────────────────────────────────────────────────

test('concise: preserves intent', () => {
  const concise = MODES.find(m => m.id === 'concise');
  assert.match(concise.sys, /preserv/i);
});

test('concise: does not add anything new', () => {
  const concise = MODES.find(m => m.id === 'concise');
  assert.match(concise.sys, /not add|compression/i,
    'Concise mode should explicitly avoid adding content');
});

// ── Detailed mode ───────────────────────────────────────────────────────────

test('detailed: grounds additions in user intent', () => {
  const detailed = MODES.find(m => m.id === 'detailed');
  assert.match(detailed.sys, /user.*asked|what the user/i);
});

test('detailed: does not introduce new goals', () => {
  const detailed = MODES.find(m => m.id === 'detailed');
  assert.match(detailed.sys, /not.*new.*goal|not.*change.*intent/i);
});

// ── Claude mode ─────────────────────────────────────────────────────────────

test('claude: mentions XML tags', () => {
  const claude = MODES.find(m => m.id === 'claude');
  assert.match(claude.sys, /XML/i);
});

test('claude: provides tag examples', () => {
  const claude = MODES.find(m => m.id === 'claude');
  assert.match(claude.sys, /<instructions>|<context>|<output>/);
});

// ── ChatGPT mode ────────────────────────────────────────────────────────────

test('chatgpt: mentions chain-of-thought', () => {
  const chatgpt = MODES.find(m => m.id === 'chatgpt');
  assert.match(chatgpt.sys, /chain.of.thought/i);
});

test('chatgpt: avoids XML', () => {
  const chatgpt = MODES.find(m => m.id === 'chatgpt');
  assert.match(chatgpt.sys, /avoid.*XML/i);
});

// ── Image mode ──────────────────────────────────────────────────────────────

test('image: preserves subject faithfully', () => {
  const image = MODES.find(m => m.id === 'image');
  assert.match(image.sys, /faithful|subject|what the user wants/i);
});

test('image: mentions composition terms', () => {
  const image = MODES.find(m => m.id === 'image');
  assert.match(image.sys, /lighting.*composition|composition.*lighting/i);
});

// ── Code mode ───────────────────────────────────────────────────────────────

test('code: does not add unrequested features', () => {
  const code = MODES.find(m => m.id === 'code');
  assert.match(code.sys, /not.*add.*requirements.*user.*did not/i);
});

// ── buildSystemPrompt utility ───────────────────────────────────────────────

test('buildSystemPrompt returns string containing all components', () => {
  const sys = buildSystemPrompt('balanced', ['Writing', 'Code']);
  assert.match(sys, /expert prompt engineer/);
  assert.match(sys, /original intent/i, 'Should include intent policy');
  assert.match(sys, /clarity/i, 'Should include balanced mode instruction');
  assert.match(sys, /assumptions/i, 'Should request assumptions disclosure');
  assert.match(sys, /Writing, Code/, 'Should include tag list');
});

test('buildSystemPrompt falls back to balanced for unknown mode', () => {
  const sys = buildSystemPrompt('nonexistent', ['Other']);
  assert.match(sys, /clarity/i, 'Should fall back to balanced mode');
});

test('buildSystemPrompt includes JSON schema', () => {
  const sys = buildSystemPrompt('concise', ['Writing']);
  assert.match(sys, /"enhanced"/);
  assert.match(sys, /"variants"/);
  assert.match(sys, /"assumptions"/);
});

// ── Mode behavioral distinctness ────────────────────────────────────────────

test('modes produce meaningfully different system prompts', () => {
  const prompts = MODES.map(m => buildSystemPrompt(m.id, ['Writing']));
  // Each pair of mode prompts should differ in at least the mode-specific section
  for (let i = 0; i < prompts.length; i++) {
    for (let j = i + 1; j < prompts.length; j++) {
      assert.notEqual(prompts[i], prompts[j],
        `${MODES[i].id} and ${MODES[j].id} should produce different system prompts`);
    }
  }
});
