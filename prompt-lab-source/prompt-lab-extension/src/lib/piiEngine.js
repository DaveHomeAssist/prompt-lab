import { luhnPasses } from './utils.js';
import patternSpec from '../../../shared/pii-patterns.json' with { type: 'json' };

// Pattern text, labels, and thresholds live in the shared spec so the iOS port
// compiles the same expressions. Quantifiers in the credential patterns are
// greedy and unbounded on purpose: a lazy or capped quantifier stops early
// and the rest of the secret reaches the provider.
const {
  secretMinLength: SECRET_MIN_LENGTH,
  envValueMinLength: ENV_VALUE_MIN_LENGTH,
  bearerMinLength: BEARER_MIN_LENGTH,
} = patternSpec.constants;
// Sentence punctuation after a bare value is prose, not part of the secret.
const TRAILING_PROSE_PUNCTUATION = new RegExp(patternSpec.constants.trailingProsePunctuation);
// Template and environment references ({{db_password}}, ${SECRET}, $DB_PASSWORD, %TOKEN%)
// name a secret without containing one.
const SECRET_REFERENCE = new RegExp(patternSpec.constants.secretReference);
// A SNAKE_CASE segment that names a secret. Exact segment (or a trailing plural),
// so MONKEY and AUTHOR do not match KEY and AUTH.
const ENV_SECRET_SEGMENT = new RegExp(patternSpec.constants.envSecretSegment, 'i');
// Function words. A multi-word value made only of other words is a passphrase
// ("correct horse battery staple"). A value that uses one of these is a sentence
// ("it is private") and only its first token is eligible, which then fails the
// length check and stays as written.
const PROSE_WORDS = new Set(patternSpec.constants.proseWords);
const PEM_BEGIN = patternSpec.constants.pemBegin;
const PEM_END = patternSpec.constants.pemEndMarker;
const PEM_HEADER = new RegExp(patternSpec.constants.pemHeader);
const PEM_END_PATTERN = new RegExp(patternSpec.constants.pemEnd);
const JWT_ASSIGNED = new RegExp(patternSpec.constants.jwtAssignmentPrefix, 'i');
const EMAIL_LOCAL_CHAR = new RegExp(patternSpec.constants.emailLocalChar);
const EMAIL_DOMAIN_CHAR = new RegExp(patternSpec.constants.emailDomainChar);
const EMAIL_TLD = new RegExp(patternSpec.constants.emailTld);
const ASCII_WORD = new RegExp(patternSpec.constants.asciiWord);
const SCHEME_CHAR = new RegExp(patternSpec.constants.schemeChar);
const SCHEME_START = new RegExp(patternSpec.constants.schemeStartChar);
const PASSPHRASE_WORD = new RegExp(patternSpec.constants.passphraseWord);
const ENV_ASSIGNMENT = new RegExp(patternSpec.constants.envAssignment);

function detectorSpec(id) {
  const detector = patternSpec.detectors.find((item) => item.id === id);
  if (!detector) throw new Error(`Missing sensitive-data detector: ${id}`);
  return detector;
}

function detectorRegex(id) {
  const detector = detectorSpec(id);
  return new RegExp(detector.regex, detector.flags || '');
}

function isKeyChar(ch) {
  if (!ch) return false;
  const code = ch.charCodeAt(0);
  return (code >= 48 && code <= 57)
    || (code >= 65 && code <= 90)
    || (code >= 97 && code <= 122)
    || code === 45
    || code === 95;
}

function asMatch(value, index) {
  const match = [value];
  match.index = index;
  return match;
}

function envNameIsSecret(name) {
  return name.split('_').some((part) => ENV_SECRET_SEGMENT.test(part));
}

function parseEnvValue(raw) {
  if (raw.startsWith('"')) {
    const end = raw.indexOf('"', 1);
    if (end > 1) return { value: raw.slice(1, end), offset: 1 };
    return { value: raw.slice(1).replace(/[ \t]+$/, ''), offset: 1 };
  }
  if (raw.startsWith("'")) {
    const end = raw.indexOf("'", 1);
    if (end > 1) return { value: raw.slice(1, end), offset: 1 };
    return { value: raw.slice(1).replace(/[ \t]+$/, ''), offset: 1 };
  }
  const lead = raw.match(/^[ \t]*/)[0].length;
  const body = raw.slice(lead);
  let stop = body.length;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === '&' || ch === ';' || ch === '\r') {
      stop = i;
      break;
    }
  }
  return { value: body.slice(0, stop).replace(/[ \t]+$/, ''), offset: lead };
}

