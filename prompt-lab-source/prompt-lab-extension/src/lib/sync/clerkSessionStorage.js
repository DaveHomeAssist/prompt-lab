// Where the Clerk Chrome extension SDK keeps its client token. The SDK default
// is chrome.storage.local, which persists on disk and which content scripts
// of this extension can read. We pass chrome.storage.session instead: memory
// only, cleared when the browser closes, and by default readable only from
// trusted extension pages (access level TRUSTED_CONTEXTS), not content
// scripts. With Sync Host the token is re-read from the promptlab.tools
// cookie on every load, so nothing is lost by not persisting it.
// Without chrome.storage.session (very old Chrome) it falls back to memory,
// never to chrome.storage.local.
const createKey = (...keys) => keys.filter(Boolean).join('|');

export function createClerkSessionStorageCache(area = globalThis.chrome?.storage?.session) {
  if (area && typeof area.get === 'function') {
    try {
      // Explicit, in case a future change widens it: content scripts stay out.
      area.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' })?.catch?.(() => {});
    } catch { /* not supported: the default is already TRUSTED_CONTEXTS */ }
    return {
      kind: 'session',
      createKey,
      get: async (key) => (await area.get(key))?.[key] ?? undefined,
      set: async (key, value) => { await area.set({ [key]: value }); },
      remove: async (key) => { await area.remove(key); },
    };
  }
  const memory = new Map();
  return {
    kind: 'memory',
    createKey,
    get: async (key) => memory.get(key),
    set: async (key, value) => { memory.set(key, value); },
    remove: async (key) => { memory.delete(key); },
  };
}
