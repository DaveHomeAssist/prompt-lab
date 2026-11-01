// Reviewed against Anthropic model IDs and pricing on 2026-10-29.
// Keep the existing default; a saved choice takes precedence.
export const HOSTED_DEFAULT_MODEL = 'claude-sonnet-4-6';
export const HOSTED_MODELS = Object.freeze([
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
  { id: HOSTED_DEFAULT_MODEL, label: 'Claude Sonnet 4.6' },
  { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
]);

export async function loadHostedModels(signal) {
  const response = await fetch('/api/proxy', { signal, cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Hosted models are unavailable.');
  if (!Array.isArray(data.models) || !data.models.length) throw new Error('No hosted models are available.');
  return data.models;
}
