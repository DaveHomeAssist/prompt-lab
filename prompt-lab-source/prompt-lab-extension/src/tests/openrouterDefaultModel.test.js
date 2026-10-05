import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as extensionRegistry from '../../extension/lib/providerRegistry.js';
import { callProvider as callExtensionProvider } from '../../extension/lib/providers.js';
import { callModelDirect, getConfiguredProvidersDirect, loadSettings } from '../lib/desktopApi.js';
import * as srcRegistry from '../lib/providerRegistry.js';
import { callProvider as callSrcProvider } from '../lib/providers.js';

// OpenRouter only accepts slugs from its published model list. The previous
// default, a dated Sonnet 4 slug, is not on it, so a first run with the model
// field left at its default failed.
const NEW_DEFAULT = 'anthropic/claude-sonnet-4.6';

// Pinned on purpose. This is the exact string earlier builds pre-filled and
// saved, so a find-and-replace of the "stale" ID would quietly turn the
// migration into a no-op. Every other test refers to it through the registry.
const RETIRED_DEFAULT = 'anthropic/claude-sonnet-4-20250514';

const SETTINGS_KEY = 'pl2-provider-settings';
const REQUEST = { messages: [{ role: 'user', content: 'hello' }] };

const okResponse = () => ({
  ok: true,
  json: async () => ({ choices: [{ message: { content: 'hi' } }] }),
});
const sentModel = (fetchImpl) => JSON.parse(fetchImpl.mock.calls[0][1].body).model;

const RUNTIMES = [
  ['extension registry', extensionRegistry],
  ['src registry', srcRegistry],
];

describe('OpenRouter default model', () => {
  it.each(RUNTIMES)('%s defaults to a slug OpenRouter lists', (_name, registry) => {
    expect(registry.DEFAULTS.openrouterModel).toBe(NEW_DEFAULT);
  });

  it('src descriptor and DEFAULTS agree', () => {
    expect(srcRegistry.getProvider('openrouter').defaultModel).toBe(srcRegistry.DEFAULTS.openrouterModel);
  });

  it('extension adapter sends the default when no model is saved', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());

    const result = await callExtensionProvider({
      provider: 'openrouter',
      payload: REQUEST,
      settings: { openrouterApiKey: 'sk-or-test' },
      fetchImpl,
    });

    expect(sentModel(fetchImpl)).toBe(NEW_DEFAULT);
    expect(result.model).toBe(NEW_DEFAULT);
  });

  it('src adapter sends the default when no model is saved', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());

    const result = await callSrcProvider({
      provider: 'openrouter',
      payload: REQUEST,
      settings: { openrouterApiKey: 'sk-or-test' },
      fetchImpl,
    });

    expect(sentModel(fetchImpl)).toBe(NEW_DEFAULT);
    expect(result.model).toBe(NEW_DEFAULT);
  });
});

describe.each(RUNTIMES)('%s migrateLegacyDefaults', (_name, registry) => {
  const { LEGACY_OPENROUTER_MODEL, migrateLegacyDefaults } = registry;

  it('pins the exact string earlier builds saved', () => {
    expect(LEGACY_OPENROUTER_MODEL).toBe(RETIRED_DEFAULT);
  });

  it('replaces a stored value that exactly equals the retired default', () => {
    const stored = {
      provider: 'openrouter',
      openrouterApiKey: 'sk-or-test',
      openrouterModel: LEGACY_OPENROUTER_MODEL,
      openaiModel: 'gpt-4o',
    };

    expect(migrateLegacyDefaults(stored)).toEqual({ ...stored, openrouterModel: NEW_DEFAULT });
  });

  it('does not mutate its input', () => {
    const stored = Object.freeze({ openrouterModel: LEGACY_OPENROUTER_MODEL });

    expect(migrateLegacyDefaults(stored)).not.toBe(stored);
    expect(stored.openrouterModel).toBe(LEGACY_OPENROUTER_MODEL);
  });

  it.each([
    ['a custom model', 'openai/gpt-4o'],
    ['a different Sonnet slug', 'anthropic/claude-sonnet-4'],
    ['the retired slug in other casing', RETIRED_DEFAULT.toUpperCase()],
    ['the retired slug with surrounding whitespace', ` ${RETIRED_DEFAULT} `],
    ['a longer slug that starts with the retired one', `${RETIRED_DEFAULT}:beta`],
    ['an empty string', ''],
  ])('leaves %s as saved', (_label, model) => {
    const stored = { openrouterModel: model };

    expect(migrateLegacyDefaults(stored)).toBe(stored);
  });

  it('only touches the OpenRouter model', () => {
    const stored = { anthropicModel: LEGACY_OPENROUTER_MODEL, ollamaModel: LEGACY_OPENROUTER_MODEL };

    expect(migrateLegacyDefaults(stored)).toBe(stored);
  });

  it.each([undefined, null, 'text', 42])('passes non-object input through unchanged: %s', (value) => {
    expect(migrateLegacyDefaults(value)).toBe(value);
  });
});

