/**
 * Deterministic provider fixture (DHA-12).
 *
 * A local stand-in for a real provider so primary-flow tests can exercise
 * success, failure, cancellation, and boundary responses without a paid API
 * request, a network call, or a credential of any kind.
 *
 * Contract parity: the returned function matches `callModel(payload, options)`
 * from `../api.js` — it takes the same payload, honours the same
 * `{ signal, onChunk }` options, resolves an Anthropic-shaped response body,
 * and rejects with the same error shapes the real transport produces
 * (`AbortError` on cancellation, a plain `Error` otherwise).
 *
 * Determinism: every output is derived from the payload by a stable hash.
 * There is no `Date.now()`, no `Math.random()`, and no wall-clock timing, so
 * the same payload always yields byte-identical output on every machine and
 * in every run. Latency is simulated through an injectable scheduler that
 * defaults to a microtask, which keeps suites fast and free of fake timers.
 */

export const FIXTURE_SCENARIOS = Object.freeze({
  SUCCESS: 'success',
  EMPTY_OUTPUT: 'empty-output',
  MALFORMED_CONTRACT: 'malformed-contract',
  OVERSIZED_OUTPUT: 'oversized-output',
  TRANSIENT_ERROR: 'transient-error',
  FATAL_ERROR: 'fatal-error',
  RATE_LIMITED: 'rate-limited',
  TIMEOUT: 'timeout',
});

const ALL_SCENARIOS = Object.freeze(Object.values(FIXTURE_SCENARIOS));

// Marker a corpus case can embed in its prompt to pin one scenario, so a
// single fixture instance can drive a whole mixed corpus (DHA-11/DHA-13).
const SCENARIO_MARKER = /\[\[fixture:([a-z-]+)\]\]/i;

const OVERSIZED_REPEAT = 400;

function stableHash(value) {
  const text = String(value ?? '');
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash) + text.charCodeAt(index);
    hash >>>= 0;
  }
  return hash;
}

/** Stable, human-readable digest of a payload. Same payload → same digest. */
export function fixtureDigest(payload) {
  return stableHash(JSON.stringify(payload ?? null)).toString(16).padStart(8, '0');
}

function promptTextOf(payload) {
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  return messages
    .map((message) => {
      if (typeof message?.content === 'string') return message.content;
      if (Array.isArray(message?.content)) {
        return message.content.map((block) => block?.text || '').join('');
      }
      return '';
    })
    .join('\n');
}

/**
 * Scenario for a payload: an explicit `payload.fixtureScenario`, then a
 * `[[fixture:name]]` marker in the prompt, then the instance default.
 */
export function resolveFixtureScenario(payload, fallback = FIXTURE_SCENARIOS.SUCCESS) {
  const explicit = String(payload?.fixtureScenario || '').trim().toLowerCase();
  if (ALL_SCENARIOS.includes(explicit)) return explicit;

  const marked = SCENARIO_MARKER.exec(promptTextOf(payload));
  const fromMarker = marked?.[1]?.toLowerCase();
  if (fromMarker && ALL_SCENARIOS.includes(fromMarker)) return fromMarker;

  return ALL_SCENARIOS.includes(fallback) ? fallback : FIXTURE_SCENARIOS.SUCCESS;
}

/** Deterministic enhanced-prompt body for a payload. */
export function fixtureEnhancedText(payload) {
  const digest = fixtureDigest(payload);
  const model = String(payload?.model || 'fixture-model');
  return [
    `Fixture enhanced prompt ${digest}`,
    '',
    'Role: You are a deterministic fixture standing in for a live provider.',
    `Model: ${model}`,
    'Constraints: reproduce this text exactly for this payload.',
  ].join('\n');
}

function anthropicBody(text) {
  return { content: [{ type: 'text', text }] };
}

function abortError() {
  const error = new Error('Request cancelled.');
  error.name = 'AbortError';
  return error;
}

