import '@testing-library/jest-dom/vitest';

// Provide a working localStorage for jsdom if the built-in is broken
if (typeof globalThis.localStorage === 'undefined' || typeof globalThis.localStorage.setItem !== 'function') {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => store.has(key) ? store.get(key) : null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
    get length() { return store.size; },
    key: (index) => [...store.keys()][index] ?? null,
  };
}

// Stub chrome.storage.session and chrome.runtime for jsdom
globalThis.chrome = {
  storage: {
    session: {
      get: (_key, cb) => cb({}),
      set: () => {},
    },
    local: {
      get: (_key, cb) => cb({}),
      set: () => {},
    },
  },
  runtime: {
    sendMessage: () => Promise.resolve({}),
    openOptionsPage: () => {},
  },
  sidePanel: {
    setPanelBehavior: () => Promise.resolve(),
  },
};
