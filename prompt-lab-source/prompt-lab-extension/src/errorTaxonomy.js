import {
  AppError,
  ErrorCategory,
  normalizeError as normalizeAppError,
} from './lib/errorTaxonomy.js';

const LEGACY_CATEGORY_BY_APP_CATEGORY = Object.freeze({
  [ErrorCategory.AUTH]: 'auth',
  [ErrorCategory.RATE_LIMIT]: 'quota',
  [ErrorCategory.NETWORK]: 'network',
  [ErrorCategory.PROVIDER]: 'provider',
  [ErrorCategory.VALIDATION]: 'schema',
  [ErrorCategory.STORAGE]: 'provider',
  [ErrorCategory.PLATFORM]: 'provider',
  [ErrorCategory.UNKNOWN]: 'provider',
});

function rawMessage(error) {
  if (error == null) return '';
  if (typeof error === 'string') return error;
  return error.message || String(error);
}

function pickCode(message) {
  const match = String(message || '').match(/\b(?:[A-Z][A-Z0-9_]{2,}|\d{3})\b/);
  return match?.[0] || 'UNKNOWN';
}

function classifyLegacy(error) {
  const message = rawMessage(error);
  const lower = message.toLowerCase();

  if (
    lower.includes('unexpected token')
    || lower.includes('malformed')
    || lower.includes('invalid json')
  ) {
    return 'schema';
  }

  if (
    lower.includes('timed out')
    || lower.includes('timeout')
    || lower.includes('504')
    || lower.includes('context length')
  ) {
    return 'timeout';
  }

  if (
    lower.includes('failed to fetch')
    || lower.includes('dns')
    || lower.includes('ssl')
    || lower.includes('cors')
    || lower.includes('network')
  ) {
    return 'network';
  }

  if (lower.includes('429') || lower.includes('rate limit') || lower.includes('quota')) {
    return 'quota';
  }

  if (
    lower.includes('401')
    || lower.includes('403')
    || lower.includes('unauthorized')
    || lower.includes('forbidden')
    || lower.includes('api key')
  ) {
    return 'auth';
  }

  if (error instanceof AppError) {
    return LEGACY_CATEGORY_BY_APP_CATEGORY[error.category] || 'provider';
  }

  const appError = normalizeAppError(error);
  return LEGACY_CATEGORY_BY_APP_CATEGORY[appError.category] || 'provider';
}

function suggestionsFor(category) {
  switch (category) {
    case 'auth':
      return ['Check provider settings and API keys.'];
    case 'quota':
      return ['Wait briefly and retry.'];
    case 'network':
      return ['Check connectivity and retry.'];
    case 'timeout':
      return ['Retry with a smaller request.'];
    case 'schema':
      return ['Check the provider response format.'];
    default:
      return ['Retry the request.', 'Check provider status and settings.'];
  }
}

function actionsFor(category) {
  switch (category) {
    case 'auth':
      return ['open_provider_settings'];
    case 'quota':
    case 'network':
    case 'timeout':
    case 'provider':
      return ['retry'];
    default:
      return [];
  }
}

export function normalizeError(error) {
  const message = rawMessage(error);
  const category = classifyLegacy(error);
  const appError = normalizeAppError(error);
  const details = error?.stack || message || appError.debugMessage || '';

  return {
    category,
    code: pickCode(message),
    userMessage: appError.userMessage || message || 'An unexpected error occurred.',
    details,
    suggestions: suggestionsFor(category),
    actions: actionsFor(category),
  };
}

