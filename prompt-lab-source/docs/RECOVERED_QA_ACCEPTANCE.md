# Reconciled legacy acceptance scenarios

Reviewed October 26, 2026 against `6ea5f6f`, reconciled at `6a1a2c4`. Sources: the preserved April
interaction inventory, QA matrix and automation backlog. Historical coverage
labels are superseded by this source mapping. This is a focused acceptance list,
not a competing product backlog or a claim that a test has run.

## Current evidence and remaining checks

| Scenario | Current automated source | Remaining user-facing acceptance |
|---|---|---|
| Node responses finish on success and failure | `tests/billing-auth.test.mjs` and recovered `tests/nodeFunctionAdapter.test.mjs` | Post-deployment route/log checks remain separate; no charge-bearing probe is required for this recovery. |
| Golden response threshold separates acceptable variation | `src/tests/goldenThreshold.test.js` | Exercise pin, change threshold, clear, and pin from a historical run through the real Create UI. Logic coverage alone does not close these UI checks. |
| Version restoration preserves the selected prompt and editing identity | `src/__tests__/promptSaveLoad.test.js`, `src/tests/usePersistenceFlow.test.jsx`, `src/tests/LibraryWorkspace.test.jsx` | Exercise selection, diff, confirmation, restore and reload in one browser flow. |
| A/B diff opens, copies and closes | `src/__tests__/ModalA11y.test.jsx` provides modal-level coverage | Verify both-success gating and clipboard content through the full A/B flow. |
| Notebook create and rename work without browser prompt dialogs | `src/__tests__/plbAuditFixes.test.jsx` | Retain installed/platform and human acceptance separately. Do not restore the old window.prompt-based test design. |
| Hosted layout and provider restrictions match the web surface | Hosted specs under `prompt-lab-web/tests/app/` and `src/tests/providerSettings.test.jsx` | Physical touch, actual account and paid-provider acceptance remain outside mocked browser checks. |
| Image pack remains optional and imports cleanly | `src/tests/recoveredContent.test.jsx` uses the actual preset importer | CI browser import through review passes; the production download matches the tested source bytes. Signed-in production import remains unexecuted. |
| Engineering templates retain multiline required inputs | `src/tests/recoveredContent.test.jsx`, `src/tests/TemplateVariablesModal.test.jsx` | Hosted browser cases pass for focus, required inputs, viewport fit, Apply, Skip and preserved original text at desktop and mobile sizes. Signed-in production form use and physical acceptance remain separate. |
| Starter identities and declared counts remain consistent | `src/tests/recoveredContent.test.jsx` | No fixed historical total is retained; new library membership needs deliberate product approval. |

Paths in the automated-source column are relative to `prompt-lab-extension/`,
except `tests/billing-auth.test.mjs` and `tests/nodeFunctionAdapter.test.mjs`,
which are relative to `prompt-lab-source/`.

## Preservation and scope

The old matrix is useful for observable behavior, but its manual-only labels,
platform assumptions, commands and component locations are historical. The old
seed assertions for eight libraries, 74 prompts and an empty Stream Deck library
are not current requirements. No historical shipping claim is promoted to a
current pass. The feedback-to-Notion path remains excluded by decision D-017.

## Recorded verification

Candidate execution and release receipts belong in
[`LEGACY_RECOVERY_BRIEF.md`](LEGACY_RECOVERY_BRIEF.md) and the existing project
progress record. Leave the remaining checks above open until their evidence exists.
