# Prompt Lab Vercel Billing Refund Request

Prepared April 28, 2026, 8:43 PM EDT.

Support case opened: `#01138635`.

Historical status: this request text was prepared while the project was paused. The later safe production recovery is documented in `docs/incidents/prompt-lab-vercel-billing-incident-2026-04-29.md`.

## Support Message

Subject: Request billing adjustment for Prompt Lab Fluid Compute timeout spike

Hello Vercel Support,

I am requesting a billing adjustment or credit for unintended usage on the Vercel team `daves-projects-7059ba1c`, project `prompt-lab`, project ID `prj_kynCeAMcASaNBIBMRHVJb7sozDfN`.

The April 2026 invoice shows USD 106.0024 due for the team from April 1 through April 29. The Vercel billing charges API attributes USD 92.2484 directly to `prompt-lab`.

The charged usage was not from user growth or normal customer traffic. It came from a faulty billing endpoint deployment that allowed serverless functions to run until the Vercel runtime timeout at 300 seconds. Production logs show repeated `Vercel Runtime Timeout Error: Task timed out after 300 seconds` on `/api/billing/license`, plus one `/api/billing/checkout` timeout, during the April 22 billing day. That aligns with the largest charge lines, especially Fluid Provisioned Memory and Fluid Active CPU.

The project has no revenue and no meaningful user load. The spend came from unintended timeout behavior in billing validation code. I have paused the project and disabled Fluid Compute at the project level to prevent further spend.

Please review and reverse or credit the unintended Prompt Lab usage charges, especially the Fluid Compute and Observability charges tagged to `prompt-lab`.

Evidence:

Project: `prompt-lab`

Project ID: `prj_kynCeAMcASaNBIBMRHVJb7sozDfN`

Team ID: `team_82xqHfW2To3Axsom8yTxRmj2`

Production domain: `promptlab.tools`

Latest production deployment: `dpl_EfDW1EtxxMTfowaWa6azhgKBjJgi`

Latest production commit: `b61f254ca1d7e1953bebe2987a69e0f4ec1e2d93`

Current project state: paused

Current Fluid Compute state: disabled

Current default function timeout: 10 seconds

Billing API period checked: `2026-04-01T00:00:00.000Z` through `2026-04-30T00:00:00.000Z`

Prompt Lab billed total in API tags: USD 92.2484

Prompt Lab service breakdown:

Fluid Provisioned Memory: USD 71.1145

Observability Events: USD 12.8826

Fluid Active CPU: USD 7.4971

Function Invocations: USD 0.5999

Fast Origin Transfer: USD 0.0785

Build Minutes: USD 0.0528

Edge Requests additional CPU duration: USD 0.0162

Build CPU Minutes: USD 0.0069

Prompt Lab date breakdown:

April 21, 2026: USD 8.3653

April 22, 2026: USD 71.3449

April 23, 2026: USD 0.0001

April 24, 2026: USD 0.0536

April 25, 2026: USD 0.0020

April 26, 2026: USD 1.8241

April 27, 2026: USD 10.6584

Runtime log evidence:

`2026-04-22T08:48:15.750Z`, `/api/billing/license`, status `504`, deployment `dpl_3VRvjHvgj1Upqxs7q4B5J2Kon2bZ`, message `Vercel Runtime Timeout Error: Task timed out after 300 seconds`

`2026-04-22T13:03:36.252Z`, `/api/billing/checkout`, status `504`, deployment `dpl_wUj8pHb86hiGv3fJs5qNi8DVbGuP`, message `Vercel Runtime Timeout Error: Task timed out after 300 seconds`

Current containment proof:

`curl -I https://promptlab.tools` returns status `503` with `x-vercel-error: DEPLOYMENT_PAUSED`.

Vercel project API reports `paused: true`, `resourceConfig.fluid: false`, `functionDefaultTimeout: 10`, and `elasticConcurrencyEnabled: false`.

## Internal Notes

Do not unpause this project until the billing endpoints are intentionally re enabled and tested with live logs.

Do not report Prompt Lab billing as fixed unless the final report includes current billing usage, project paused state, deployed commit, dirty tree state, and live runtime logs.
