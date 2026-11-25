// Fail closed. Enhance may run only after the content script has classified
// the field as a plain input, textarea, or contenteditable. A password field,
// a password autocomplete token, a shadow host that is one of those, or a
// capture that never classified the field sends nothing to the provider.

const SECRET_AUTOCOMPLETE = new Set(['current-password', 'new-password', 'one-time-code']);
export const CLASSIFIED_KINDS = new Set(['textarea', 'input', 'contenteditable']);
export const UNCLASSIFIED_NOTICE = "This field couldn't be checked, so nothing was sent.";
export const SECRET_FIELD_NOTICE = 'Secure fields are left alone. Nothing was sent.';

export function autocompleteIsSecret(value) {
  return String(value || '')
    .toLowerCase()
    .split(/[\s,]+/)
    .filter(Boolean)
    .some((token) => SECRET_AUTOCOMPLETE.has(token));
}

export function isPasswordInput(element) {
  return element?.tagName === 'INPUT' && String(element.getAttribute?.('type') || '').toLowerCase() === 'password';
}

function shadowHost(element) {
  const root = element?.getRootNode?.();
  return root && root.host ? root.host : null;
}

/** Walk the element, its ancestors, and each shadow host. */
export function secretFieldRefusal(element) {
  let current = element;
  const seen = new Set();
  while (current && !seen.has(current)) {
    seen.add(current);
    if (isPasswordInput(current)) {
      return { blocked: 'password', message: SECRET_FIELD_NOTICE };
    }
    if (autocompleteIsSecret(current.getAttribute?.('autocomplete'))) {
      return { blocked: 'secret', message: SECRET_FIELD_NOTICE };
    }
    const host = shadowHost(current);
    current = current.parentElement || (host && !seen.has(host) ? host : null);
  }
  return null;
}

/**
 * Decide whether an Enhance click may call the provider.
 * Browser menu selection text is ignored: an unclassified field is a refusal.
 */
export function enhanceDecision(captured) {
  if (captured?.blocked === 'password' || captured?.blocked === 'secret' || captured?.reason === 'password' || captured?.reason === 'secret' || captured?.reason === 'frame') {
    return { proceed: false, message: captured.message || SECRET_FIELD_NOTICE };
  }
  if (captured?.ok === true && CLASSIFIED_KINDS.has(captured.kind) && typeof captured.text === 'string' && captured.text.trim()) {
    return { proceed: true, text: captured.text };
  }
  return { proceed: false, message: captured?.message || UNCLASSIFIED_NOTICE };
}
