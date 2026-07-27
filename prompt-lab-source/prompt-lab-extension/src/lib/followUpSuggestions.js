import { DEFAULT_ENHANCE_MODEL } from '../constants';

// ── Follow-up prompt suggestions ─────────────────────────────────────────────
// Given the prompt the user just enhanced/ran, ask the active provider for a
// small set of natural next prompts so multi-prompt chains can be assembled
// without starting from a blank editor.

export const MAX_FOLLOW_UP_SUGGESTIONS = 3;
export const DEFAULT_FOLLOW_UP_MAX_TOKENS = 1024;
export const DEFAULT_FOLLOW_UP_TEMPERATURE = 0.6;

export const FOLLOW_UP_SYSTEM_PROMPT = `You are a prompt engineering assistant inside a prompt workbench. The user message contains a prompt the user just finished refining. Suggest the ${MAX_FOLLOW_UP_SUGGESTIONS} most useful FOLLOW-UP prompts the user would naturally run next, so the prompts can be chained into a multi-step workflow.

Rules:
- Each suggestion must be a complete, ready-to-run prompt, not advice about the prompt.
- Suggestions should build on the original prompt's output or extend its workflow (e.g. critique it, transform its output, take the next step) — never rephrase the original prompt.
- Stay within the user's domain, subject, and terminology. Do not invent new goals.
- Keep each prompt under 120 words.

Return ONLY valid JSON, no markdown, no backticks:
{"suggestions":[{"title":"...","prompt":"..."}]}
"title" is a short imperative label (max 8 words). "prompt" is the full follow-up prompt text.`;

export function buildFollowUpPayload({ raw = '', enhanced = '' } = {}) {
  const promptText = String(enhanced || raw || '').trim();
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
