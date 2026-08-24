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
import { extractTextFromAnthropic, parseEnhancedPayload } from '../promptUtils.js';

// Comfortably longer than any normal fixture body, without pinning the exact
// padding length the fixture uses.
const OVERSIZED_MIN_LENGTH = 300;

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

describe('primary enhance flow contract', () => {
  // The enhance path builds its payload with responseFormat: 'json' and feeds
  // the response straight into parseEnhancedPayload. Before this was handled,
  // installing the fixture made every nominal enhance fail with "Model
  // response was not valid JSON" before reaching the success UI.
  const jsonPayload = (prompt) => payload(prompt, { responseFormat: 'json' });

  it('returns a body the real parser accepts', async () => {
    const provider = createFixtureProvider();
    const body = await provider(jsonPayload('Draft a release note'));
    const text = extractTextFromAnthropic(body);

    const parsed = parseEnhancedPayload(text);
    expect(parsed.enhanced.trim()).not.toBe('');
    expect(parsed.variants.length).toBeGreaterThan(0);
    expect(parsed.variants[0]).toHaveProperty('label');
    expect(parsed.variants[0]).toHaveProperty('content');
  });

  it('keeps the contract deterministic', async () => {
    const provider = createFixtureProvider();
    const first = parseEnhancedPayload(extractTextFromAnthropic(
      await provider(jsonPayload('Same prompt')),
    ));
    const second = parseEnhancedPayload(extractTextFromAnthropic(
      await provider(jsonPayload('Same prompt')),
    ));
    expect(first).toEqual(second);
  });

  it('still returns prose when the payload does not request JSON', async () => {
    const provider = createFixtureProvider();
    const body = await provider(payload('No JSON requested'));
    const text = extractTextFromAnthropic(body);

    expect(text).toBe(fixtureEnhancedText(payload('No JSON requested')));
    expect(() => JSON.parse(text)).toThrow();
  });

  it('keeps the oversized case parseable so it fails on length, not syntax', async () => {
    const provider = createFixtureProvider({ scenario: FIXTURE_SCENARIOS.OVERSIZED_OUTPUT });
    const body = await provider(jsonPayload('anything'));

    const parsed = parseEnhancedPayload(extractTextFromAnthropic(body));
    expect(parsed.enhanced.length).toBeGreaterThan(OVERSIZED_MIN_LENGTH);
  });

  it('keeps malformed-contract unparseable even when JSON is requested', async () => {
    const provider = createFixtureProvider({ scenario: FIXTURE_SCENARIOS.MALFORMED_CONTRACT });
    const body = await provider(jsonPayload('anything'));

    expect(() => parseEnhancedPayload(extractTextFromAnthropic(body))).toThrow();
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

// Gaps found in review: the rate-limited scenario was advertised and had its
// own error branch but no test, install/cleanup could clobber a newer fixture,
// and an unusable chunkCount silently produced no stream.
describe('review gaps', () => {
  afterEach(() => {
    delete globalThis.__PROMPTLAB_PROVIDER_FIXTURE__;
  });

  it('rejects the rate-limited scenario with a retryable 429', async () => {
    const provider = createFixtureProvider({ scenario: FIXTURE_SCENARIOS.RATE_LIMITED });
    await expect(provider({ prompt: 'anything' })).rejects.toThrow(/429/i);
    await expect(provider({ prompt: 'anything' })).rejects.toThrow(/rate limit/i);
  });

  it('rejects every advertised failure scenario', async () => {
    // Guards the inventory itself: adding a failure scenario without a branch
    // in errorForScenario would resolve here instead of rejecting.
    const failing = [
      FIXTURE_SCENARIOS.TRANSIENT_ERROR,
      FIXTURE_SCENARIOS.FATAL_ERROR,
      FIXTURE_SCENARIOS.RATE_LIMITED,
      FIXTURE_SCENARIOS.TIMEOUT,
    ];
    for (const scenario of failing) {
      const provider = createFixtureProvider({ scenario });
      await expect(provider({ prompt: 'x' }), scenario).rejects.toBeInstanceOf(Error);
    }
  });

  it('does not let a stale cleanup remove a newer fixture', async () => {
    const first = createFixtureProvider({ scenario: FIXTURE_SCENARIOS.SUCCESS });
    const second = createFixtureProvider({ scenario: FIXTURE_SCENARIOS.FATAL_ERROR });

    const cleanupFirst = installProviderFixture(first);
    installProviderFixture(second);
    cleanupFirst();

    // Previously this deleted `second` and every later call fell through to the
    // real transport — the exact outcome a fixture exists to prevent.
    expect(getInstalledProviderFixture()).toBe(second);
  });

  it('restores the previous fixture when cleaning up the current one', () => {
    const first = createFixtureProvider({ scenario: FIXTURE_SCENARIOS.SUCCESS });
    const second = createFixtureProvider({ scenario: FIXTURE_SCENARIOS.FATAL_ERROR });

    installProviderFixture(first);
    const cleanupSecond = installProviderFixture(second);
    cleanupSecond();

    expect(getInstalledProviderFixture()).toBe(first);
  });

  it('removes the key entirely when nothing was installed before', () => {
    const only = createFixtureProvider({ scenario: FIXTURE_SCENARIOS.SUCCESS });
    const cleanup = installProviderFixture(only);
    cleanup();

    expect(getInstalledProviderFixture()).toBeNull();
    expect('__PROMPTLAB_PROVIDER_FIXTURE__' in globalThis).toBe(false);
  });

  it('still streams the whole body when chunkCount is unusable', async () => {
    // NaN previously made the chunk size NaN, so the loop pushed one empty
    // slice and stopped: onChunk fired once with '' and the stream was lost.
    for (const chunkCount of [NaN, 0, -5, 'three', undefined]) {
      const provider = createFixtureProvider({
        scenario: FIXTURE_SCENARIOS.SUCCESS,
        chunkCount,
      });
      const seen = [];
      const response = await provider(
        { prompt: 'stream this please' },
        { onChunk: (chunk) => seen.push(chunk) },
      );

      const text = extractTextFromAnthropic(response);
      expect(text.length, `chunkCount=${String(chunkCount)}`).toBeGreaterThan(0);
      expect(seen.join(''), `chunkCount=${String(chunkCount)}`).toBe(text);
      expect(seen.every((chunk) => chunk !== '')).toBe(true);
    }
  });
});
