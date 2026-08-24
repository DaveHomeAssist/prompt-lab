import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Review finding: the fixture streamed on every surface, but the real
// extension transport never does — `extCallModel` destructures only `signal`
// and sends one MODEL_REQUEST, while `desktopCallModel` forwards `onChunk` to
// `callProvider`. Left alone, an extension primary-flow test could assert
// incremental output production never emits. `platform.js` now shapes the
// options it hands the fixture to match the surface it is standing in for.

const FIXTURE_KEY = '__PROMPTLAB_PROVIDER_FIXTURE__';

/**
 * Load platform.js with `chrome` present or absent, since IS_EXTENSION is
 * computed once at module load.
 */
async function loadPlatform({ asExtension }) {
  vi.resetModules();
  if (asExtension) {
    globalThis.chrome = { runtime: { sendMessage: () => {}, lastError: null } };
  } else {
    delete globalThis.chrome;
  }
  return import('../lib/platform.js');
}

describe('platform routes options to the fixture per surface', () => {
  const originalChrome = globalThis.chrome;

  beforeEach(() => {
    delete globalThis[FIXTURE_KEY];
  });

  afterEach(() => {
    delete globalThis[FIXTURE_KEY];
    if (originalChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = originalChrome;
    vi.resetModules();
  });

  it('drops onChunk on the extension surface, matching extCallModel', async () => {
    const { callModel } = await loadPlatform({ asExtension: true });
    const seen = [];
    globalThis[FIXTURE_KEY] = (payload, options) => {
      seen.push(options);
      return Promise.resolve({ content: [{ type: 'text', text: 'ok' }] });
    };

    const onChunk = vi.fn();
    const controller = new AbortController();
    await callModel({ prompt: 'x' }, { signal: controller.signal, onChunk });

    expect(seen).toHaveLength(1);
    expect(seen[0]).not.toHaveProperty('onChunk');
    // The signal must survive — cancellation still has to work.
    expect(seen[0].signal).toBe(controller.signal);
    expect(onChunk).not.toHaveBeenCalled();
  });

  it('forwards onChunk on the desktop surface, matching desktopCallModel', async () => {
    const { callModel } = await loadPlatform({ asExtension: false });
    const seen = [];
    globalThis[FIXTURE_KEY] = (payload, options) => {
      seen.push(options);
      options?.onChunk?.('chunk', 'chunk');
      return Promise.resolve({ content: [{ type: 'text', text: 'ok' }] });
    };

    const onChunk = vi.fn();
    await callModel({ prompt: 'x' }, { onChunk });

    expect(seen).toHaveLength(1);
    expect(seen[0].onChunk).toBe(onChunk);
    expect(onChunk).toHaveBeenCalledWith('chunk', 'chunk');
  });

  it('passes options through untouched when no onChunk is supplied', async () => {
    const { callModel } = await loadPlatform({ asExtension: true });
    const seen = [];
    globalThis[FIXTURE_KEY] = (payload, options) => {
      seen.push(options);
      return Promise.resolve({ content: [{ type: 'text', text: 'ok' }] });
    };

    const options = { signal: new AbortController().signal };
    await callModel({ prompt: 'x' }, options);

    expect(seen[0]).toBe(options);
  });

  it('reaches the fixture at all only while one is installed', async () => {
    const { callModel } = await loadPlatform({ asExtension: true });
    const fixture = vi.fn(() => Promise.resolve({ content: [{ type: 'text', text: 'ok' }] }));

    globalThis[FIXTURE_KEY] = fixture;
    await callModel({ prompt: 'x' }, {});
    expect(fixture).toHaveBeenCalledTimes(1);

    // With the fixture removed the call routes to the real transport instead.
    // chrome.runtime.sendMessage is stubbed to never reply, so the promise
    // simply stays pending — what matters is that the fixture is not consulted.
    delete globalThis[FIXTURE_KEY];
    void callModel({ prompt: 'x' }, {});
    expect(fixture).toHaveBeenCalledTimes(1);
  });
});
