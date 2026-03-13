export function ensureString(value) {
  return typeof value === 'string' ? value : '';
}

export function randomId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `id-${Math.random().toString(36).slice(2, 10)}`;
}

export function hashText(text) {
  const input = ensureString(text);
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
  }
  return `h_${(hash >>> 0).toString(16)}`;
}

export function luhnPasses(digits) {
  const clean = String(digits || '').replace(/\D/g, '');
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

export function normalizeVariant(variant) {
  return {
    label: ensureString(variant?.label) || 'Variant',
    content: ensureString(variant?.content),
  };
}

export function safeDate(value) {
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString() : new Date().toISOString();
}
