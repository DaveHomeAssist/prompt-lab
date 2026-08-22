import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FIXTURE_SCENARIOS,
  createFixtureProvider,
  fixtureDigest,
  fixtureEnhancedText,
  getInstalledProviderFixture,
  installProviderFixture,
  resolveFixtureScenario,
} from '../lib/providerFixture.js';

// DHA-12: a deterministic provider stand-in for primary-flow tests — no paid
// request, no network, no credential.

function payload(prompt, overrides = {}) {
  return {
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
    ...overrides,
  };
}

afterEach(() => {
  delete globalThis.__PROMPTLAB_PROVIDER_FIXTURE__;
});

describe('determinism', () => {
  it('returns byte-identical output for the same payload', async () => {
    const provider = createFixtureProvider();
    const first = await provider(payload('Draft a release note'));
    const second = await provider(payload('Draft a release note'));

    expect(first).toEqual(second);
    expect(first.content[0].text).toBe(fixtureEnhancedText(payload('Draft a release note')));
  });

  it('separates different payloads and is stable across instances', async () => {
    const a = await createFixtureProvider()(payload('Prompt A'));
    const b = await createFixtureProvider()(payload('Prompt B'));

    expect(a.content[0].text).not.toBe(b.content[0].text);
    expect(fixtureDigest(payload('Prompt A'))).toBe(fixtureDigest(payload('Prompt A')));
    expect(fixtureDigest(payload('Prompt A'))).not.toBe(fixtureDigest(payload('Prompt B')));
  });
});

describe('success responses', () => {
  it('resolves an Anthropic-shaped body and streams the whole text', async () => {
    const provider = createFixtureProvider({ chunkCount: 4 });
    const chunks = [];
    const response = await provider(payload('Stream this'), {
      onChunk: (chunk, fullText) => chunks.push([chunk, fullText]),
    });

    const text = response.content[0].text;
    expect(response.content[0].type).toBe('text');
    expect(chunks.length).toBeGreaterThan(1);
    // Last cumulative value equals the resolved body, and concatenated
    // chunks reconstruct it exactly — no dropped or duplicated slice.
    expect(chunks.at(-1)[1]).toBe(text);
    expect(chunks.map(([chunk]) => chunk).join('')).toBe(text);
  });
});

describe('boundary responses', () => {
  it('returns an empty body for the empty-output scenario', async () => {
    const provider = createFixtureProvider({ scenario: FIXTURE_SCENARIOS.EMPTY_OUTPUT });
    const response = await provider(payload('anything'));
    expect(response.content[0].text).toBe('');
  });

  it('returns transport-valid but unparseable contract text', async () => {
    const provider = createFixtureProvider({ scenario: FIXTURE_SCENARIOS.MALFORMED_CONTRACT });
    const response = await provider(payload('anything'));
    const text = response.content[0].text;

    expect(text).toContain('{"enhanced"');
    expect(() => JSON.parse(text)).toThrow();
  });

  it('returns an oversized body for the oversized scenario', async () => {
    const normal = await createFixtureProvider()(payload('anything'));
    const oversized = await createFixtureProvider({
      scenario: FIXTURE_SCENARIOS.OVERSIZED_OUTPUT,
    })(payload('anything'));

    expect(oversized.content[0].text.length)
      .toBeGreaterThan(normal.content[0].text.length * 2);
  });
});

describe('failure responses', () => {
  it('rejects transient errors so retry logic still engages', async () => {
    const provider = createFixtureProvider({ scenario: FIXTURE_SCENARIOS.TRANSIENT_ERROR });
    await expect(provider(payload('anything'))).rejects.toThrow(/429|rate limit/i);
  });

  it('rejects fatal errors without a retry hint', async () => {
    const provider = createFixtureProvider({ scenario: FIXTURE_SCENARIOS.FATAL_ERROR });
    await expect(provider(payload('anything'))).rejects.toThrow(/rejected the request/i);
  });

  it('marks timeouts with the external-fetch-timeout code', async () => {
    const provider = createFixtureProvider({ scenario: FIXTURE_SCENARIOS.TIMEOUT });
    await expect(provider(payload('anything'))).rejects.toMatchObject({
      code: 'EXTERNAL_FETCH_TIMEOUT',
    });
  });
});

describe('cancellation', () => {
  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = createFixtureProvider();

    await expect(provider(payload('anything'), { signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects mid-stream instead of resolving a partial body', async () => {
    const controller = new AbortController();
    const provider = createFixtureProvider({ chunkCount: 8 });
    const seen = [];

    const pending = provider(payload('Cancel me'), {
      signal: controller.signal,
      onChunk: (chunk) => {
        seen.push(chunk);
        if (seen.length === 2) controller.abort();
      },
    });

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(seen.length).toBe(2);
  });
});

describe('scenario selection', () => {
  it('prefers an explicit payload scenario over the instance default', () => {
    expect(resolveFixtureScenario(
      payload('anything', { fixtureScenario: FIXTURE_SCENARIOS.FATAL_ERROR }),
      FIXTURE_SCENARIOS.SUCCESS,
    )).toBe(FIXTURE_SCENARIOS.FATAL_ERROR);
  });

  it('reads a marker embedded in the prompt so one corpus can mix cases', () => {
    expect(resolveFixtureScenario(payload('check this [[fixture:empty-output]] case')))
      .toBe(FIXTURE_SCENARIOS.EMPTY_OUTPUT);
  });

  it('falls back to the default for an unknown scenario', () => {
    expect(resolveFixtureScenario(payload('x', { fixtureScenario: 'not-a-scenario' })))
      .toBe(FIXTURE_SCENARIOS.SUCCESS);
  });
});

describe('installation hook', () => {
  it('installs and removes the fixture without leaking state', () => {
    expect(getInstalledProviderFixture()).toBeNull();

    const provider = createFixtureProvider();
    const uninstall = installProviderFixture(provider);
    expect(getInstalledProviderFixture()).toBe(provider);

    uninstall();
    expect(getInstalledProviderFixture()).toBeNull();
  });

  it('ignores a non-function value', () => {
    globalThis.__PROMPTLAB_PROVIDER_FIXTURE__ = 'not-callable';
    expect(getInstalledProviderFixture()).toBeNull();
  });
});

describe('platform routing', () => {
  it('consults the installed fixture on every call rather than caching one', async () => {
    vi.resetModules();
    const { callModel } = await import('../lib/platform.js');

    const first = vi.fn(async () => ({ content: [{ type: 'text', text: 'first fixture' }] }));
    const second = vi.fn(async () => ({ content: [{ type: 'text', text: 'second fixture' }] }));

    installProviderFixture(first);
    expect((await callModel(payload('routed'))).content[0].text).toBe('first fixture');

    // Swapping the fixture mid-suite must take effect immediately; if the
    // adapter had captured the override at module load, `first` would run again.
    installProviderFixture(second);
    expect((await callModel(payload('routed'))).content[0].text).toBe('second fixture');

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });
});