// One forward pass per line. The name check is a segment split, not a
// backtracking search, so a long line cannot explode.
function findEnvSecrets(source) {
  const found = [];
  const visit = (line, start) => {
    const lead = line.match(/^[ \t]*/)[0].length;
    const body = line.slice(lead).replace(/\r$/, '');
    const assignment = ENV_ASSIGNMENT.exec(body);
    if (!assignment || !envNameIsSecret(assignment[1])) return;
    const parsed = parseEnvValue(assignment[2]);
    if (!parsed.value || parsed.value.length < ENV_VALUE_MIN_LENGTH || SECRET_REFERENCE.test(parsed.value)) return;
    const valueStart = assignment[0].length - assignment[2].length + parsed.offset;
    const match = asMatch(parsed.value, start + lead + valueStart);
    match.env = true;
    found.push(match);
  };
  let lineStart = 0;
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] !== '\n') continue;
    visit(source.slice(lineStart, i), lineStart);
    lineStart = i + 1;
  }
  visit(source.slice(lineStart), lineStart);
  return found;
}

function isUserinfoBoundary(ch) {
  return !ch || patternSpec.constants.userinfoBoundaries.includes(ch);
}

// scheme://user:password@ in one forward pass. No nested quantifiers.
function findUrlUserinfo(source) {
  const found = [];
  let from = 0;
  while (from < source.length) {
    const scheme = source.indexOf('://', from);
    if (scheme < 0) break;
    let start = scheme - 1;
    while (start >= 0 && SCHEME_CHAR.test(source[start])) start -= 1;
    start += 1;
    if (start >= scheme || !SCHEME_START.test(source[start])) {
      from = scheme + 3;
      continue;
    }
    let i = scheme + 3;
    const userStart = i;
    while (i < source.length && !isUserinfoBoundary(source[i])) i += 1;
    if (source[i] !== ':' || i === userStart) {
      from = scheme + 3;
      continue;
    }
    const user = source.slice(userStart, i);
    i += 1;
    const passStart = i;
    while (i < source.length && !isUserinfoBoundary(source[i])) i += 1;
    const password = source.slice(passStart, i);
    if (source[i] !== '@' || password.length < 3 || SECRET_REFERENCE.test(user) || SECRET_REFERENCE.test(password)) {
      from = scheme + 3;
      continue;
    }
    const match = asMatch(`${user}:${password}`, userStart);
    match.url = true;
    found.push(match);
    from = i + 1;
  }
  return found;
}

function normalizePassphrase(raw) {
  const trimmed = String(raw).replace(/[ \t]+$/, '').replace(TRAILING_PROSE_PUNCTUATION, '');
  const words = trimmed.split(/[ \t]+/).filter(Boolean);
  const passphrase = words.length >= 2 && words.length <= 16 && words.every((word) => {
    const bare = word.replace(TRAILING_PROSE_PUNCTUATION, '');
    return bare.length >= 2
      && PASSPHRASE_WORD.test(bare)
      && !PROSE_WORDS.has(bare.toLowerCase());
  });
  if (passphrase) return trimmed;
  return String(raw).split(/[ \t]/)[0].replace(TRAILING_PROSE_PUNCTUATION, '');
}

function extractSecret(match) {
  if (match.env || match.url) return match[0];
  if (match[1] != null) return match[1];
  if (match[2] != null) return match[2];
  if (match[3] != null) return normalizePassphrase(match[3]);
  if (match[4] != null) return match[4].replace(TRAILING_PROSE_PUNCTUATION, '');
  return '';
}

function locateSecret(match, value) {
  if (match.env || match.url) return 0;
  const separator = Math.max(match[0].lastIndexOf('='), match[0].lastIndexOf(':'));
  const from = separator >= 0 ? separator + 1 : 0;
  const at = match[0].indexOf(value, from);
  return at >= 0 ? at : Math.max(match[0].lastIndexOf(value), 0);
}

function secretValueOk(value, match) {
  if (!value || SECRET_REFERENCE.test(value)) return false;
  if (match.env) return value.length >= ENV_VALUE_MIN_LENGTH;
  if (match.url) return value.length >= patternSpec.constants.urlSecretMinLength;
  return value.length >= SECRET_MIN_LENGTH;
}

