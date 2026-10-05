import { luhnPasses } from './utils.js';

// Body of a credential value, shared by the secret-assignment and Bearer detectors:
// base64/base64url characters, optionally dot-joined (JWT segments) and "="-padded.
// The quantifiers are greedy and unbounded on purpose. A lazy or capped quantifier
// stops early (or misses entirely) and the rest of the secret reaches the provider.
const TOKEN_BODY = String.raw`[A-Za-z0-9+/_\-]+(?:\.[A-Za-z0-9+/_\-]+)*=*`;
const SECRET_MIN_LENGTH = 10;
const BEARER_MIN_LENGTH = 16;

export const patterns = Object.freeze({
  ssn: Object.freeze({
    label: 'SSN',
    description: 'Looks like a US Social Security number.',
    placeholder: 'SSN',
    regex: /\b\d{3}-?\d{2}-?\d{4}\b/g,
  }),
  credit_card: Object.freeze({
    label: 'Credit card',
    description: 'Looks like a payment card number.',
    placeholder: 'CARD',
    regex: /\b(?:\d[ -]*?){13,19}\b/g,
    validate: (value) => luhnPasses(value),
  }),
  email: Object.freeze({
    label: 'Email address',
    description: 'Contains an email address.',
    placeholder: 'EMAIL',
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  }),
  phone: Object.freeze({
    label: 'Phone number',
    description: 'Looks like a phone number.',
    placeholder: 'PHONE',
    // \b cannot sit before "(" or "+" (both non-word), so a leading paren or country-code
    // plus must be allowed to start the match or it is left behind when redacting.
    regex: /(?:\b(?=\d)|(?=[+(]))(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g,
  }),
  ip: Object.freeze({
    label: 'IP address',
    description: 'Contains an IPv4 address.',
    placeholder: 'IP',
    regex: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g,
  }),
  api_key: Object.freeze({
    label: 'API key / token',
    description: 'Looks like an API credential or token.',
    placeholder: 'API_KEY',
    regex: /\b(sk-[A-Za-z0-9]{16,128}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,80}|AIza[0-9A-Za-z\-_]{20,60}|xox[baprs]-[A-Za-z0-9-]{10,80}|(?:api|secret|access|private)[_\-\s]?(?:key|token)\s*[:=]\s*["']?[A-Za-z0-9_\-]{12,})\b/gi,
  }),
  // Registered after api_key so an exact tie (a Bearer token that is also a provider key)
  // keeps the more specific api_key label; see resolveOverlaps.
  bearer_token: Object.freeze({
    label: 'Bearer token',
    description: 'Looks like an HTTP Authorization bearer token.',
    placeholder: 'BEARER_TOKEN',
    regex: new RegExp(String.raw`\bbearer[ \t]+(${TOKEN_BODY})`, 'gi'),
    extract: (match) => match[1] || match[0],
    validate: (value) => value.length >= BEARER_MIN_LENGTH,
  }),
  secret_value: Object.freeze({
    label: 'Secret-looking value',
    description: 'Looks like a password or secret assignment.',
    placeholder: 'SECRET',
    regex: new RegExp(
      String.raw`\b(?:token|secret|password|passwd|private[_-]?key|client[_-]?secret)\b\s*[:=]\s*["']?(${TOKEN_BODY})`,
      'gi',
    ),
    extract: (match) => match[1] || match[0],
    validate: (value) => value.length >= SECRET_MIN_LENGTH,
  }),
});

function enabledPatternIds(options = {}) {
  if (Array.isArray(options.enabledTypes) && options.enabledTypes.length > 0) {
    return new Set(options.enabledTypes.filter((id) => patterns[id]));
  }

  const configured = options.patterns;
  if (configured && typeof configured === 'object') {
    return new Set(
      Object.keys(patterns).filter((id) => configured[id] !== false),
    );
  }

  return new Set(Object.keys(patterns));
}

function buildCustomDetectors(customPatterns = []) {
  return customPatterns
    .map((pattern) => {
      try {
        return {
          type: 'custom',
          label: 'Custom pattern',
          description: 'Matched a user-defined sensitive-data pattern.',
          placeholder: 'REDACTED',
          regex: new RegExp(pattern, 'gi'),
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function buildDetectors(options = {}) {
  const activeIds = enabledPatternIds(options);
  const builtIn = Object.entries(patterns)
    .filter(([id]) => activeIds.has(id))
    .map(([type, def]) => ({ type, ...def }));

  const includeCustom = options.patterns?.custom !== false && options.includeCustom !== false;
  return includeCustom
    ? [...builtIn, ...buildCustomDetectors(options.customPatterns)]
    : builtIn;
}

function snippetOf(value) {
  return value.length > 80 ? `${value.slice(0, 77)}...` : value;
}

function makeFinding(detector, match, index) {
  const value = detector.extract ? detector.extract(match) : match[0];
  if (!value) return null;
  if (detector.validate && !detector.validate(value)) return null;

  const start = detector.extract ? match.index + match[0].indexOf(value) : match.index;
  const end = start + value.length;
  return {
    id: `${detector.type}:${start}:${end}:${index}`,
    type: detector.type,
    label: detector.label || 'Sensitive value',
    description: detector.description || 'Potentially sensitive data.',
    placeholder: detector.placeholder || 'REDACTED',
    snippet: snippetOf(value),
    value,
    start,
    end,
  };
}

// Findings of different types can cover the same text: a Bearer token that is also an API
// key, digits that are both a phone number and an email local part, an assignment that is
// both an api_key and a secret_value. Applying overlapping spans one after another
// corrupts the output (the second replacement lands on already-shifted text), so keep one
// finding per region. The earliest, longest span wins and an exact tie goes to the
// finding listed first (registry order). A partial overlap widens the kept finding to the
// union so no tail of either match survives.
function resolveOverlaps(findings, source) {
  const ordered = [...findings].sort((a, b) => a.start - b.start || b.end - a.end);
  const resolved = [];
  for (const finding of ordered) {
    const last = resolved[resolved.length - 1];
    if (!last || finding.start >= last.end) {
      resolved.push(finding);
    } else if (finding.end > last.end) {
      const value = source.slice(last.start, finding.end);
      resolved[resolved.length - 1] = { ...last, snippet: snippetOf(value), value, end: finding.end };
    }
  }
  return resolved;
}

export function scanForPII(text, options = {}) {
  const source = typeof text === 'string' ? text : '';
  if (!source.trim()) return { hasPII: false, findings: [] };

  const detectors = buildDetectors(options);
  const findings = [];
  const seen = new Set();

  for (const detector of detectors) {
    detector.regex.lastIndex = 0;
    let match = detector.regex.exec(source);
    while (match) {
      const finding = makeFinding(detector, match, findings.length);
      if (finding) {
        const key = `${finding.type}:${finding.start}:${finding.end}:${finding.value}`;
        if (!seen.has(key)) {
          seen.add(key);
          findings.push(finding);
        }
      }
      if (match.index === detector.regex.lastIndex) detector.regex.lastIndex += 1;
      match = detector.regex.exec(source);
    }
  }

  const resolved = resolveOverlaps(findings, source);
  return { hasPII: resolved.length > 0, findings: resolved };
}

function formatPlaceholder(placeholder, index, style) {
  const base = index > 1 ? `${placeholder}_${index}` : placeholder;
  return style === 'brackets' ? `[${base}]` : base;
}

export function redactText(text, options = {}) {
  const source = typeof text === 'string' ? text : '';
  const findings = Array.isArray(options.findings)
    ? options.findings
    : scanForPII(source, options).findings;

  if (findings.length === 0) return source;

  const style = options.placeholderStyle === 'brackets' ? 'brackets' : 'plain';
  const redactionMap = options.redactionMap ? { ...options.redactionMap } : {};
  const typeCounters = {};
  // Callers may pass their own (e.g. user-filtered) findings, so resolve overlaps here too.
  const sorted = resolveOverlaps(
    findings.filter((finding) => Number.isFinite(finding.start) && Number.isFinite(finding.end) && finding.end > finding.start),
    source,
  ).reverse();

  let redacted = source;
  for (const finding of sorted) {
    const value = finding.value || source.slice(finding.start, finding.end);
    if (!value) continue;
    if (!redactionMap[value]) {
      typeCounters[finding.type] = (typeCounters[finding.type] || 0) + 1;
      redactionMap[value] = formatPlaceholder(finding.placeholder || 'REDACTED', typeCounters[finding.type], style);
    }
    redacted = `${redacted.slice(0, finding.start)}${redactionMap[value]}${redacted.slice(finding.end)}`;
  }

  return redacted;
}
