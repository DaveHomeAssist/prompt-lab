const PLACEHOLDERS = Object.freeze({
  api_key: '[API_KEY]',
  email: '[EMAIL]',
  credit_card: '[CARD_NUMBER]',
  secret_value: '[SECRET_VALUE]',
  custom: '[REDACTED]',
});

export const DEFAULT_REDACTION_SETTINGS = Object.freeze({
  enabled: true,
  types: {
    api_key: true,
    email: true,
    credit_card: true,
    secret_value: true,
    custom: true,
  },
  customPatterns: [],
});

function normalizeSettings(settings) {
  const next = settings && typeof settings === 'object' ? settings : {};
  return {
    enabled: next.enabled !== false,
    types: {
      ...DEFAULT_REDACTION_SETTINGS.types,
      ...(next.types || {}),
    },
    customPatterns: Array.isArray(next.customPatterns)
      ? next.customPatterns.map((p) => String(p || '')).filter(Boolean)
      : [],
  };
}

function luhnPasses(digits) {
  const clean = digits.replace(/\D/g, '');
  if (clean.length < 13 || clean.length > 19) return false;
  let sum = 0;
  let shouldDouble = false;
  for (let i = clean.length - 1; i >= 0; i -= 1) {
    let n = Number(clean[i]);
    if (shouldDouble) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

function getBuiltInDetectors() {
  return [
    {
      type: 'api_key',
      description: 'Potential API key/token-like value.',
      regex: /\b(sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z\-_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|(?:api|secret|access|private)[_\-\s]?(?:key|token)\s*[:=]\s*["']?[A-Za-z0-9_\-]{12,})\b/gi,
    },
    {
      type: 'email',
      description: 'Email address.',
      regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    },
    {
      type: 'credit_card',
      description: 'Credit card-like number.',
      regex: /\b(?:\d[ -]*?){13,19}\b/g,
      validate: (value) => luhnPasses(value),
    },
    {
      type: 'secret_value',
      description: 'Secret/id-looking value.',
      regex: /\b(?:token|secret|password|passwd|private[_-]?key|client[_-]?secret)\b\s*[:=]\s*["']?([A-Za-z0-9+/_\-]{10,})["']?/gi,
      extract: (match) => match[1] || match[0],
    },
  ];
}

function buildCustomDetectors(customPatterns = []) {
  return customPatterns
    .map((pattern) => {
      try {
        return {
          type: 'custom',
          description: 'Custom sensitive pattern.',
          regex: new RegExp(pattern, 'gi'),
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function collectPayloadStrings(value, path = [], out = []) {
  if (typeof value === 'string') {
    out.push({ path, value });
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, i) => collectPayloadStrings(entry, [...path, i], out));
    return out;
  }
  if (value && typeof value === 'object') {
    Object.entries(value).forEach(([k, v]) => collectPayloadStrings(v, [...path, k], out));
  }
  return out;
}

function getByPath(target, path) {
  return path.reduce((acc, key) => (acc == null ? acc : acc[key]), target);
}

function setByPath(target, path, nextValue) {
  if (path.length === 0) return;
  let node = target;
  for (let i = 0; i < path.length - 1; i += 1) {
    node = node[path[i]];
  }
  node[path[path.length - 1]] = nextValue;
}

function runDetectorsOnText(text, detectors, base) {
  const matches = [];
  for (const detector of detectors) {
    detector.regex.lastIndex = 0;
    let hit;
    while ((hit = detector.regex.exec(text)) !== null) {
      const raw = detector.extract ? detector.extract(hit) : hit[0];
      if (!raw) continue;
      if (detector.validate && !detector.validate(raw)) continue;
      matches.push({
        id: `${base.path.join('.')}:${detector.type}:${hit.index}:${raw}`,
        type: detector.type,
        description: detector.description,
        snippet: raw,
        path: base.path,
        line: text.slice(0, hit.index).split('\n').length,
        start: hit.index,
        end: hit.index + raw.length,
      });
      if (hit.index === detector.regex.lastIndex) detector.regex.lastIndex += 1;
    }
  }
  return matches;
}

export function scanSensitiveData({ prompt = '', variables = {}, payload = {} }, settingsInput) {
  const settings = normalizeSettings(settingsInput);
  if (!settings.enabled) return { matches: [], settings };

  const detectors = [
    ...getBuiltInDetectors().filter((d) => settings.types[d.type]),
    ...(settings.types.custom ? buildCustomDetectors(settings.customPatterns) : []),
  ];

  if (!detectors.length) return { matches: [], settings };

  const sources = [
    { path: ['prompt'], value: String(prompt || '') },
    ...Object.entries(variables || {}).map(([key, val]) => ({
      path: ['variables', key],
      value: String(val || ''),
    })),
    ...collectPayloadStrings(payload),
  ].filter((entry) => typeof entry.value === 'string' && entry.value);

  const all = sources.flatMap((source) => runDetectorsOnText(source.value, detectors, source));
  const deduped = [];
  const seen = new Set();
  for (const match of all) {
    const key = `${match.type}:${match.snippet}:${match.path.join('.')}:${match.start}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(match);
  }

  return { matches: deduped, settings };
}

function escapeRegex(input) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function redactPayload(payload, matches) {
  const safePayload = JSON.parse(JSON.stringify(payload || {}));
  if (!Array.isArray(matches) || matches.length === 0) return safePayload;

  const groupedByPath = new Map();
  for (const match of matches) {
    const key = match.path.join('.');
    if (!groupedByPath.has(key)) groupedByPath.set(key, []);
    groupedByPath.get(key).push(match);
  }

  for (const [pathKey, pathMatches] of groupedByPath.entries()) {
    const path = pathKey ? pathKey.split('.').map((p) => (String(Number(p)) === p ? Number(p) : p)) : [];
    const current = getByPath(safePayload, path);
    if (typeof current !== 'string') continue;
    let next = current;
    for (const match of pathMatches) {
      const placeholder = PLACEHOLDERS[match.type] || PLACEHOLDERS.custom;
      next = next.replace(new RegExp(escapeRegex(match.snippet), 'g'), placeholder);
    }
    setByPath(safePayload, path, next);
  }

  return safePayload;
}

export function summarizeMatches(matches) {
  return (matches || []).map((m) => ({
    ...m,
    placeholder: PLACEHOLDERS[m.type] || PLACEHOLDERS.custom,
    preview: m.snippet.length > 32 ? `${m.snippet.slice(0, 8)}…${m.snippet.slice(-6)}` : m.snippet,
  }));
}
