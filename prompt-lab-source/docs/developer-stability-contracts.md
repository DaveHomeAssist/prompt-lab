# Prompt Lab Developer Stability Contracts

Status: active
Owner: Dave
Last updated: 2026-06-28

This note records the production-readiness contracts that must stay stable while
Prompt Lab remains a local-first React/Vite app.

## Starter seed contract

Source file:
`prompt-lab-extension/src/data/promptlab-seed-libraries.json`

Automated guard:
`prompt-lab-extension/src/tests/seedData.integrity.test.js`

Required state:

- 8 loadable starter libraries.
- 74 total starter prompts.
- Prompt IDs are unique across all starter prompts.
- Each `prompt_count` equals the actual prompt array length.
- `lib_stream_deck` is present as the reserved Stream Deck library.
- Stream Deck is intentionally empty with `prompt_count: 0` and `prompts: []`.
- Empty starter libraries are not shown in the starter-pack UI.

Starter content changes require updating the seed test in the same patch. Removed
or experimental starter content belongs in a non-starter prompt pack until Dave
approves it as first-run content.

## Local storage contract

Prompt Lab preserves the existing `pl2-*` keys. Stability fixes may add backup
keys for corrupt JSON, but must not migrate or rename user-facing keys without a
separate migration plan and tests.

Critical corrupted keys are backed up before fallback data is loaded:

- `pl2-library`
- `pl2-collections`

Backup keys use this pattern:
`<original-key>:corrupt-backup:<timestamp>`

## Stability gate

Run before merging production-readiness or library-system changes:

```sh
npm run test:stability --prefix prompt-lab-extension
```

From `prompt-lab-source/`, the equivalent command is:

```sh
npm run test:stability
```

The gate covers seed integrity, starter-pack dedupe, library hook behavior,
storage recovery, LibraryPanel behavior, and the Vite extension build.

## Vercel preview cost strategy

Git preview builds are treated as manual and cost-sensitive. Do not use branch
pushes as routine preview deployment triggers until Dave explicitly changes this
policy.

Allowed preview path:

1. Run `npm run test:stability`.
2. Review `vercel.json` and public `api/` routes for compute surfaces.
3. Confirm API routes remain capped at `maxDuration: 10`.
4. Confirm hosted billing, provider proxy, shared hosted provider key,
   telemetry persistence, and webhook behavior remain disabled unless they are
   the intended release surface.
5. Use `npm run deploy:preview` only when a preview URL is necessary.

Production deployment still requires the separate Vercel cost guard workflow and
live verification before any fixed, safe, or contained claim.
