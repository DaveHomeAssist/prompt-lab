# Deterministic Provider Fixture

A local stand-in for a real provider, so primary-flow tests can exercise
success, failure, cancellation, and boundary responses without a paid API
request, a network call, or a credential of any kind.

Source: `src/lib/providerFixture.js`. Tests: `src/tests/providerFixture.test.js`.

## Why it exists

Primary-flow coverage previously had no way to drive the enhance path end to
end without either mocking `callModel` per test file or spending a real
provider call. The fixture gives every shell one shared, reproducible
implementation to point at.

## Contract parity

The value returned by `createFixtureProvider()` matches `callModel(payload,
options)` from `src/api.js`:

- same payload shape
- same `{ signal, onChunk }` options
- resolves an Anthropic-shaped body — `{ content: [{ type: 'text', text }] }`
- rejects with the same error shapes as the real transport: an `AbortError`
  on cancellation, a plain `Error` otherwise

## Determinism

Output is derived from the payload by a stable hash. There is no `Date.now()`,
no `Math.random()`, and no wall-clock timing, so the same payload yields
byte-identical output on every machine and in every run.

Simulated latency goes through an injectable `scheduler` that defaults to a
microtask, so suites stay fast and need no fake timers.

## Scenarios

| Scenario | Behaviour |
| --- | --- |
| `success` | Streams the enhanced text, then resolves it |
| `empty-output` | Resolves an empty body |
| `malformed-contract` | Valid transport response carrying unparseable contract JSON |
| `oversized-output` | Resolves a body well past the normal length |
| `transient-error` | Rejects with a 429-shaped message so retry logic engages |
| `rate-limited` | Rejects with a rate-limit message |
| `timeout` | Rejects with `code: 'EXTERNAL_FETCH_TIMEOUT'` |
| `fatal-error` | Rejects without a retry hint |

Scenario resolution order, highest first:

1. `payload.fixtureScenario`
2. a `[[fixture:name]]` marker inside the prompt text
3. the instance default passed to `createFixtureProvider()`

The marker lets one fixture instance drive a whole mixed corpus, which is what
the prompt-quality corpus and Golden Response threshold work need.

## Selecting it

Install the fixture on the global override key; the platform adapter consults
that key on every call.

```js
import {
  createFixtureProvider,
  installProviderFixture,
} from './src/lib/providerFixture.js';

const uninstall = installProviderFixture(createFixtureProvider());
// ... exercise the flow ...
uninstall();
```

Because the adapter reads the key per call rather than at module load, a suite
can swap or remove the fixture between cases.

Nothing sets this key in production code. When it is absent, `callModel` routes
to the real extension or desktop transport unchanged.

## No secrets

The fixture reads no environment variable, no stored key, and no settings
object, and it performs no network I/O. There is nothing to leak and nothing to
configure per environment, which is what makes it CI-compatible: it behaves
identically on a developer machine and on a hosted runner with no secrets
available.

## Running the tests

```bash
cd prompt-lab-source/prompt-lab-extension
npm test                                     # whole suite
npx vitest run src/tests/providerFixture.test.js   # fixture only
```

The fixture suite is part of the default `npm test` run and therefore of the
`extension-tests` CI job. It requires no additional setup.
