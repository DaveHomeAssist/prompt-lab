import { ensureString } from './lib/utils.js';

function pickCode(msg) {
  const match = msg.match(/\b([A-Z_]{3,}|\d{3})\b/);
  return match ? match[1] : 'UNKNOWN';
}

function detailsFrom(err) {
  if (!err) return '';
  if (typeof err === 'string') return err;
  if (err?.stack) return String(err.stack);
  if (err?.message) return String(err.message);
  return JSON.stringify(err);
}

export function normalizeError(err) {
  const raw = ensureString(err?.message || err).trim();
  const msg = raw.toLowerCase();

  if (/invalid api key|missing api key|unauthorized|forbidden|401|403|authentication/i.test(msg)) {
    return {
      category: 'auth',
      code: pickCode(raw),
      userMessage: 'Authentication failed',
      details: detailsFrom(err),
      suggestions: [
        'Check that the provider API key is present and valid.',
        'Open provider settings and paste a fresh key.',
      ],
      actions: ['open_provider_settings', 'retry'],
    };
  }

  if (/quota|rate limit|429|too many requests|insufficient_quota/i.test(msg)) {
    return {
      category: 'quota',
      code: pickCode(raw),
      userMessage: 'Quota or rate limit reached',
      details: detailsFrom(err),
      suggestions: [
        'Wait briefly and retry.',
        'Reduce request frequency or prompt size.',
      ],
      actions: ['retry', 'shorten_request'],
    };
  }

  if (/network|dns|ssl|failed to fetch|ecconn|offline|cors/i.test(msg)) {
    return {
      category: 'network',
      code: pickCode(raw),
      userMessage: 'Network request failed',
      details: detailsFrom(err),
      suggestions: [
        'Check internet connectivity and VPN/firewall settings.',
        'Retry after connection stabilizes.',
      ],
      actions: ['retry'],
    };
  }

  if (/timeout|timed out|504|response too large|max[_ ]?tokens|context length/i.test(msg)) {
    return {
      category: 'timeout',
      code: pickCode(raw),
      userMessage: 'Request timed out or was too large',
      details: detailsFrom(err),
      suggestions: [
        'Shorten the prompt or expected output.',
        'Retry with lower complexity.',
      ],
      actions: ['shorten_request', 'retry'],
    };
  }

  if (/json|schema|parse|unexpected token|malformed/i.test(msg)) {
    return {
      category: 'schema',
      code: pickCode(raw),
      userMessage: 'Response format issue',
      details: detailsFrom(err),
      suggestions: [
        'Tighten output format instructions in the prompt.',
        'Adjust parsing logic to the provider response shape.',
      ],
      actions: ['shorten_request', 'retry'],
    };
  }

  return {
    category: 'provider',
    code: pickCode(raw),
    userMessage: 'Provider request failed',
    details: detailsFrom(err),
    suggestions: [
      'Retry the request.',
      'Check provider status and settings.',
    ],
    actions: ['retry', 'open_provider_settings'],
  };
}
