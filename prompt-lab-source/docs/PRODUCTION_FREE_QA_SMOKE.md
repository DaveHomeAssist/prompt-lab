# Production Free Account Smoke

`Production Free Account Smoke` is a manually dispatched GitHub Actions workflow that proves the production web app from a signed-in, dedicated Free Clerk account.

## Scope

The smoke creates a fresh Clerk Agent Task session, opens `https://promptlab.tools/app/`, then proves all of the following:

- the account presents as `Free`, never `Owner Pro`
- `/api/billing/license` returns the terminal billing-disabled contract
- the billing modal clearly says purchases are unavailable and disables purchase-management controls
- the Compare route opens without an upgrade modal
- no checkout, portal, Stripe, provider, or telemetry request leaves the browser

The run does not persist a Playwright storage state or invoke checkout, the billing portal, Stripe, a provider, or telemetry. Its short-lived Clerk session is revoked before the workflow finishes.

## One-time setup

1. In the production Clerk instance, create a dedicated Free account for this smoke. Do not add its Clerk user ID to any `PROMPTLAB_*_OWNER_*` allowlist and do not attach billing or customer data.
2. In GitHub environment **Production – prompt-lab**, add these environment secrets:
   - `CLERK_SECRET_KEY`: the production Clerk backend secret
   - `PROMPTLAB_QA_FREE_USER_ID`: the dedicated account's `user_…` ID
3. In GitHub Actions, run **Production Free Account Smoke** with the default target URL.

The secret is never printed, saved to a file, embedded in an artifact, or exposed to the deployed PromptLab application. If either secret is absent, the workflow fails before creating a Clerk Agent Task.

## Operations

Run the workflow after a production deployment or whenever signed-in Free behavior needs proof. A failed run leaves the run red; do not treat deployment, HTTP, or an unauthenticated check as a substitute for this smoke.

To retire access, remove the two environment secrets, revoke the QA user's active Clerk sessions, and delete the dedicated QA account.
