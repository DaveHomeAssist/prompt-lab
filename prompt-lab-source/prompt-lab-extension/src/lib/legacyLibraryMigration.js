import { DEFAULT_LIBRARY_SEEDS } from '../constants.js';
import { normalizeLibrary } from './promptSchema.js';
import { getLibraryEntrySignature, mergeLibraryEntries } from './libraryMatching.js';
import { ensureString } from './utils.js';

export const APEX_WEB_APP_ORIGIN = 'https://promptlab.tools';
export const WWW_WEB_APP_ORIGIN = 'https://www.promptlab.tools';
export const LEGACY_LIBRARY_BRIDGE_PATH = '/legacy-library-bridge.html';
// The unsuffixed key belonged to the retired prompt-lab-tawny.vercel.app source
// (removed: S-24 showed its frame recovers nothing in Chrome). It stays exported
// so old checked flags are still recognised; www uses its own suffixed key.
export const LEGACY_LIBRARY_CHECK_KEY = 'pl2-legacy-web-library-checked';
export const LEGACY_LIBRARY_ATTEMPTS_KEY = 'pl2-legacy-web-library-attempts';
// An unreachable www bridge is retried on later loads, up to this many times.
export const MAX_UNREACHABLE_ATTEMPTS = 3;

// S-06: www.promptlab.tools and promptlab.tools are the same site, so a www
// iframe inside the apex app reads www's real (unpartitioned) localStorage.
// That makes www the one source worth merging into a non-empty apex library.
// The cross-site prompt-lab-tawny.vercel.app source was removed: modern
// browsers hand its iframe partitioned storage (S-24), so it recovered nothing.
export const LEGACY_LIBRARY_SOURCES = Object.freeze([
  Object.freeze({
    id: 'www', origin: WWW_WEB_APP_ORIGIN, label: 'www.promptlab.tools',
    checkKey: `${LEGACY_LIBRARY_CHECK_KEY}:www`, attemptsKey: `${LEGACY_LIBRARY_ATTEMPTS_KEY}:www`,
    mergeIntoExisting: true, retryUnreachable: true,
  }),
]);
export const DEFAULT_LEGACY_SOURCE = LEGACY_LIBRARY_SOURCES[0];

export function getLegacyLibrarySource(idOrSource) {
  if (idOrSource && typeof idOrSource === 'object') return idOrSource;
  return LEGACY_LIBRARY_SOURCES.find(source => source.id === idOrSource) || DEFAULT_LEGACY_SOURCE;
}

const REQUEST_TYPE = 'pl2:request-legacy-library';
const RESPONSE_TYPE = 'pl2:legacy-library-payload';

export { getLibraryEntrySignature, mergeLibraryEntries };

export function mergeCollections(existingCollections, incomingCollections) {
  const seen = new Set();
  return [...(Array.isArray(existingCollections) ? existingCollections : []), ...(Array.isArray(incomingCollections) ? incomingCollections : [])]
    .map((item) => ensureString(item).trim())
    .filter((item) => {
      if (!item || seen.has(item)) return false;
      seen.add(item);
      return true;
    });
}

export function isSeedOnlyLibrary(library) {
  const normalizedLibrary = normalizeLibrary(library);
  const normalizedSeeds = normalizeLibrary(DEFAULT_LIBRARY_SEEDS);
  if (normalizedLibrary.length !== normalizedSeeds.length) return false;

  const seedSignatures = new Set(normalizedSeeds.map(getLibraryEntrySignature));
  return normalizedLibrary.every((entry) => seedSignatures.has(getLibraryEntrySignature(entry)));
}

export function shouldAttemptLegacyWebMigration(currentOrigin = '', protocol = '', sourceId = DEFAULT_LEGACY_SOURCE) {
  const source = getLegacyLibrarySource(sourceId);
  if (!/^https?:$/i.test(protocol) || !currentOrigin || currentOrigin === source.origin) {
    return false;
  }
  // Only the apex reads www. www never requests itself, and previews,
  // desktop (tauri.localhost) and other hosts are not framed by www's bridge.
  return source.id === 'www' && currentOrigin === APEX_WEB_APP_ORIGIN && /^https:$/i.test(protocol);
}

export function parseLegacyLibraryPayload(messageData) {
  if (!messageData || messageData.type !== RESPONSE_TYPE) return null;
  return {
    library: Array.isArray(messageData.library) ? messageData.library : [],
    collections: Array.isArray(messageData.collections) ? messageData.collections : [],
    sourceOrigin: ensureString(messageData.sourceOrigin),
  };
}

export function requestLegacyLibraryPayload({ currentOrigin, source: sourceId = DEFAULT_LEGACY_SOURCE, timeoutMs = 2500 } = {}) {
  const source = getLegacyLibrarySource(sourceId);
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.resolve(null);
  }

  if (!shouldAttemptLegacyWebMigration(currentOrigin || window.location.origin, window.location.protocol, source)) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const iframe = document.createElement('iframe');
    let settled = false;

    const cleanup = (result) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', handleMessage);
      window.clearTimeout(timer);
      iframe.remove();
      resolve(result);
    };

    const handleMessage = (event) => {
      if (event.origin !== source.origin || event.source !== iframe.contentWindow) return;
      const payload = parseLegacyLibraryPayload(event.data);
      if (!payload) return;
      cleanup(payload);
    };

    const timer = window.setTimeout(() => cleanup(null), timeoutMs);

    iframe.src = `${source.origin}${LEGACY_LIBRARY_BRIDGE_PATH}`;
    iframe.style.display = 'none';
    iframe.setAttribute('aria-hidden', 'true');
    iframe.addEventListener('load', () => {
      try {
        iframe.contentWindow?.postMessage({ type: REQUEST_TYPE }, source.origin);
      } catch {
        cleanup(null);
      }
    }, { once: true });

    window.addEventListener('message', handleMessage);
    document.body.appendChild(iframe);
  });
}
