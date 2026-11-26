import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { installHighlightMenus, ENHANCE_MENU_ID, SEND_MENU_ID } from '../../extension/highlight-menus.js';

const enhanceSelection = vi.hoisted(() => vi.fn());

vi.mock('../../extension/highlight-worker.js', () => ({
  enhanceSelection,
}));

function capturedResponse() {
  return { ok: true, kind: 'textarea', text: 'hello world' };
}

describe('highlight context menu', () => {
  let clicked;
  let chromeApi;
  const order = [];

  beforeAll(() => {
    chromeApi = {
      runtime: {
        id: 'extension-under-test',
        lastError: null,
        getURL: (path) => `chrome-extension://extension-under-test/${path}`,
        onMessage: { addListener: vi.fn() },
        onInstalled: { addListener: vi.fn() },
        onStartup: { addListener: vi.fn() },
      },
      contextMenus: {
        create: vi.fn((_item, callback) => callback?.()),
        removeAll: vi.fn((callback) => callback?.()),
        onClicked: { addListener: vi.fn((listener) => { clicked = listener; }) },
      },
      storage: {
        local: {
          get: vi.fn((_keys, callback) => callback?.({})),
        },
        session: {
          set: vi.fn(async (value) => { order.push(['draft', value]); }),
        },
        onChanged: { addListener: vi.fn() },
      },
      scripting: {
        executeScript: vi.fn(async () => {
          order.push('inject');
          return [];
        }),
      },
      tabs: {
        sendMessage: vi.fn((_tabId, message, _options, callback) => {
          order.push(['frame', message.action]);
          callback?.(message.action === 'capture' ? capturedResponse() : { ok: true });
        }),
        create: vi.fn(async (create) => {
          order.push(['tab', create.url]);
          return { id: 9 };
        }),
      },
      sidePanel: {
        open: vi.fn(() => {
          order.push('open');
          return Promise.resolve();
        }),
      },
    };
    globalThis.chrome = chromeApi;
    installHighlightMenus();
  });

  beforeEach(() => {
    order.length = 0;
    enhanceSelection.mockReset();
    chromeApi.sidePanel.open.mockImplementation(() => {
      order.push('open');
      return Promise.resolve();
    });
    chromeApi.storage.session.set.mockClear();
    chromeApi.tabs.create.mockClear();
    chromeApi.scripting.executeScript.mockClear();
  });

  const tab = { id: 4, url: 'https://example.test/compose' };
  const info = { frameId: 0, pageUrl: tab.url };

  it('aborts the in-flight Enhance when the same tab is enhanced again', async () => {
    const signals = [];
    enhanceSelection.mockImplementation((_text, _settings, _generation, signal) => {
      signals.push(signal);
      return new Promise(() => {});
    });

    clicked({ ...info, menuItemId: ENHANCE_MENU_ID }, tab);
    await vi.waitFor(() => expect(enhanceSelection).toHaveBeenCalledTimes(1));
    clicked({ ...info, menuItemId: ENHANCE_MENU_ID }, tab);
    await vi.waitFor(() => expect(enhanceSelection).toHaveBeenCalledTimes(2));

    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
    expect(signals[0]).not.toBe(signals[1]);
  });

  it('opens the side panel inside the click turn, before injection or the draft write', async () => {
    clicked({ ...info, menuItemId: SEND_MENU_ID }, tab);

    expect(order[0]).toBe('open');
    expect(order.indexOf('inject')).toBeGreaterThan(0);
    expect(chromeApi.sidePanel.open).toHaveBeenCalledWith({ tabId: tab.id });
    expect(chromeApi.storage.session.set).not.toHaveBeenCalled();

    await vi.waitFor(() => expect(chromeApi.storage.session.set).toHaveBeenCalled());
    expect(order[0]).toBe('open');
    expect(order).toContain('inject');
    expect(chromeApi.tabs.create).not.toHaveBeenCalled();
    const draft = chromeApi.storage.session.set.mock.calls[0][0]['pl2-highlight-draft'];
    expect(draft.text).toBe('hello world');
  });

  it('opens a panel tab when the side panel open is refused', async () => {
    chromeApi.sidePanel.open.mockImplementation(() => {
      order.push('open');
      return Promise.reject(new Error('gesture consumed'));
    });
    clicked({ ...info, menuItemId: SEND_MENU_ID }, tab);
    expect(order[0]).toBe('open');

    await vi.waitFor(() => expect(chromeApi.tabs.create).toHaveBeenCalledWith({
      url: 'chrome-extension://extension-under-test/panel.html',
    }));
    expect(chromeApi.storage.session.set).toHaveBeenCalled();
    const openAt = order.indexOf('open');
    const draftAt = order.findIndex((entry) => Array.isArray(entry) && entry[0] === 'draft');
    expect(openAt).toBeLessThan(draftAt);
  });
});