// PEM blocks and JWTs are walked with indexOf. A regex with a lazy "anything
// until END" (or eyJ…eyJ… with no dots) re-scans a long miss from every hit.
function findPrivateKeys(source) {
  const found = [];
  let from = 0;
  while (from < source.length) {
    const start = source.indexOf(PEM_BEGIN, from);
    if (start < 0) break;
    const headerClose = source.indexOf('-----', start + PEM_BEGIN.length);
    if (headerClose < 0) break;
    const header = source.slice(start + PEM_BEGIN.length, headerClose);
    if (header.length > patternSpec.constants.pemHeaderMax || !PEM_HEADER.test(header)) {
      from = start + PEM_BEGIN.length;
      continue;
    }
    const end = source.indexOf(PEM_END, headerClose + 5);
    if (end < 0 || end - start > patternSpec.constants.pemMaxSpan) {
      from = headerClose + 5;
      continue;
    }
    const tail = source.slice(end, Math.min(source.length, end + patternSpec.constants.snippetMax));
    const endMatch = PEM_END_PATTERN.exec(tail);
    if (!endMatch) {
      from = end + PEM_END.length;
      continue;
    }
    const stop = end + endMatch[0].length;
    found.push(asMatch(source.slice(start, stop), start));
    from = stop;
  }
  return found;
}

function scanJwt(source, start) {
  let i = start;
  for (let segment = 0; segment < 3; segment += 1) {
    if (segment < 2) {
      if (source.slice(i, i + 3) !== 'eyJ') return { resume: start + 3 };
      i += 3;
    }
    const segmentStart = i;
    while (i < source.length && isKeyChar(source[i])) i += 1;
    const segmentLength = i - segmentStart;
    if (segment < 2) {
      if (segmentLength < 8 || source[i] !== '.') return { resume: source[i] === '.' ? start + 3 : Math.max(i, start + 3) };
      i += 1;
    } else if (segmentLength < 8) {
      return { resume: start + 3 };
    }
  }
  return { end: i };
}

function findJwts(source) {
  const found = [];
  let from = 0;
  while (from < source.length) {
    const start = source.indexOf('eyJ', from);
    if (start < 0) break;
    if (start > 0 && ASCII_WORD.test(source[start - 1])) {
      from = start + 3;
      continue;
    }
    const scanned = scanJwt(source, start);
    if (scanned.end == null) {
      from = scanned.resume;
      continue;
    }
    const prefix = source.slice(Math.max(0, start - patternSpec.constants.jwtPrefixWindow), start);
    // A Bearer token keeps the BEARER_TOKEN label. An assignment such as
    // "token: <jwt>" keeps the SECRET label. Both are matched elsewhere.
    if (JWT_ASSIGNED.test(prefix)) {
      from = scanned.end;
      continue;
    }
    found.push(asMatch(source.slice(start, scanned.end), start));
    from = scanned.end;
  }
  return found;
}

function isUrlUserinfoAt(source, at) {
  let i = at - 1;
  while (i >= 0 && !isUserinfoBoundary(source[i])) i -= 1;
  if (source[i] !== ':') return false;
  i -= 1;
  const userEnd = i;
  while (i >= 0 && !isUserinfoBoundary(source[i])) i -= 1;
  if (i === userEnd) return false;
  return source.slice(Math.max(0, i - 2), i + 1) === '://';
}

function findEmails(source) {
  const found = [];
  let from = 0;
  while (from < source.length) {
    const at = source.indexOf('@', from);
    if (at <= 0) {
      if (at < 0) break;
      from = at + 1;
      continue;
    }
    if (isUrlUserinfoAt(source, at)) {
      from = at + 1;
      continue;
    }
    let start = at - 1;
    while (start >= 0 && at - start <= patternSpec.constants.emailLocalMax && EMAIL_LOCAL_CHAR.test(source[start])) start -= 1;
    start += 1;
    if (start === at || (start > 0 && ASCII_WORD.test(source[start - 1]))) {
      from = at + 1;
      continue;
    }
    let end = at + 1;
    const domainLimit = Math.min(source.length, end + patternSpec.constants.emailDomainMax);
    while (end < domainLimit && EMAIL_DOMAIN_CHAR.test(source[end])) end += 1;
    while (end > at + 1 && source[end - 1] === '.') end -= 1;
    const domain = source.slice(at + 1, end);
    const dot = domain.lastIndexOf('.');
    const tld = dot >= 0 ? domain.slice(dot + 1) : '';
    if (dot <= 0 || tld.length < patternSpec.constants.tldMin || tld.length > patternSpec.constants.tldMax || !EMAIL_TLD.test(tld)) {
      from = at + 1;
      continue;
    }
    if (end < source.length && ASCII_WORD.test(source[end])) {
      from = at + 1;
      continue;
    }
    found.push(asMatch(source.slice(start, end), start));
    from = end;
  }
  return found;
}

