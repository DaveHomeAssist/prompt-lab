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

## Execution and delivery evidence

- Candidate: `54318d1205686ffe85c43d3632b8e5efd96b4751`.
- [PR227](https://github.com/DaveHomeAssist/prompt-lab/pull/227) merged as `6a1a2c43e09b5368a0e0bf067682dbe88f9d5957` after all 17 checks passed. Candidate and merge trees are identical.
- [Landing CI](https://github.com/DaveHomeAssist/prompt-lab/actions/runs/40329941110), GitHub Linux runners, Node 22: 157 API tests, 1,337 frontend tests across 116 files plus 231 Node tests, 44 static landing tests, 25 tooling tests, four package audits, 25 landing browser tests and 56 hosted app browser tests pass. One existing authenticated browser scenario is skipped.
- [Desktop Build](https://github.com/DaveHomeAssist/prompt-lab/actions/runs/40329941027): macOS, Windows and Linux builds plus automated MSI, NSIS, DEB and AppImage acceptance pass. This does not establish physical or human acceptance.
- Production deployment `dpl_5rwhFpULVZL4Xvf17PSQ5cHUtBCw` is READY at the exact merge. Both [image](https://promptlab.tools/packs/image-generation.json) and [engineering](https://promptlab.tools/packs/prompt-engineering.json) JSON downloads match source bytes. The live [guide](https://promptlab.tools/guide.html) contains both download links and the contrast fix.
- Browser recovery cases pass at 1440 by 900 and 375 by 812: required multiline values fill the enhanced result, original source remains unchanged, Skip preserves unresolved text, and the image pack imports through review.
- Signed-in production form use, paid-provider calls and human or physical device acceptance were not performed. Broader checks in the reconciled QA map remain open.
- Earlier transfer-metadata, guide-contrast, CI dependency-download and original-field assertion failures remain in their logs; each was diagnosed before the final passing candidate.

The first focused checks ran on Dominic under Node 22. Sustained verification
moved to the existing GitHub workflows after Dominic reported a discharging
battery; Walter and Duncan were unreachable. No heavy Mac fallback was used.
