import { DEFAULT_LIBRARY_SEEDS } from '../constants.js';
import { normalizeLibrary } from './promptSchema.js';
import { getLibraryEntrySignature, mergeLibraryEntries } from './libraryMatching.js';
import { ensureString } from './utils.js';

export const LEGACY_WEB_APP_ORIGIN = 'https://prompt-lab-tawny.vercel.app';
export const LEGACY_LIBRARY_BRIDGE_PATH = '/legacy-library-bridge.html';
export const LEGACY_LIBRARY_CHECK_KEY = 'pl2-legacy-web-library-checked';

const REQUEST_TYPE = 'pl2:request-legacy-library';
const RESPONSE_TYPE = 'pl2:legacy-library-payload';
const LOCAL_PREVIEW_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);

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

export function shouldAttemptLegacyWebMigration(currentOrigin = '', protocol = '') {
  if (!/^https?:$/i.test(protocol) || !currentOrigin || currentOrigin === LEGACY_WEB_APP_ORIGIN) {
    return false;
  }

  try {
    const hostname = new URL(currentOrigin).hostname;
    return !LOCAL_PREVIEW_HOSTNAMES.has(hostname);
  } catch {
    return false;
  }
}

export function parseLegacyLibraryPayload(messageData) {
  if (!messageData || messageData.type !== RESPONSE_TYPE) return null;
  return {
    library: Array.isArray(messageData.library) ? messageData.library : [],
    collections: Array.isArray(messageData.collections) ? messageData.collections : [],
    sourceOrigin: ensureString(messageData.sourceOrigin),
  };
}

export function requestLegacyLibraryPayload({ currentOrigin, timeoutMs = 2500 } = {}) {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.resolve(null);
  }

  if (!shouldAttemptLegacyWebMigration(currentOrigin || window.location.origin, window.location.protocol)) {
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
      if (event.origin !== LEGACY_WEB_APP_ORIGIN) return;
      const payload = parseLegacyLibraryPayload(event.data);
      if (!payload) return;
      cleanup(payload);
    };

    const timer = window.setTimeout(() => cleanup(null), timeoutMs);

    iframe.src = `${LEGACY_WEB_APP_ORIGIN}${LEGACY_LIBRARY_BRIDGE_PATH}`;
    iframe.style.display = 'none';
    iframe.setAttribute('aria-hidden', 'true');
    iframe.addEventListener('load', () => {
      try {
        iframe.contentWindow?.postMessage({ type: REQUEST_TYPE }, LEGACY_WEB_APP_ORIGIN);
      } catch {
        cleanup(null);
      }
    }, { once: true });

    window.addEventListener('message', handleMessage);
    document.body.appendChild(iframe);
  });
}
