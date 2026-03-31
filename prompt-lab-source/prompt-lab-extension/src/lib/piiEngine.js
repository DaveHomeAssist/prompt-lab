import { luhnPasses } from './utils.js';

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
    regex: /\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g,
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
    regex: /\b(sk-[A-Za-z0-9]{16,128}|gh[pousr]_[A-Za-z0-9]{20,80}|AIza[0-9A-Za-z\-_]{20,60}|xox[baprs]-[A-Za-z0-9-]{10,80}|(?:api|secret|access|private)[_\-\s]?(?:key|token)\s*[:=]\s*["']?[A-Za-z0-9_\-]{12,128}?)\b/gi,
  }),
  secret_value: Object.freeze({
    label: 'Secret-looking value',
    description: 'Looks like a password or secret assignment.',
    placeholder: 'SECRET',
    regex: /\b(?:token|secret|password|passwd|private[_-]?key|client[_-]?secret)\b\s*[:=]\s*["']?([A-Za-z0-9+/_\-]{10,128}?)["']?/gi,
    extract: (match) => match[1] || match[0],
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
    snippet: value.length > 80 ? `${value.slice(0, 77)}...` : value,
    value,
    start,
    end,
  };
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

  findings.sort((a, b) => a.start - b.start || b.end - a.end);
  return { hasPII: findings.length > 0, findings };
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
  const sorted = [...findings]
    .filter((finding) => Number.isFinite(finding.start) && Number.isFinite(finding.end) && finding.end > finding.start)
    .sort((a, b) => b.start - a.start);

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
