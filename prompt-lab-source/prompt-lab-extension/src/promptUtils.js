import { ensureString } from './lib/utils.js';

export { ensureString, safeDate } from './lib/utils.js';

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

export function extractTextFromAnthropic(data) {
  if (data?.error?.message) throw new Error(data.error.message);
  if (!Array.isArray(data?.content)) throw new Error('Model returned no content.');
  const text = data.content.map(block => (typeof block.text === 'string' ? block.text : '')).join('').trim();
  if (!text) throw new Error('Model returned empty content. Try again.');
  return text;
}

export function parseEnhancedPayload(rawText) {
  const cleaned = String(rawText || '').replace(/```json|```/g, '').trim();
  if (!cleaned) throw new Error('Model returned empty content. Try again.');
  try {
    return JSON.parse(cleaned);
  } catch {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
      } catch {}
    }
    throw new Error('Model response was not valid JSON. Try again.');
  }
}

const SECRET_PATTERN = /\b(sk-ant-|api[_-]?key|password|secret|access[_-]?token|bearer)\b/i;

export function looksSensitive(text) {
  return SECRET_PATTERN.test(ensureString(text));
}

export function isTransientError(err) {
  const msg = ensureString(err?.message || err).toLowerCase();
  return msg.includes('429')
    || msg.includes('rate')
    || msg.includes('timeout')
    || msg.includes('network')
    || msg.includes('failed to fetch')
    || msg.includes('temporar');
}

export {
  suggestTitleFromText,
  normalizeLibrary,
} from './lib/promptSchema.js';
