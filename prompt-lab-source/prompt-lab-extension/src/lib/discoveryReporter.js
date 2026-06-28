const DEFAULT_HOSTED_ENDPOINT = 'https://promptlab.tools/api/discovery-report';
const MAX_TEXT = 6000;

function clampText(value, max = MAX_TEXT) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

export function resolveDiscoveryFeedbackEndpoint({ override, isWeb, locationOrigin } = {}) {
  if (override) return override;
  if (isWeb && typeof locationOrigin === 'string' && /^https?:/i.test(locationOrigin)) {
    return `${locationOrigin.replace(/\/$/, '')}/api/discovery-report`;
  }
  return DEFAULT_HOSTED_ENDPOINT;
}

export function sanitizeDiscoveryFeedbackPayload(payload = {}) {
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

  return {
    product: clampText(payload.product || 'Prompt Lab', 80),
    surface: clampText(payload.surface, 120),
    contact: clampText(payload.contact, 160),
    worthPayingFor: clampText(payload.worthPayingFor),
    economicWorkflow: clampText(payload.economicWorkflow),
    supportTemplatesEvals: clampText(payload.supportTemplatesEvals),
    priceSensitivity: clampText(payload.priceSensitivity),
    consultantPain: clampText(payload.consultantPain),
    url: clampText(payload.url, 1000),
    website: clampText(payload.website, 200),
    context,
  };
}

export async function submitDiscoveryFeedback(payload, options = {}) {
  const endpoint = resolveDiscoveryFeedbackEndpoint(options);
  const body = sanitizeDiscoveryFeedbackPayload(payload);
  const fetchImpl = options.fetchImpl || fetch;

  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || 'Discovery feedback failed');
  }
  return data;
}
