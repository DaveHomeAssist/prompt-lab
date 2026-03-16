import { ensureString } from './lib/utils.js';

export function wordDiff(a, b) {
  const left = typeof a === 'string' ? a : '';
  const right = typeof b === 'string' ? b : '';
  const wa = left.split(' ').slice(0, 200);
  const wb = right.split(' ').slice(0, 200);
  const dp = Array(wa.length + 1).fill(null).map(() => Array(wb.length + 1).fill(0));
  for (let i = 1; i <= wa.length; i += 1) {
    for (let j = 1; j <= wb.length; j += 1) {
      dp[i][j] = wa[i - 1] === wb[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const out = [];
  let i = wa.length;
  let j = wb.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && wa[i - 1] === wb[j - 1]) {
      out.unshift({ t: 'eq', v: wa[i - 1] });
      i -= 1;
      j -= 1;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      out.unshift({ t: 'add', v: wb[j - 1] });
      j -= 1;
    } else {
      out.unshift({ t: 'del', v: wa[i - 1] });
      i -= 1;
    }
  }
  return out;
}

export function scorePrompt(text) {
  if (typeof text !== 'string') return null;
  if (!text.trim()) return null;
  return {
    role: /\b(you are|act as|as a|your role|persona)\b/i.test(text),
    task: /\b(write|create|generate|explain|analyze|summarize|list|help|please|provide)\b/i.test(text),
    format: /\b(format|output|respond in|json|list|bullet|markdown|table|return)\b/i.test(text),
    constraints: /\b(do not|don't|avoid|must|should|limit|max|minimum|only|never|always)\b/i.test(text),
    context: text.length > 80,
    tokens: Math.round(text.length / 4),
  };
}

export function extractVars(text) {
  if (typeof text !== 'string') return [];
  return [...new Set([...text.matchAll(/\{\{(\w[\w ]*)\}\}/g)].map(m => m[1]))];
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatLocalDate(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function formatLocalTime(date) {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

function formatLocalDateTime(date) {
  return `${formatLocalDate(date)} ${formatLocalTime(date)}`;
}

const GHOST_RESOLVERS = Object.freeze({
  date: () => formatLocalDate(new Date()),
  time: () => formatLocalTime(new Date()),
  datetime: () => formatLocalDateTime(new Date()),
  timestamp: () => String(Date.now()),
  year: () => String(new Date().getFullYear()),
  clipboard: async () => {
    try {
      if (typeof navigator === 'undefined' || !navigator?.clipboard?.readText) {
        return '';
      }
      const text = await navigator.clipboard.readText();
      return typeof text === 'string' ? text : '';
    } catch {
      return '';
    }
  },
});

function normalizeGhostVarName(name) {
  return ensureString(name).trim().toLowerCase();
}

export function isGhostVar(name) {
  return Object.prototype.hasOwnProperty.call(GHOST_RESOLVERS, normalizeGhostVarName(name));
}

export async function resolveGhostVars(varNames) {
  const names = Array.isArray(varNames) ? varNames : [];
  const resolved = {};
  await Promise.all(names.map(async (name) => {
    if (!isGhostVar(name)) return;
    const resolver = GHOST_RESOLVERS[normalizeGhostVarName(name)];
    const value = await resolver();
    resolved[name] = ensureString(value);
  }));
  return resolved;
}

export function encodeShare(entry) {
  try {
    return btoa(unescape(encodeURIComponent(JSON.stringify({
      title: entry.title, original: entry.original, enhanced: entry.enhanced,
      variants: entry.variants, tags: entry.tags, notes: entry.notes,
    }))));
  } catch {
    return null;
  }
}

export function decodeShare(str) {
  try {
    return JSON.parse(decodeURIComponent(escape(atob(str))));
  } catch {
    return null;
  }
}

function extractTextFromContentBlocks(content) {
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => {
      if (typeof block === 'string') return block;
      if (typeof block?.text === 'string') return block.text;
      if (typeof block?.content === 'string') return block.content;
      return '';
    })
    .join('');
}

export function extractTextFromAnthropic(data) {
  if (data?.error?.message) throw new Error(data.error.message);

  const candidates = [];
  const anthropicText = extractTextFromContentBlocks(data?.content);
  if (anthropicText) candidates.push(anthropicText);
  if (typeof data?.content === 'string') candidates.push(data.content);

  const openAIContent = data?.choices?.[0]?.message?.content;
  if (typeof openAIContent === 'string') candidates.push(openAIContent);
  else {
    const openAIBlocks = extractTextFromContentBlocks(openAIContent);
    if (openAIBlocks) candidates.push(openAIBlocks);
  }

  const geminiText = Array.isArray(data?.candidates?.[0]?.content?.parts)
    ? data.candidates[0].content.parts.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('')
    : '';
  if (geminiText) candidates.push(geminiText);
  if (typeof data?.output_text === 'string') candidates.push(data.output_text);

  const text = candidates.map((value) => ensureString(value).trim()).find(Boolean);
  if (!text) throw new Error('Model returned no text content. Try again.');
  return text;
}

function stringifyPromptValue(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (!value || typeof value !== 'object') return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '';
  }
}

function looksLikeJSON(text) {
  const trimmed = text.trim();
  return (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
         (trimmed.startsWith('[') && trimmed.endsWith(']'));
}

function coercePromptText(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (looksLikeJSON(trimmed)) {
      try {
        const inner = JSON.parse(trimmed);
        if (inner && typeof inner === 'object') return coercePromptText(inner);
      } catch { /* not JSON, return as-is */ }
    }
    return trimmed;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (!value || typeof value !== 'object') return '';

  if (Array.isArray(value)) {
    return value.map((item) => coercePromptText(item)).filter(Boolean).join('\n').trim();
  }

  for (const key of ['enhanced', 'content', 'prompt', 'text', 'rewrite', 'output', 'result']) {
    const candidate = coercePromptText(value[key]);
    if (candidate) return candidate;
  }

  const ORDERED_KEYS = ['role', 'task', 'context', 'format', 'constraints', 'tone', 'audience', 'goal'];
  const orderedSet = new Set(ORDERED_KEYS);

  function formatEntry(key, entry) {
    if (typeof entry === 'string') return `${key}: ${entry.trim()}`;
    if (Array.isArray(entry)) return `${key}: ${entry.map((item) => coercePromptText(item)).filter(Boolean).join('; ')}`;
    return `${key}: ${coercePromptText(entry)}`;
  }

  const lines = [];
  for (const key of ORDERED_KEYS) {
    if (value[key] != null && value[key] !== '') lines.push(formatEntry(key, value[key]));
  }
  for (const [key, entry] of Object.entries(value)) {
    if (orderedSet.has(key) || entry == null || entry === '') continue;
    lines.push(formatEntry(key, entry));
  }
  const result = lines.filter((line) => !line.endsWith(': ')).join('\n').trim();
  return result;
}

function normalizeParsedPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  return {
    ...payload,
    enhanced: coercePromptText(payload.enhanced),
    variants: Array.isArray(payload.variants)
      ? payload.variants
        .map((variant) => {
          if (!variant || typeof variant !== 'object') {
            return {
              label: 'Variant',
              content: coercePromptText(variant),
            };
          }
          return {
            label: stringifyPromptValue(variant.label).trim() || 'Variant',
            content: coercePromptText(
              Object.prototype.hasOwnProperty.call(variant, 'content') ? variant.content : variant
            ),
          };
        })
        .filter((variant) => variant.content.trim())
      : [],
    notes: coercePromptText(payload.notes),
    assumptions: Array.isArray(payload.assumptions)
      ? payload.assumptions.map((a) => coercePromptText(a)).filter(Boolean)
      : [],
    tags: Array.isArray(payload.tags)
      ? payload.tags.map((tag) => coercePromptText(tag)).filter(Boolean)
      : [],
  };
}

export function parseEnhancedPayload(rawText) {
  const cleaned = String(rawText || '').replace(/```json|```/g, '').trim();
  if (!cleaned) throw new Error('Model returned empty content. Try again.');

  let parsed = null;

  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        parsed = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
      } catch {}
    }
  }

  if (parsed === null) throw new Error('Model response was not valid JSON. Try again.');

  const normalized = normalizeParsedPayload(parsed);
  if (
    !normalized ||
    typeof normalized !== 'object' ||
    typeof normalized.enhanced !== 'string' ||
    !normalized.enhanced.trim()
  ) {
    throw new Error('Model response JSON is missing an enhanced prompt string. Try again.');
  }
  return normalized;
}