function findCredentialBlocks(source) {
  return [...findPrivateKeys(source), ...findJwts(source)];
}

function patternFields(id) {
  const detector = detectorSpec(id);
  return {
    label: detector.label,
    description: detector.description,
    placeholder: detector.placeholder,
    ...(detector.regex ? { regex: detectorRegex(id) } : {}),
  };
}

// Provider keys have no upper bound and no trailing \b: a cap drops the whole
// key once it is longer than the cap, and \b fails when the key ends in "-" or "_".
// A later assignment on the same line stops a passphrase run so it cannot swallow
// the next secret. Both expressions are compiled from the shared spec.
export const patterns = Object.freeze({
  ssn: Object.freeze(patternFields('ssn')),
  credit_card: Object.freeze({
    ...patternFields('credit_card'),
    validate: (value) => luhnPasses(value),
  }),
  email: Object.freeze({
    ...patternFields('email'),
    // indexOf walk, capped at the RFC local-part and domain lengths. An uncapped
    // local-part regex re-scans every hyphenated miss (sk-sk-sk-…) looking for "@".
    // The "@" in scheme://user:password@host is not an email address.
    find: findEmails,
  }),
  phone: Object.freeze({
    ...patternFields('phone'),
    // \b cannot sit before "(" or "+" (both non-word), so a leading paren or country-code
    // plus must be allowed to start the match or it is left behind when redacting.
  }),
  ip: Object.freeze(patternFields('ip')),
  api_key: Object.freeze({
    ...patternFields('api_key'),
    find: findCredentialBlocks,
  }),
  // Registered after api_key so an exact tie (a Bearer token that is also a provider key)
  // keeps the more specific api_key label; see resolveOverlaps.
  bearer_token: Object.freeze({
    ...patternFields('bearer_token'),
    extract: (match) => match[1] || match[0],
    validate: (value) => value.length >= BEARER_MIN_LENGTH,
  }),
  secret_value: Object.freeze({
    ...patternFields('secret_value'),
    find: (source) => [...findEnvSecrets(source), ...findUrlUserinfo(source)],
    extract: extractSecret,
    locate: locateSecret,
    validateMatch: secretValueOk,
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
  const max = patternSpec.constants.snippetMax;
  const head = patternSpec.constants.snippetHead;
  return value.length > max ? `${value.slice(0, head)}...` : value;
}

function makeFinding(detector, match, index) {
  const value = detector.extract ? detector.extract(match) : match[0];
  if (!value) return null;
  if (detector.validateMatch) {
    if (!detector.validateMatch(value, match)) return null;
  } else if (detector.validate && !detector.validate(value)) return null;

  // Extracted values sit after the keyword. Search from the separator so a
  // shortened first token is not pinned to a later copy of the same word.
  const relative = detector.extract
    ? (detector.locate ? detector.locate(match, value) : match[0].lastIndexOf(value))
    : 0;
  if (relative < 0) return null;
  const start = match.index + relative;
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
    const matches = [];
    if (typeof detector.find === 'function') {
      for (const match of detector.find(source)) matches.push(match);
    }
    if (detector.regex) {
      detector.regex.lastIndex = 0;
      let match = detector.regex.exec(source);
      while (match) {
        matches.push(match);
        if (match.index === detector.regex.lastIndex) detector.regex.lastIndex += 1;
        match = detector.regex.exec(source);
      }
    }
    for (const match of matches) {
      const finding = makeFinding(detector, match, findings.length);
      if (finding) {
        const key = `${finding.type}:${finding.start}:${finding.end}:${finding.value}`;
        if (!seen.has(key)) {
          seen.add(key);
          findings.push(finding);
        }
      }
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
