import { useEffect, useRef, useState } from 'react';
import { scanSensitiveData, redactPayload } from '../piiScanner.js';

import { PROVIDER_SETTINGS_KEYS } from '../lib/providerRegistry.js';
import { PROVIDER_SETTINGS_CHANGED } from '../lib/providerSettingsEvents.js';

/** Approval belongs to one immutable payload and its still-current owner. */
export default function useSensitivePreflight() {
  const queue = useRef([]);
  const [piiWarning, setPiiWarning] = useState(null);
  const showNext = () => setPiiWarning(queue.current[0] || null);
  const invalidate = (scope) => {
    queue.current = scope == null ? [] : queue.current.filter(ticket => ticket.scope !== scope);
    showNext();
  };

  useEffect(() => {
    const clear = () => invalidate();
    const onStorage = (event) => {
      if (event.key == null || event.key === 'pl2-provider-settings') clear();
    };
    // Extension settings live behind the background boundary; never copy keys
    // into approval tickets or history. A settings change revokes the ticket.
    const changes = globalThis.chrome?.storage?.onChanged;
    window.addEventListener(PROVIDER_SETTINGS_CHANGED, clear);
    window.addEventListener('storage', onStorage);
    const onSettings = (changed, area) => {
      if (area === 'local' && PROVIDER_SETTINGS_KEYS.some(key => key in changed)) clear();
    };
    changes?.addListener(onSettings);
    return () => {
      queue.current = [];
      window.removeEventListener(PROVIDER_SETTINGS_CHANGED, clear);
      window.removeEventListener('storage', onStorage);
      changes?.removeListener(onSettings);
    };
  }, []);

  const review = ({ payload, scope, label, isCurrent, resume }) => {
    const snapshot = JSON.parse(JSON.stringify(payload));
    const { matches } = scanSensitiveData({ payload: snapshot });
    invalidate(scope);
    if (!matches.length) return { payload: snapshot, matches };
    queue.current.push({ scope, label, payload: snapshot, matches, isCurrent, resume });
    showNext();
    return { payload: null, matches };
  };

  const resolve = (redact = false) => {
    // Remove synchronously before dispatch: double activation cannot reuse approval.
    const ticket = piiWarning;
    if (!ticket || queue.current[0] !== ticket) return;
    queue.current.shift();
    showNext();
    if (!ticket.isCurrent()) return;
    return ticket.resume(redact ? redactPayload(ticket.payload, ticket.matches) : ticket.payload);
  };

  return {
    piiWarning,
    review,
    invalidate,
    piiSendAnyway: () => resolve(),
    piiRedactAndSend: () => resolve(true),
    piiCancel: () => { queue.current.shift(); showNext(); },
  };
}
