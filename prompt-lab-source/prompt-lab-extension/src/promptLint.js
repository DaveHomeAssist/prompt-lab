import { isGhostVar } from './promptUtils.js';
import { parsePromptVariables } from './lib/promptVariables.js';

const COMPLEX_THRESHOLD = 420;

export const LINT_FIXES = {
  role_section: '\nRole:\nYou are an expert assistant for this task.\n',
  goal_section: '\nGoal:\nState the exact outcome you want in one sentence.\n',
  constraints_section: '\nConstraints:\n- Preserve the requested scope, facts, exclusions, tone, and answer length.\n- Do not invent missing requirements.\n',
  output_format_section: '\nOutput Format:\nPreserve the explicitly requested output format. Otherwise use a format appropriate to this task.\n',
  example_block: '\nExample:\nInput: <short sample input>\nOutput: <short sample output>\n',
};
export const LINT_QUICK_FIX_META = Object.freeze({
  goal_near_top: { label: 'Add Goal Block', strategy: 'prepend', snippet: LINT_FIXES.goal_section },
  role_definition: { label: 'Inject Role Block', strategy: 'cursor', snippet: LINT_FIXES.role_section },
  constraints: { label: 'Inject Constraints', strategy: 'cursor', snippet: LINT_FIXES.constraints_section },
  output_format: { label: 'Inject Output Format', strategy: 'cursor', snippet: LINT_FIXES.output_format_section },
  example_io: { label: 'Inject Example Block', strategy: 'cursor', snippet: LINT_FIXES.example_block },
});
function lineFromIndex(text, idx) {
  if (typeof text !== 'string' || idx <= 0) return 1;
  return text.slice(0, idx).split('\n').length;
}
function hasGoalNearTop(text) {
  const top = text.split('\n').slice(0, 6).join(' ').toLowerCase();
  return /\b(goal|intent|objective|task|outcome|i need|i want|please|create|generate|write|explain|analyze)\b/.test(top);
}
function hasRole(text) { return /\b(you are|act as|your role|persona|as an expert|as a|audience|readers?|written for|intended for)\b/i.test(text); }
function hasConstraints(text) { return /\b(constraints?|must|must not|do not|don't|avoid|limit|max(?:imum)?|minimum|exactly|only|never|always)\b/i.test(text); }
function hasOutputFormat(text) { return /\b(output format|respond with|return as|json|markdown|table|list|bullet points|sections?)\b/i.test(text); }
function hasExample(text) { return /\b(example|sample input|sample output|few-shot|input:\s|output:\s)\b/i.test(text); }
function issue(id, message, severity, text, idx = 0) {
  return { id, message, severity, line: lineFromIndex(text, idx), range: { start: idx, end: idx } };
}
export function lintPrompt(prompt, opts = {}) {
  const text = typeof prompt === 'string' ? prompt : '';
  if (!text.trim()) return [];
  const complexityThreshold = Number.isFinite(opts.complexityThreshold) ? Math.max(180, opts.complexityThreshold) : COMPLEX_THRESHOLD;
  const issues = [];
  if (!hasGoalNearTop(text)) issues.push(issue('goal_near_top', 'Add an explicit goal/intent sentence near the top.', 'warning', text, 0));
  const nonTrivial = text.length > 140 || text.split('\n').length > 4;
  if (nonTrivial && !hasRole(text)) issues.push(issue('role_definition', 'Name an audience or a role (for example, "Audience: …" or "You are …").', 'info', text, 0));
  if (!hasConstraints(text)) issues.push(issue('constraints', 'Add constraints (length, style, guardrails, or required/forbidden content).', 'info', text, 0));
  if (!hasOutputFormat(text)) issues.push(issue('output_format', 'Describe the expected output format (list, JSON, markdown sections, etc.).', 'warning', text, 0));
  if (text.length > complexityThreshold && !hasExample(text)) {
    issues.push(issue('example_io', 'Complex prompts benefit from at least one example input/output block.', 'info', text,
      text.indexOf('\n') >= 0 ? text.indexOf('\n') : text.length));
  }
  return issues;
}

export const VERY_LONG_PROMPT_CHARS = 4000;

function normalizedInstructions(text) {
  return text
    .split(/[\n]+|(?<=[.!?])\s+/)
    .map((line) => line.replace(/^[\s\-*•\d.)]+/, '').trim().toLowerCase().replace(/\s+/g, ' '))
    .filter((line) => line.length >= 24);
}

function duplicateInstruction(text) {
  const seen = new Set();
  for (const line of normalizedInstructions(text)) {
    if (seen.has(line)) return line;
    seen.add(line);
  }
  return '';
}

/**
 * Extra non-blocking hints. These are separate from lintPrompt so the checked
 * corpus, which pins the original rule ids, stays stable. The editor shows
 * both lists and lets each hint be dismissed.
 */
export function promptLintHints(prompt) {
  const text = typeof prompt === 'string' ? prompt : '';
  if (!text.trim()) return [];
  const hints = [];
  if (!hasOutputFormat(text)) {
    hints.push(issue('output_format', 'Describe the expected output format (list, JSON, markdown sections, etc.).', 'warning', text, 0));
  }
  if (!hasRole(text)) {
    hints.push(issue('audience_or_role', 'Name an audience or a role (for example, "Audience: …" or "You are …").', 'info', text, 0));
  }
  if (text.length > VERY_LONG_PROMPT_CHARS) {
    hints.push(issue('very_long', `This prompt is very long (${text.length} characters). Shorter prompts are easier to run and cheaper.`, 'info', text, 0));
  }
  if (duplicateInstruction(text)) {
    hints.push(issue('duplicated_instructions', 'The same instruction appears more than once. Keep one copy so the model is not pulled both ways.', 'info', text, 0));
  }
  const unresolved = parsePromptVariables(text)
    .filter((variable) => variable.defaultValue == null && !isGhostVar(variable.name))
    .map((variable) => variable.name);
  if (unresolved.length) {
    const sample = unresolved.slice(0, 3).map((name) => `{{${name}}}`).join(', ');
    hints.push(issue('unresolved_vars', `Unresolved ${sample}. Fill ${unresolved.length === 1 ? 'it' : 'them'} in before you run or copy, or add a default with {{name|default}}.`, 'warning', text, text.indexOf('{{')));
  }
  return hints;
}

export function listPromptLint(prompt) {
  const base = lintPrompt(prompt);
  const seen = new Set(base.map((item) => item.id));
  const extra = promptLintHints(prompt).filter((hint) => {
    if (seen.has(hint.id)) return false;
    if (hint.id === 'audience_or_role' && seen.has('role_definition')) return false;
    if (hint.id === 'output_format' && seen.has('output_format')) return false;
    return true;
  });
  return [...base, ...extra];
}

const DISMISS_KEY = 'pl2-lint-dismissed';

export function readDismissedLintHints(promptKey, storage = typeof localStorage === 'undefined' ? null : localStorage) {
  if (!storage || !promptKey) return [];
  try {
    const parsed = JSON.parse(storage.getItem(DISMISS_KEY) || '{}');
    const ids = parsed?.[promptKey];
    return Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function dismissLintHint(promptKey, hintId, storage = typeof localStorage === 'undefined' ? null : localStorage) {
  if (!storage || !promptKey || !hintId) return [];
  let parsed = {};
  try { parsed = JSON.parse(storage.getItem(DISMISS_KEY) || '{}') || {}; } catch { parsed = {}; }
  const ids = new Set(Array.isArray(parsed[promptKey]) ? parsed[promptKey] : []);
  ids.add(hintId);
  parsed[promptKey] = [...ids];
  storage.setItem(DISMISS_KEY, JSON.stringify(parsed));
  return parsed[promptKey];
}

export function visibleLintIssues(issues, dismissed) {
  const hidden = new Set(dismissed || []);
  return (issues || []).filter((item) => item && !hidden.has(item.id));
}
function normalizeSelection(text, selection) {
  const length = typeof text === 'string' ? text.length : 0;
  const start = Number.isFinite(selection?.start) ? Math.max(0, Math.min(length, selection.start)) : length;
  const end = Number.isFinite(selection?.end) ? Math.max(start, Math.min(length, selection.end)) : start;
  return { start, end };
}
function buildCursorInsertion(base, snippet, selection) {
  const { start } = normalizeSelection(base, selection);
  const before = base.slice(0, start);
  const after = base.slice(start);
  const trimmedSnippet = snippet.trim();
  const prefix = before.length === 0 || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const suffix = after.length === 0 || after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
  const inserted = `${prefix}${trimmedSnippet}${suffix}`;
  const nextText = `${before}${inserted}${after}`;
  const cursorPos = before.length + inserted.length;
  return { text: nextText, selectionStart: cursorPos, selectionEnd: cursorPos };
}
function buildPrependInsertion(base, snippet) {
  const trimmedBase = base.trim();
  const trimmedSnippet = snippet.trim();
  const nextText = trimmedBase ? `${trimmedSnippet}\n\n${trimmedBase}` : trimmedSnippet;
  return { text: nextText, selectionStart: trimmedSnippet.length, selectionEnd: trimmedSnippet.length };
}
export function getLintQuickFixMeta(ruleId) { return LINT_QUICK_FIX_META[ruleId] || null; }
export function applyLintQuickFixAtSelection(text, ruleId, selection) {
  const base = typeof text === 'string' ? text : '';
  const meta = getLintQuickFixMeta(ruleId);
  if (!meta?.snippet) return { text: base, selectionStart: base.length, selectionEnd: base.length };
  return meta.strategy === 'prepend' ? buildPrependInsertion(base, meta.snippet) : buildCursorInsertion(base, meta.snippet, selection);
}
export function applyLintQuickFix(text, ruleId) { return applyLintQuickFixAtSelection(text, ruleId).text; }
