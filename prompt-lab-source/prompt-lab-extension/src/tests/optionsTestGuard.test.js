import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULTS,
  PROVIDER_SETTINGS_KEYS,
  VALID_PROVIDERS,
} from '../../extension/lib/providerRegistry.js';

// DHA-10 / PLB-014: the Options "Test" button sends a real MODEL_REQUEST through
// the background worker. Before the guard it had no in-flight protection, so
// every rapid click scheduled another delayed testConnection and each one
// reached the provider — one billed duplicate per click.
//
// `options.js` is a plain script whose `./lib/providerRegistry.js` import only
// resolves after `scripts/assemble.js` copies `extension/lib` alongside it, so
// it cannot be imported directly from the source tree. The real source is
// loaded here with that single import line replaced by the same constants the
// assembled bundle would supply — everything else executes verbatim, including
// the guard under test.
//
// Audit M-3: the test must exercise the copy `scripts/assemble.js` actually
// ships, which prefers `extension/options.js` over `public/options.js`. Resolve
// with the same precedence so drift between the two copies cannot leave an
// unguarded file in the built extension while this test stays green.
const OPTIONS_CANDIDATES = [
  resolve(__dirname, '../../extension/options.js'),
  resolve(__dirname, '../../public/options.js'),
];
const OPTIONS_PATH = OPTIONS_CANDIDATES.find((candidate) => existsSync(candidate));
const OPTIONS_SOURCE = readFileSync(OPTIONS_PATH, 'utf8')
  .replace(/^import\s+\{[^}]*\}\s+from\s+'\.\/lib\/providerRegistry\.js';\s*$/m, '');

const ELEMENT_IDS = [
  'anthropicSection', 'openaiSection', 'geminiSection', 'openrouterSection', 'ollamaSection',
  'anthropicKey', 'anthropicModel',
  'openaiKey', 'openaiModel',
  'geminiKey', 'geminiModel',
  'openrouterKey', 'openrouterModel',
  'ollamaBaseUrl', 'ollamaModel', 'ollamaModelManual', 'ollamaRefreshBtn', 'ollamaStatus',
  'saveBtn', 'testBtn', 'status',
];

let sendMessage;

function loadOptionsScript() {
  document.body.innerHTML = ELEMENT_IDS
    .map((id) => (id.endsWith('Btn')
      ? `<button id="${id}"></button>`
      : `<input id="${id}" value="" />`))
    .join('');

  // eslint-disable-next-line no-new-func
  const run = new Function(
    'DEFAULTS', 'PROVIDER_SETTINGS_KEYS', 'VALID_PROVIDERS', 'document', 'chrome',
    OPTIONS_SOURCE,
  );
  run(DEFAULTS, PROVIDER_SETTINGS_KEYS, VALID_PROVIDERS, document, globalThis.chrome);
}

beforeEach(() => {
  vi.useFakeTimers();

  sendMessage = vi.fn((_message, callback) => {
    // Answer asynchronously, the way the real background worker does.
    setTimeout(() => callback({ data: { content: [{ text: 'ok' }] } }), 50);
  });

  globalThis.chrome = {
    runtime: { sendMessage, lastError: null },
    storage: {
      local: {
        get: vi.fn((_keys, callback) => callback({})),
        set: vi.fn((_next, callback) => callback && callback()),
      },
    },
  };

  loadOptionsScript();
});

afterEach(() => {
  vi.useRealTimers();
  delete globalThis.chrome;
});

function modelRequestCount() {
  return sendMessage.mock.calls.filter(([message]) => message?.type === 'MODEL_REQUEST').length;
}

describe('options Test button dispatch guard', () => {
  it('sends one provider request for a burst of rapid activations', async () => {
    const testBtn = document.getElementById('testBtn');

    testBtn.click();
    testBtn.click();
    testBtn.click();

    // Drain the save-then-test delay and the simulated worker round trip.
    await vi.advanceTimersByTimeAsync(400);

    expect(modelRequestCount()).toBe(1);
  });

  it('re-enables the button so a later test still dispatches', async () => {
    const testBtn = document.getElementById('testBtn');

    testBtn.click();
    expect(testBtn.disabled).toBe(true);

    await vi.advanceTimersByTimeAsync(400);
    expect(testBtn.disabled).toBe(false);
    expect(modelRequestCount()).toBe(1);

    testBtn.click();
    await vi.advanceTimersByTimeAsync(400);

    expect(modelRequestCount()).toBe(2);
  });
});
