export const REDACTION_SETTINGS_KEY = 'pl2-redaction-settings';

const TYPE_META = {
  api_key: {
    label: 'API key / token',
    description: 'Looks like an API credential or token.',
    placeholder: 'API_KEY',
  },
  email: {
    label: 'Email address',
    description: 'Contains an email address.',
    placeholder: 'EMAIL',
  },
  credit_card: {
    label: 'Credit card',
    description: 'Looks like a payment card number.',
    placeholder: 'CARD',
  },
  secret_value: {
    label: 'Secret-looking value',
    description: 'Looks like a password or secret assignment.',
    placeholder: 'SECRET',
  },
  custom: {
    label: 'Custom pattern',
    description: 'Matched a user-defined sensitive-data pattern.',
    placeholder: 'REDACTED',
  },
};

export function defaultRedactionSettings() {
  return {
    enabled: true,
    patterns: {
      api_key: true,
      email: true,
      credit_card: true,
      secret_value: true,
      custom: true,
    },
    customPatterns: [],
  };
}

export function loadRedactionSettings() {
  try {
    const raw = localStorage.getItem(REDACTION_SETTINGS_KEY);
    if (!raw) return defaultRedactionSettings();
    const parsed = JSON.parse(raw);
    return {
      ...defaultRedactionSettings(),
      ...parsed,
      patterns: {
        ...defaultRedactionSettings().patterns,
        ...(parsed?.patterns || {}),
      },
      customPatterns: Array.isArray(parsed?.customPatterns)
        ? parsed.customPatterns.filter(p => typeof p === 'string' && p.trim())
        : [],
    };
  } catch {
    return defaultRedactionSettings();
  }
}

export function saveRedactionSettings(settings) {
  try {
    localStorage.setItem(REDACTION_SETTINGS_KEY, JSON.stringify(settings));
  } catch {}
}

function makeMatch(type, start, end, value) {
  const clean = String(value || '').trim();
  return {
    id: `${type}:${start}:${end}`,
    type,
    label: TYPE_META[type]?.label || 'Sensitive value',
    description: TYPE_META[type]?.description || 'Potentially sensitive data.',
    snippet: clean.length > 80 ? `${clean.slice(0, 77)}...` : clean,
    start,
    end,
    value,
  };
}

function matchesForRegex(type, regex, text, max = 200) {
  const out = [];
  const seen = new Set();
  regex.lastIndex = 0;
  let m = regex.exec(text);
  while (m && out.length < max) {
    const value = m[0] || '';
    const start = m.index;
    const end = start + value.length;
    const k = `${start}:${end}:${value}`;
    if (!seen.has(k) && value.trim()) {
      seen.add(k);
      out.push(makeMatch(type, start, end, value));
    }
    m = regex.exec(text);
  }
  return out;
}

function luhnValid(numberText) {
  const digits = numberText.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let doubleDigit = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let n = Number(digits[i]);
    if (doubleDigit) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    doubleDigit = !doubleDigit;
  }
  return sum % 10 === 0;
}

function looksLikeHighEntropyToken(value) {
  if (!value || value.length < 32) return false;
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) return false;
  if (/^[0-9]+$/.test(value)) return false;
  const unique = new Set(value.split('')).size;
  return unique >= Math.min(16, Math.floor(value.length * 0.45));
}

function runBuiltInDetectors(text, settings) {
  const matches = [];
  const enabled = settings?.patterns || {};

  if (enabled.api_key) {
    matches.push(...matchesForRegex('api_key', /\bsk-[A-Za-z0-9]{16,}\b/g, text));
    matches.push(...matchesForRegex('api_key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, text));
    matches.push(...matchesForRegex('api_key', /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, text));
    matches.push(...matchesForRegex('api_key', /\bAIza[0-9A-Za-z\-_]{20,}\b/g, text));
    matches.push(...matchesForRegex('api_key', /\b(?:xoxb|xoxp|xoxa|xoxr|xoxs)-[A-Za-z0-9-]{10,}\b/g, text));
    const generic = matchesForRegex('api_key', /\b[A-Za-z0-9_\/-]{32,}\b/g, text, 400)
      .filter(m => looksLikeHighEntropyToken(m.value));
    matches.push(...generic);
  }

  if (enabled.email) {
    matches.push(...matchesForRegex('email', /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, text));
  }

  if (enabled.credit_card) {
    const cardLike = matchesForRegex('credit_card', /\b(?:\d[ -]*?){13,19}\b/g, text, 200)
      .filter(m => luhnValid(m.value));
    matches.push(...cardLike);
  }

  if (enabled.secret_value) {
    matches.push(...matchesForRegex('secret_value', /\b(?:password|passwd|secret|token|api[_-]?key|client[_-]?secret)\s*[:=]\s*[^\s,;]+/gi, text));
  }

  return matches;
}

function runCustomDetectors(text, settings) {
  if (!settings?.patterns?.custom) return [];
  if (!Array.isArray(settings.customPatterns) || settings.customPatterns.length === 0) return [];
  const out = [];
  settings.customPatterns.forEach((pattern) => {
    try {
      const re = new RegExp(pattern, 'gi');
      out.push(...matchesForRegex('custom', re, text, 200));
    } catch {}
  });
  return out;
}

export function detectSensitiveData(text, settings = defaultRedactionSettings()) {
  if (!settings?.enabled) return [];
  const source = typeof text === 'string' ? text : '';
  if (!source.trim()) return [];

  const all = [
    ...runBuiltInDetectors(source, settings),
    ...runCustomDetectors(source, settings),
  ];

  const seen = new Set();
  return all
    .sort((a, b) => a.start - b.start || b.end - a.end)
    .filter((m) => {
      const key = `${m.type}:${m.start}:${m.end}:${m.value}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function placeholderFor(type, index) {
  const base = TYPE_META[type]?.placeholder || 'REDACTED';
  return index > 1 ? `${base}_${index}` : base;
}

export function redactSensitiveData(text, matches, existingMap) {
  const source = typeof text === 'string' ? text : '';
  if (!Array.isArray(matches) || matches.length === 0) {
    return {
      redactedText: source,
      redactionMap: existingMap || {},
    };
  }

  const map = existingMap ? { ...existingMap } : {};
  const typeCounters = {};
  const sorted = [...matches]
    .filter(m => Number.isFinite(m.start) && Number.isFinite(m.end) && m.end > m.start)
    .sort((a, b) => b.start - a.start);

  let out = source;
  sorted.forEach((m) => {
    const value = source.slice(m.start, m.end);
    if (!value) return;
    if (!map[value]) {
      typeCounters[m.type] = (typeCounters[m.type] || 0) + 1;
      map[value] = placeholderFor(m.type, typeCounters[m.type]);
    }
    out = `${out.slice(0, m.start)}${map[value]}${out.slice(m.end)}`;
  });

  return {
    redactedText: out,
    redactionMap: map,
  };
}

export function redactPayloadStrings(payload, settings, existingMap) {
  const map = existingMap ? { ...existingMap } : {};
  const found = [];

  const visit = (value) => {
    if (typeof value === 'string') {
      const matches = detectSensitiveData(value, settings);
      if (!matches.length) return value;
      found.push(...matches);
      return redactSensitiveData(value, matches, map).redactedText;
    }
    if (Array.isArray(value)) return value.map(visit);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, visit(v)]));
    }
    return value;
  };

  return {
    payload: visit(payload),
    matches: found,
    redactionMap: map,
  };
}

export function sensitiveTypeMeta() {
  return TYPE_META;
}
