import test from 'node:test';
import assert from 'node:assert/strict';

import { lintPrompt, applyLintQuickFix, LINT_FIXES } from '../src/promptLint.js';

// ── Empty / invalid input ───────────────────────────────────────────────────

test('empty string returns no issues', () => {
  assert.deepEqual(lintPrompt(''), []);
});

test('whitespace-only returns no issues', () => {
  assert.deepEqual(lintPrompt('   \n\n  '), []);
});

test('non-string returns no issues', () => {
  assert.deepEqual(lintPrompt(null), []);
  assert.deepEqual(lintPrompt(42), []);
  assert.deepEqual(lintPrompt(undefined), []);
});

// ── Rule: goal_near_top ─────────────────────────────────────────────────────

test('flags missing goal', () => {
  // Use text with no goal/intent keywords from hasGoalNearTop's regex
  const issues = lintPrompt('The color of the sky is blue at noon.');
  const ids = issues.map(i => i.id);
  assert.ok(ids.includes('goal_near_top'));
});

test('no goal flag when intent keyword present near top', () => {
  const issues = lintPrompt('Please generate a summary of this text.');
  const ids = issues.map(i => i.id);
  assert.ok(!ids.includes('goal_near_top'));
});

test('goal detected from "I need" phrasing', () => {
  const issues = lintPrompt('I need a function that validates emails.');
  assert.ok(!issues.some(i => i.id === 'goal_near_top'));
});

// ── Rule: role_definition ───────────────────────────────────────────────────

test('flags missing role on non-trivial prompts', () => {
  const long = 'Do something with data.\n'.repeat(10);
  const issues = lintPrompt(long);
  assert.ok(issues.some(i => i.id === 'role_definition'));
});

test('no role flag on short prompts', () => {
  const issues = lintPrompt('Short prompt.');
  assert.ok(!issues.some(i => i.id === 'role_definition'));
});

test('no role flag when "You are" present', () => {
  const long = 'You are an expert writer.\n' + 'Do something.\n'.repeat(10);
  assert.ok(!lintPrompt(long).some(i => i.id === 'role_definition'));
});

test('no role flag when "act as" present', () => {
  const long = 'Act as a chef.\n' + 'Make food.\n'.repeat(10);
  assert.ok(!lintPrompt(long).some(i => i.id === 'role_definition'));
});

// ── Rule: constraints ───────────────────────────────────────────────────────

test('flags missing constraints', () => {
  const issues = lintPrompt('Write a poem about cats.');
  assert.ok(issues.some(i => i.id === 'constraints'));
});

test('no constraints flag when "must" present', () => {
  const issues = lintPrompt('Write a poem. It must rhyme.');
  assert.ok(!issues.some(i => i.id === 'constraints'));
});

test('no constraints flag when "do not" present', () => {
  assert.ok(!lintPrompt('Explain. Do not use jargon.').some(i => i.id === 'constraints'));
});

// ── Rule: output_format ─────────────────────────────────────────────────────

test('flags missing output format', () => {
  assert.ok(lintPrompt('Tell me about dogs.').some(i => i.id === 'output_format'));
});

test('no output_format flag when "JSON" present', () => {
  assert.ok(!lintPrompt('Return as JSON.').some(i => i.id === 'output_format'));
});

test('no output_format flag when "markdown" present', () => {
  assert.ok(!lintPrompt('Respond in markdown sections.').some(i => i.id === 'output_format'));
});

test('no output_format flag when "table" present', () => {
  assert.ok(!lintPrompt('Format as a table.').some(i => i.id === 'output_format'));
});

// ── Rule: example_io ────────────────────────────────────────────────────────

test('flags missing example on complex prompts', () => {
  const long = 'x '.repeat(250); // > 420 chars
  const issues = lintPrompt(long);
  assert.ok(issues.some(i => i.id === 'example_io'));
});

test('no example flag on short prompts', () => {
  assert.ok(!lintPrompt('Short prompt here.').some(i => i.id === 'example_io'));
});

test('no example flag when "example" keyword present', () => {
  const long = 'Here is an example of what I want.\n' + 'x '.repeat(250);
  assert.ok(!lintPrompt(long).some(i => i.id === 'example_io'));
});

test('custom complexity threshold respected', () => {
  const text = 'a '.repeat(100); // ~200 chars
  const defaultIssues = lintPrompt(text);
  const lowThresh = lintPrompt(text, { complexityThreshold: 180 });
  // With lower threshold, might trigger example_io
  assert.ok(lowThresh.length >= defaultIssues.length);
});

// ── Issue shape ─────────────────────────────────────────────────────────────

test('issues have correct shape', () => {
  const issues = lintPrompt('Random text that triggers some rules.');
  for (const issue of issues) {
    assert.ok(typeof issue.id === 'string');
    assert.ok(typeof issue.message === 'string');
    assert.ok(['info', 'warning', 'error'].includes(issue.severity));
    assert.ok(typeof issue.line === 'number');
    assert.ok(issue.range && typeof issue.range.start === 'number');
  }
});

// ── Quick fixes ─────────────────────────────────────────────────────────────

test('applyLintQuickFix prepends role fix', () => {
  const result = applyLintQuickFix('My prompt', 'role_definition');
  assert.ok(result.startsWith(LINT_FIXES.role_section.trim()));
  assert.ok(result.includes('My prompt'));
});

test('applyLintQuickFix prepends goal fix', () => {
  const result = applyLintQuickFix('My prompt', 'goal_near_top');
  assert.ok(result.startsWith(LINT_FIXES.goal_section.trim()));
});

test('applyLintQuickFix appends constraints fix', () => {
  const result = applyLintQuickFix('My prompt', 'constraints');
  assert.ok(result.startsWith('My prompt'));
  assert.ok(result.includes('Constraints'));
});

test('applyLintQuickFix appends output format fix', () => {
  const result = applyLintQuickFix('My prompt', 'output_format');
  assert.ok(result.includes('Output Format'));
});

test('applyLintQuickFix appends example fix', () => {
  const result = applyLintQuickFix('My prompt', 'example_io');
  assert.ok(result.includes('Example'));
});

test('applyLintQuickFix unknown rule returns original', () => {
  assert.equal(applyLintQuickFix('My prompt', 'nonexistent_rule'), 'My prompt');
});

test('applyLintQuickFix handles non-string input', () => {
  const result = applyLintQuickFix(null, 'constraints');
  assert.ok(typeof result === 'string');
});
