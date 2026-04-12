const DEFAULT_HOSTED_ENDPOINT = 'https://promptlab.tools/api/bug-report';
const MAX_TEXT = 6000;
const MAX_PROMPT = 12000;
const MAX_TITLE = 160;
const SEVERITIES = new Set(['Low', 'Medium', 'High', 'Critical']);

function clampText(value, max) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

export function resolveBugReportEndpoint({ override, isWeb, locationOrigin } = {}) {
  if (override) return override;
  if (isWeb && typeof locationOrigin === 'string' && /^https?:/i.test(locationOrigin)) {
    return `${locationOrigin.replace(/\/$/, '')}/api/bug-report`;
  }
  return DEFAULT_HOSTED_ENDPOINT;
}

export function sanitizeBugReportPayload(payload = {}) {
  const severity = SEVERITIES.has(payload.severity) ? payload.severity : 'Medium';
  const context = payload.context && typeof payload.context === 'object'
    ? Object.fromEntries(
        Object.entries(payload.context)
          .filter(([, value]) => value !== undefined && value !== null && value !== '')
          .map(([key, value]) => [
            key,
            typeof value === 'string' ? clampText(value, MAX_TEXT) : value,
          ])
      )
    : {};
  const promptContext = payload.promptContext && typeof payload.promptContext === 'object'
    ? {
        raw: clampText(payload.promptContext.raw, MAX_PROMPT),
        enhanced: clampText(payload.promptContext.enhanced, MAX_PROMPT),
        mode: clampText(payload.promptContext.mode, 64),
      }
    : null;

  return {
    title: clampText(payload.title, MAX_TITLE),
    severity,
    product: clampText(payload.product || 'Prompt Lab', 80),
    surface: clampText(payload.surface, 120),
    steps: clampText(payload.steps, MAX_TEXT),
    expected: clampText(payload.expected, MAX_TEXT),
    actual: clampText(payload.actual, MAX_TEXT),
    contact: clampText(payload.contact, 160),
    url: clampText(payload.url, 1000),
    website: clampText(payload.website, 200),
    context,
    promptContext,
  };
}

export async function submitBugReport(payload, options = {}) {
  const endpoint = resolveBugReportEndpoint(options);
  const body = sanitizeBugReportPayload(payload);
  const fetchImpl = options.fetchImpl || fetch;

  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || 'Bug report failed');
  }
  return data;
}