function bodyForScenario(scenario, payload) {
  switch (scenario) {
    case FIXTURE_SCENARIOS.EMPTY_OUTPUT:
      return anthropicBody('');
    case FIXTURE_SCENARIOS.MALFORMED_CONTRACT:
      // Valid transport response carrying an unparseable contract payload —
      // exercises the parser without faking a transport failure.
      return anthropicBody(`{"enhanced": "unterminated ${fixtureDigest(payload)}`);
    case FIXTURE_SCENARIOS.OVERSIZED_OUTPUT:
      return anthropicBody(`${fixtureEnhancedText(payload)}\n${'x'.repeat(OVERSIZED_REPEAT)}`);
    default:
      return anthropicBody(fixtureEnhancedText(payload));
  }
}

function errorForScenario(scenario) {
  switch (scenario) {
    case FIXTURE_SCENARIOS.TRANSIENT_ERROR:
      // Message shaped so isTransientError() classifies it as retryable.
      return new Error('429 rate limit exceeded (fixture transient error)');
    case FIXTURE_SCENARIOS.RATE_LIMITED:
      return new Error('429 Too Many Requests (fixture rate limit)');
    case FIXTURE_SCENARIOS.TIMEOUT: {
      const error = new Error('Fixture provider timed out.');
      error.code = 'EXTERNAL_FETCH_TIMEOUT';
      return error;
    }
    case FIXTURE_SCENARIOS.FATAL_ERROR:
      return new Error('Fixture provider rejected the request.');
    default:
      return null;
  }
}

function splitIntoChunks(text, chunkCount) {
  if (!text) return [];
  const count = Math.max(1, Math.min(chunkCount, text.length));
  const size = Math.ceil(text.length / count);
  const chunks = [];
  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size));
  }
  return chunks;
}

const microtask = () => Promise.resolve();

/**
 * Build a deterministic `callModel`-compatible provider.
 *
 * @param {object}   [options]
 * @param {string}   [options.scenario]  default scenario when the payload pins none
 * @param {number}   [options.chunkCount] stream slices for a successful response
 * @param {Function} [options.scheduler] awaited between steps; defaults to a microtask
 * @returns {(payload: object, options?: {signal?: AbortSignal, onChunk?: Function}) => Promise<object>}
 */
export function createFixtureProvider({
  scenario = FIXTURE_SCENARIOS.SUCCESS,
  chunkCount = 3,
  scheduler = microtask,
} = {}) {
  return async function fixtureCallModel(payload, { signal, onChunk } = {}) {
    if (signal?.aborted) throw abortError();

    const active = resolveFixtureScenario(payload, scenario);
    const failure = errorForScenario(active);
    if (failure) {
      await scheduler();
      if (signal?.aborted) throw abortError();
      throw failure;
    }

    const body = bodyForScenario(active, payload);
    const text = body.content[0].text;

    if (typeof onChunk === 'function' && text) {
      let streamed = '';
      for (const chunk of splitIntoChunks(text, chunkCount)) {
        await scheduler();
        // Cancellation is checked between chunks so an abort mid-stream
        // rejects instead of resolving with a partial body.
        if (signal?.aborted) throw abortError();
        streamed += chunk;
        onChunk(chunk, streamed);
      }
    } else {
      await scheduler();
    }

    if (signal?.aborted) throw abortError();
    return body;
  };
}

/**
 * Opt-in override consulted by the platform adapter. Tests and local harnesses
 * install a fixture here; production never sets it, so the real transport is
 * unchanged.
 */
export const FIXTURE_GLOBAL_KEY = '__PROMPTLAB_PROVIDER_FIXTURE__';

export function installProviderFixture(provider, scope = globalThis) {
  scope[FIXTURE_GLOBAL_KEY] = provider;
  return () => { delete scope[FIXTURE_GLOBAL_KEY]; };
}

export function getInstalledProviderFixture(scope = globalThis) {
  const provider = scope?.[FIXTURE_GLOBAL_KEY];
  return typeof provider === 'function' ? provider : null;
}
