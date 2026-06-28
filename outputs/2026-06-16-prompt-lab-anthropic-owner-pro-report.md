# Prompt Lab Anthropic 404 + Owner Pro Entitlement

## Overall Summary

One workstream was handled: Prompt Lab shared web, desktop, and extension source.
The live screenshot failure was traced to Anthropic model retirement: `claude-sonnet-4-20250514` retired on 2026-06-15, and Prompt Lab still emitted that model in several paths.
Local source now defaults to `claude-sonnet-4-6`, remaps stale saved and proxy model values, and keeps extension packaged lib copies aligned.
Prompt Lab owner Pro access now has a server side Clerk-authenticated allowlist path for owner email or owner Clerk user ID.
Local verification passed across route tests, targeted React/provider tests, direct provider checks, dependency repair, and all three shell build smoke checks.
Production is not updated yet because the local Vercel CLI has no credentials and no `VERCEL_TOKEN` is available.

## Discussion Points

- The user reported a hosted Prompt Lab recovery error: `anthropic request failed (404)`.
- Official Anthropic docs show `claude-sonnet-4-20250514` retired on 2026-06-15 and recommend `claude-sonnet-4-6`.
- Prompt Lab shared source, hosted web proxy, extension packaged lib, A/B test path, and enhancement defaults all had stale model references.
- The user also asked for permanent Prompt Lab Pro access for their GitHub and Gmail accounts.
- Existing billing routes require Clerk authentication and Stripe subscription lookup.
- A server side owner entitlement was added behind Clerk identity, keyed by `PROMPTLAB_PRO_OWNER_EMAILS` or `PROMPTLAB_PRO_OWNER_CLERK_USER_IDS`.
- Notion orbit pages found: Prompt Lab roadmap, Pro entitlement contract, hosted Vercel Pro note, and prior Vercel proxy fix.

## Decisions

- Adopt `claude-sonnet-4-6` as the Prompt Lab Anthropic default.
- Preserve stale saved settings compatibility by aliasing `claude-sonnet-4-20250514` to `claude-sonnet-4-6`.
- Preserve stale hosted proxy env compatibility by normalizing `HOSTED_ALLOWED_ANTHROPIC_MODELS`.
- Implement permanent owner Pro as a server side authenticated entitlement, not editable browser local storage.
- Use env allowlists instead of hardcoding GitHub or Gmail identifiers in source.
- Leave production deployment and Vercel env update pending because the local CLI is not authenticated.

## Action Items

- Priority: High
  Owner: Dave
  Project/workstream: PromptLab
  Next action: authenticate Vercel or provide `VERCEL_TOKEN`, then set `PROMPTLAB_PRO_OWNER_EMAILS` to the Gmail/primary GitHub email and optionally set `PROMPTLAB_PRO_OWNER_CLERK_USER_IDS` for any separate GitHub Clerk identity.
  Validation: `vercel env ls` shows the owner env vars for production.
  Human review: yes

- Priority: High
  Owner: Dave
  Project/workstream: PromptLab
  Next action: deploy the updated Prompt Lab source to production after env setup.
  Validation: `promptlab.tools/app/` no longer returns Anthropic 404 and provider request bodies use `claude-sonnet-4-6`.
  Human review: yes

- Priority: Medium
  Owner: Dave
  Project/workstream: PromptLab
  Next action: sign in with both Gmail and GitHub auth paths and verify Pro state.
  Validation: Billing panel shows Prompt Lab Pro active and gated features are available.
  Human review: no

- Priority: Medium
  Owner: Dave
  Project/workstream: PromptLab
  Next action: inspect whether GitHub auth exposes the same primary email as Gmail; if not, copy the Clerk user ID into `PROMPTLAB_PRO_OWNER_CLERK_USER_IDS`.
  Validation: `/api/billing/license` returns `entitlement: "owner"` for both accounts.
  Human review: no

## Deliverables

- Modified `prompt-lab-source/prompt-lab-extension/src/lib/providerRegistry.js`.
- Modified `prompt-lab-source/prompt-lab-extension/src/lib/desktopApi.js`.
- Modified `prompt-lab-source/prompt-lab-extension/src/DesktopSettingsModal.jsx`.
- Modified `prompt-lab-source/prompt-lab-extension/src/constants.js`.
- Modified `prompt-lab-source/prompt-lab-extension/src/hooks/useABTest.js`.
- Modified `prompt-lab-source/prompt-lab-extension/extension/lib/providerRegistry.js`.
- Modified `prompt-lab-source/prompt-lab-extension/extension/lib/providers.js`.
- Modified `prompt-lab-source/api/proxy.js`.
- Modified `prompt-lab-source/api/billing/license.js`.
- Modified `prompt-lab-source/prompt-lab-web/README.md`.
- Updated tests in provider, hosted settings, streaming, run emitter, useABTest, useExecutionFlow, proxy, and Stripe billing coverage.
- Repaired shell dependencies with `npm run deps:repair --prefix prompt-lab-source`.

## Project-by-Project Status

### PromptLab

Accomplishments:
- Replaced retired Anthropic default with `claude-sonnet-4-6`.
- Added stale model normalization for shared source, hosted settings, hosted proxy, and packaged extension lib.
- Added owner Pro entitlement path behind Clerk auth and env allowlists.
- Added regression tests for stale model remapping and owner entitlement.
- Repaired iCloud duplicate `node_modules` paths across extension, web, and desktop shells.

Current progress:
- Local code and builds are green.
- Production is not deployed.
- Vercel env is not set from this shell because Vercel CLI credentials are missing.

Recommended next steps:
- Set production owner Pro env vars.
- Deploy to production.
- Verify live hosted recovery flow and Pro state under both auth paths.

## Summary Table

| Project | Accomplished | Remaining / Risks | Priority Next Step | Validation |
|---|---|---|---|---|
| PromptLab | Anthropic model retirement fixed locally; owner Pro entitlement added; tests/builds pass | Production still has old deployment until Vercel env/deploy is done | Set owner env vars and deploy | Live app uses `claude-sonnet-4-6`; billing returns owner Pro |

## Verification

- `node --test prompt-lab-source/tests/proxy.test.mjs prompt-lab-source/tests/stripeBilling.test.mjs prompt-lab-source/tests/clerkBillingAuth.test.mjs` passed 25 tests.
- `npm test --prefix prompt-lab-source/prompt-lab-extension -- src/__tests__/providers.test.js src/tests/providers.streaming.test.js src/tests/providerSettings.test.jsx src/__tests__/useABTest.test.jsx src/tests/useExecutionFlow.test.jsx src/tests/runEmitter.test.js` passed 36 tests.
- Direct Node provider normalization check passed.
- `npm run build:smoke --prefix prompt-lab-source` passed extension, web, and desktop builds after dependency repair.
- `vercel env ls` failed with no local Vercel credentials.

## Related Notion Orbit

- Prompt Lab roadmap: https://app.notion.com/p/341255fc8f448048adfdf1c25e1de580
- Pro entitlement contract: https://app.notion.com/p/34f255fc8f4481708139fcad6c1de39a
- Hosted Vercel Pro note: https://app.notion.com/p/34a255fc8f44817ea255d66d74c14342
- Prior Vercel proxy fix: https://app.notion.com/p/334255fc8f4481dfa069e80ee90aa309

## Chat Title

```text
🔧🧾 | Prompt Lab 404 and Owner Pro Fix
```
