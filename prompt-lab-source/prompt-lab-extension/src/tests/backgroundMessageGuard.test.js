import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const EXTENSION_ID = 'extension-under-test';

describe('background message sender guard', () => {
  const realChrome = globalThis.chrome;
  let onMessage;
  let storageGet;
  let tabsQuery;

  beforeAll(async () => {
    onMessage = undefined;
    storageGet = vi.fn(async () => ({ provider: 'anthropic' }));
    tabsQuery = vi.fn(async () => [{ id: 1, url: 'https://example.test/' }]);
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('content-script messages must not reach the network');
    }));
    globalThis.chrome = {
      runtime: {
        id: EXTENSION_ID,
        onMessage: { addListener: vi.fn((listener) => { onMessage = listener; }) },
        lastError: null,
      },
      storage: { local: { get: storageGet } },
      tabs: { query: tabsQuery },
      sidePanel: { setPanelBehavior: vi.fn().mockResolvedValue(undefined) },
    };
    await import('../../extension/background.js');
  });

  afterAll(() => {
    globalThis.chrome = realChrome;
    vi.unstubAllGlobals();
  });

  const contentSender = {
    id: EXTENSION_ID,
    tab: { id: 7 },
    url: 'https://example.test/page',
  };
  const extensionSender = {
    id: EXTENSION_ID,
    url: `chrome-extension://${EXTENSION_ID}/panel.html`,
  };
  const sidePanelSender = {
    id: EXTENSION_ID,
    tab: { id: 7 },
    url: `chrome-extension://${EXTENSION_ID}/panel.html`,
  };

  function send(message, sender) {
    let responded = false;
    let response;
    const keep = onMessage(message, sender, (value) => {
      responded = true;
      response = value;
    });
    return { keep, responded: () => responded, response: () => response };
  }

  it.each([
    ['MODEL_REQUEST', { type: 'MODEL_REQUEST', payload: { provider: 'anthropic' } }],
    ['OLLAMA_LIST_MODELS', { type: 'OLLAMA_LIST_MODELS', baseUrl: 'http://127.0.0.1:9' }],
    ['CAPTURE_CONTEXT', { type: 'CAPTURE_CONTEXT' }],
    ['GET_PROVIDER_SETTINGS', { type: 'GET_PROVIDER_SETTINGS' }],
    ['MODEL_ABORT', { type: 'MODEL_ABORT', requestId: 'from-page' }],
  ])('ignores %s from a content script', async (_label, message) => {
    storageGet.mockClear();
    tabsQuery.mockClear();
    const result = send(message, contentSender);
    await Promise.resolve();
    expect(result.keep).toBeUndefined();
    expect(result.responded()).toBe(false);
    expect(storageGet).not.toHaveBeenCalled();
    expect(tabsQuery).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('ignores privileged messages from another extension id', async () => {
    storageGet.mockClear();
    const result = send({ type: 'GET_PROVIDER_SETTINGS' }, { id: 'other-extension' });
    await Promise.resolve();
    expect(result.keep).toBeUndefined();
    expect(result.responded()).toBe(false);
    expect(storageGet).not.toHaveBeenCalled();
  });

  it('still answers provider settings from an extension page', async () => {
    const result = await new Promise((resolve) => {
      const keep = onMessage({ type: 'GET_PROVIDER_SETTINGS' }, extensionSender, resolve);
      expect(keep).toBe(true);
    });
    expect(result).toEqual(expect.objectContaining({ providers: expect.any(Array) }));
  });

  it('still answers provider settings from a side panel associated with a tab', async () => {
    const result = await new Promise((resolve) => {
      const keep = onMessage({ type: 'GET_PROVIDER_SETTINGS' }, sidePanelSender, resolve);
      expect(keep).toBe(true);
    });
    expect(result.providers).toEqual(expect.any(Array));
  });

  it('does not claim highlight control messages, so the menu listener can answer them', () => {
    for (const type of ['PL_HIGHLIGHT_CANCEL', 'HIGHLIGHT_STATUS']) {
      const result = send({ type }, contentSender);
      expect(result.keep).toBeUndefined();
      expect(result.responded()).toBe(false);
    }
  });
});