const SECRET_PATTERN = /\b(sk-ant-|api[_-]?key|password|secret|access[_-]?token|bearer)\b/i;

export function looksSensitive(text) {
  return SECRET_PATTERN.test(ensureString(text));
}

function buildNgrams(text, n) {
  const normalized = ensureString(text).trim().toLowerCase();
  if (!normalized) return [];
  if (normalized.length <= n) return [normalized];
  const grams = [];
  for (let i = 0; i <= normalized.length - n; i += 1) {
    grams.push(normalized.slice(i, i + n));
  }
  return grams;
}

export function ngramSimilarity(a, b, n = 3) {
  const size = Number.isInteger(n) && n > 0 ? n : 3;
  const left = buildNgrams(a, size);
  const right = buildNgrams(b, size);
  if (left.length === 0 && right.length === 0) return 1;
  if (left.length === 0 || right.length === 0) return 0;
  const leftCounts = new Map();
  const rightCounts = new Map();
  left.forEach((gram) => leftCounts.set(gram, (leftCounts.get(gram) || 0) + 1));
  right.forEach((gram) => rightCounts.set(gram, (rightCounts.get(gram) || 0) + 1));
  const all = new Set([...leftCounts.keys(), ...rightCounts.keys()]);
  let intersection = 0;
  let union = 0;
  all.forEach((gram) => {
    const l = leftCounts.get(gram) || 0;
    const r = rightCounts.get(gram) || 0;
    intersection += Math.min(l, r);
    union += Math.max(l, r);
  });
  return union === 0 ? 0 : intersection / union;
}

export { isRetryable as isTransientError } from './lib/errorTaxonomy.js';

export {
  suggestTitleFromText,
  normalizeLibrary,
} from './lib/promptSchema.js';