// The worker is where the extension actually calls OpenRouter, so this is the
// path an existing user's saved value has to be replaced on.
describe('extension background worker', () => {
  const realChrome = globalThis.chrome;
  let onMessage;
  let stored;

  beforeAll(async () => {
    globalThis.chrome = {
      sidePanel: { setPanelBehavior: vi.fn().mockResolvedValue(undefined) },
      runtime: { onMessage: { addListener: vi.fn((listener) => { onMessage = listener; }) } },
      storage: { local: { get: vi.fn(async () => stored) } },
    };
    await import('../../extension/background.js');
  });

  afterAll(() => {
    globalThis.chrome = realChrome;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const send = (message) => new Promise((resolve) => { onMessage(message, {}, resolve); });

  it('lists the retired default as the current default', async () => {
    stored = {
      provider: 'openrouter',
      openrouterApiKey: 'sk-or-test',
      openrouterModel: extensionRegistry.LEGACY_OPENROUTER_MODEL,
    };

    const response = await send({ type: 'GET_PROVIDER_SETTINGS' });

    expect(response.providers).toContainEqual({ provider: 'openrouter', model: NEW_DEFAULT });
  });

  it('sends the current default for a saved retired default', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchImpl);
    stored = {
      provider: 'openrouter',
      openrouterApiKey: 'sk-or-test',
      openrouterModel: extensionRegistry.LEGACY_OPENROUTER_MODEL,
    };

    const response = await send({ type: 'MODEL_REQUEST', payload: REQUEST, requestId: 'req-legacy' });

    expect(sentModel(fetchImpl)).toBe(NEW_DEFAULT);
    expect(response.data.model).toBe(NEW_DEFAULT);
  });

  it('sends a model the user chose unchanged', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchImpl);
    stored = { provider: 'openrouter', openrouterApiKey: 'sk-or-test', openrouterModel: 'openai/gpt-4o' };

    await send({ type: 'MODEL_REQUEST', payload: REQUEST, requestId: 'req-custom' });

    expect(sentModel(fetchImpl)).toBe('openai/gpt-4o');
  });
});

describe('desktop settings loader', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function store(settings) {
    const raw = JSON.stringify(settings);
    localStorage.setItem(SETTINGS_KEY, raw);
    return raw;
  }

  it('loads the retired default as the current default without rewriting storage', async () => {
    const raw = store({
      provider: 'openrouter',
      openrouterApiKey: 'sk-or-test',
      openrouterModel: srcRegistry.LEGACY_OPENROUTER_MODEL,
    });

    expect(loadSettings().openrouterModel).toBe(NEW_DEFAULT);
    await expect(getConfiguredProvidersDirect()).resolves.toContainEqual({
      provider: 'openrouter',
      model: NEW_DEFAULT,
    });
    // The stored value is only replaced when the user next saves.
    expect(localStorage.getItem(SETTINGS_KEY)).toBe(raw);
  });

  it('keeps a model the user chose', async () => {
    store({ provider: 'openrouter', openrouterApiKey: 'sk-or-test', openrouterModel: 'openai/gpt-4o' });

    expect(loadSettings().openrouterModel).toBe('openai/gpt-4o');
    await expect(getConfiguredProvidersDirect()).resolves.toContainEqual({
      provider: 'openrouter',
      model: 'openai/gpt-4o',
    });
  });

  it('sends the current default for a saved retired default', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchImpl);
    store({
      provider: 'openrouter',
      openrouterApiKey: 'sk-or-test',
      openrouterModel: srcRegistry.LEGACY_OPENROUTER_MODEL,
    });

    const result = await callModelDirect(REQUEST);

    expect(sentModel(fetchImpl)).toBe(NEW_DEFAULT);
    expect(result.model).toBe(NEW_DEFAULT);
  });

  it('sends a model the user chose unchanged', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchImpl);
    store({ provider: 'openrouter', openrouterApiKey: 'sk-or-test', openrouterModel: 'openai/gpt-4o' });

    await callModelDirect(REQUEST);

    expect(sentModel(fetchImpl)).toBe('openai/gpt-4o');
  });
});
