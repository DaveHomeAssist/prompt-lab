function randomId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `id-${Math.random().toString(36).slice(2, 10)}`;
}

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

export function ensureString(value) {
  return typeof value === 'string' ? value : '';
}

export function safeDate(value) {
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString() : new Date().toISOString();
}

export function suggestTitleFromText(value) {
  const txt = ensureString(value).replace(/\s+/g, ' ').trim();
  if (!txt) return 'Untitled Prompt';
  const short = txt.slice(0, 72);
  return short.length < txt.length ? `${short}…` : short;
}

function normalizeVariant(v) {
  return {
    label: ensureString(v?.label) || 'Variant',
    content: ensureString(v?.content),
  };
}

export function normalizeEntry(entry, fallbackTs = new Date().toISOString()) {
  if (!entry || typeof entry !== 'object') return null;
  const original = ensureString(entry.original);
  const enhanced = ensureString(entry.enhanced) || original;
  if (!enhanced.trim()) return null;
  const createdAt = safeDate(entry.createdAt || fallbackTs);
  const updatedAt = entry.updatedAt ? safeDate(entry.updatedAt) : undefined;
  return {
    id: ensureString(entry.id) || randomId(),
    title: ensureString(entry.title).trim() || suggestTitleFromText(enhanced),
    original,
    enhanced,
    variants: Array.isArray(entry.variants) ? entry.variants.map(normalizeVariant).filter(v => v.content.trim()) : [],
    notes: ensureString(entry.notes),
    tags: Array.isArray(entry.tags) ? entry.tags.filter(t => typeof t === 'string' && t.trim()) : [],
    collection: ensureString(entry.collection),
    createdAt,
    updatedAt,
    useCount: Number.isFinite(entry.useCount) ? Math.max(0, entry.useCount) : 0,
    versions: Array.isArray(entry.versions)
      ? entry.versions
        .map(v => ({
          enhanced: ensureString(v?.enhanced),
          variants: Array.isArray(v?.variants) ? v.variants.map(normalizeVariant) : [],
          savedAt: safeDate(v?.savedAt || createdAt),
        }))
        .filter(v => v.enhanced.trim())
      : [],
  };
}

export function normalizeLibrary(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  return list
    .map((entry, i) => normalizeEntry(entry, new Date(Date.now() - i).toISOString()))
    .filter(Boolean)
    .map(entry => {
      const id = seen.has(entry.id) ? randomId() : entry.id;
      seen.add(id);
      return { ...entry, id };
    });
}

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
