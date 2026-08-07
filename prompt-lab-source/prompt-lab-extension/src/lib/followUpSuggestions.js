import { DEFAULT_ENHANCE_MODEL } from '../constants';

// ── Follow-up prompt suggestions ─────────────────────────────────────────────
// Given the prompt the user just enhanced/ran, ask the active provider for a
// small set of natural next prompts so multi-prompt chains can be assembled
// without starting from a blank editor.

export const MAX_FOLLOW_UP_SUGGESTIONS = 3;
export const DEFAULT_FOLLOW_UP_MAX_TOKENS = 1024;
export const DEFAULT_FOLLOW_UP_TEMPERATURE = 0.6;

export const FOLLOW_UP_SYSTEM_PROMPT = `You are a prompt engineering assistant inside a prompt workbench. The user message contains either a refined prompt or a labeled SOURCE PROMPT and its ACTUAL OUTPUT. Suggest the ${MAX_FOLLOW_UP_SUGGESTIONS} most useful FOLLOW-UP prompts the user would naturally run next, so the prompts can be chained into a multi-step workflow.

Rules:
- Each suggestion must be a complete, ready-to-run prompt, not advice about the prompt.
- When ACTUAL OUTPUT is present, ground every suggestion in that output rather than guessing what the source prompt might produce.
- Suggestions should build on the output or extend its workflow (e.g. critique it, transform it, take the next step) — never rephrase the original prompt.
- Stay within the user's domain, subject, and terminology. Do not invent new goals.
- Keep each prompt under 120 words.

Return ONLY valid JSON, no markdown, no backticks:
{"suggestions":[{"title":"...","prompt":"..."}]}
"title" is a short imperative label (max 8 words). "prompt" is the full follow-up prompt text.`;

function sourceFingerprint(value) {
  let hash = 5381;
  for (const char of String(value || '')) {
    hash = ((hash << 5) + hash) ^ char.charCodeAt(0);
  }
  return (hash >>> 0).toString(36);
}

export function resolveFollowUpSource({ raw = '', enhanced = '', sourceRun = null, sourcePromptId = null } = {}) {
  const runOutput = sourceRun?.status === 'success' ? String(sourceRun.output || '').trim() : '';
  if (runOutput) {
    const runId = String(sourceRun.id || 'unsaved-run');
    return {
      key: `run:${runId}:${sourceFingerprint(runOutput)}`,
      kind: 'run-output',
      text: runOutput,
      promptText: String(sourceRun.input || raw || enhanced || '').trim(),
      label: `Actual output${sourceRun.provider ? ` from ${sourceRun.provider}` : ''}`,
      promptId: sourceRun.promptId || sourcePromptId || null,
      runId: sourceRun.id || null,
      provider: sourceRun.provider || '',
      model: sourceRun.model || '',
      sourceGeneratedAt: sourceRun.createdAt || '',
    };
  }

  const enhancedText = String(enhanced || '').trim();
  if (enhancedText) {
    return {
      key: `enhanced:${sourceFingerprint(enhancedText)}`,
      kind: 'enhanced-prompt',
      text: enhancedText,
      promptText: String(raw || '').trim(),
      label: 'Current enhanced prompt',
      promptId: sourcePromptId || null,
      runId: null,
      provider: '',
      model: '',
      sourceGeneratedAt: '',
    };
  }

  const rawText = String(raw || '').trim();
  return {
    key: rawText ? `draft:${sourceFingerprint(rawText)}` : 'empty',
    kind: 'draft-prompt',
    text: rawText,
    promptText: rawText,
    label: 'Current draft prompt',
    promptId: sourcePromptId || null,
    runId: null,
    provider: '',
    model: '',
    sourceGeneratedAt: '',
  };
}

export function buildFollowUpPayload({ raw = '', enhanced = '', source = null, sourceRun = null, sourcePromptId = null } = {}) {
  const resolvedSource = source || resolveFollowUpSource({ raw, enhanced, sourceRun, sourcePromptId });
  const promptText = resolvedSource.kind === 'run-output'
    ? `SOURCE PROMPT:\n${resolvedSource.promptText || '(not recorded)'}\n\nACTUAL OUTPUT:\n${resolvedSource.text}`
    : resolvedSource.text;
  return {
    model: DEFAULT_ENHANCE_MODEL,
    max_tokens: DEFAULT_FOLLOW_UP_MAX_TOKENS,
    temperature: DEFAULT_FOLLOW_UP_TEMPERATURE,
    system: FOLLOW_UP_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: promptText }],
    responseFormat: 'json',
  };
}

function extractJsonObject(text) {
  const source = String(text || '').trim();
  if (!source) return null;
  const stripped = source
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  for (const candidate of [stripped, source]) {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end <= start) continue;
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      // Try the next candidate form.
    }
  }
  return null;
}

export function parseFollowUpSuggestions(text) {
  const payload = extractJsonObject(text);
  const rows = Array.isArray(payload?.suggestions) ? payload.suggestions : [];
  return rows
    .map((row) => ({
      title: String(row?.title || '').replace(/\s+/g, ' ').trim().slice(0, 80),
      prompt: String(row?.prompt || '').trim().slice(0, 4000),
    }))
    .filter((row) => row.prompt)
    .map((row) => ({ ...row, title: row.title || 'Follow-up prompt' }))
    .slice(0, MAX_FOLLOW_UP_SUGGESTIONS);
}

export function buildFollowUpLibraryRecord(suggestion, fallbackSource = null) {
  const source = suggestion?.source || fallbackSource || {};
  const prompt = String(suggestion?.prompt || '').trim();
  return {
    raw: prompt,
    enhanced: prompt,
    variants: [],
    notes: source.label ? `Generated from ${source.label}.` : '',
    tags: ['follow-up'],
    title: String(suggestion?.title || 'Follow-up prompt').trim() || 'Follow-up prompt',
    collection: '',
    editingId: null,
    changeNote: '',
    metadata: {
      purpose: 'follow-up',
      status: 'draft',
      derivedFrom: source.kind || 'prompt',
      sourcePromptId: source.promptId || null,
      sourceRunId: source.runId || null,
      sourceProvider: source.provider || '',
      sourceModel: source.model || '',
      sourceGeneratedAt: source.sourceGeneratedAt || '',
      followUpGeneratedAt: suggestion?.generatedAt || new Date().toISOString(),
    },
  };
}
