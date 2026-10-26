# Legacy recovery scope

Approved: October 26, 2026, direct instruction to execute the reviewed recoveries.

## Outcome

Recover useful tests, optional prompt content, input definitions, and engineering
lessons from the preserved June branch without merging its obsolete runtime.

## Included

- Extend Node response completion coverage around the current adapter and billing routes.
- Publish a curated 34-prompt image pack as an optional JSON download, using the existing import flow.
- Improve the 12 existing prompt engineering starter records with required multiline template inputs. Keep their identities, library membership, and other metadata.
- Carry input definitions through starter loading. Existing saved user records remain unchanged.
- Provide a separate engineering JSON download so existing users can explicitly review replacements through Library Import.
- Preserve the April response-completion lesson as a sanitized historical postmortem.
- Reconcile selected QA scenarios into a current acceptance matrix, with unexecuted checks explicit.
- Add structural seed integrity checks without freezing obsolete library counts.

## Flow and boundaries

Users choose whether to download and import the image pack. It does not install
itself or enlarge the default starter list. Loading the prompt engineering starter
library uses the current variable dialog; required values must be supplied before
Apply. Existing library entries are never rewritten by a seed update.

The archive remains untouched. Prompt Explorer, Script Agent, and Thread Namer
remain separate product proposals. The old pack store, feedback service, billing
helpers, build scripts, and dashboards are excluded. No new dependency, provider
request, billing configuration, storage key, or automatic migration is required.

## Acceptance

1. Node adapter tests fail if the response is not completed, including disabled billing, errors, and ordinary responses.
2. The image pack validates and imports through the existing importer with unique stable IDs and clear titles.
3. All 12 prompt engineering starter records declare every manual token, retain metadata on load, and expose required multiline inputs.
4. Starter IDs and counts remain consistent; no existing user record changes automatically.
5. Documentation distinguishes historical facts, current source evidence, executed checks, and remaining runtime acceptance.
6. Required repository checks, remote push, PR checks, merge, and applicable deployment evidence are recorded separately.
