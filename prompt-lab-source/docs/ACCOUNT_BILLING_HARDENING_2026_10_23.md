# Account and billing hardening, October 23, 2026

## Repair scope and acceptance

Dave requested a focused login, paywall, Clerk and Stripe hardening pass.
The repair targets existing account boundaries without changing pricing,
legacy annual subscriptions, offline grace, public API budgets or legal terms.

- Stripe customer discovery must never transfer another Clerk account's binding.
  Either metadata spelling is supported, but all populated bindings must agree.
  Conflicting search results fail closed before email fallback. Existing unbound
  legacy customer linking remains supported; it is not permission to overwrite
  a populated binding. Email discovery requires a verified Clerk profile email
  or an explicitly verified signed email claim. Unverified addresses and custom
  public metadata email fields cannot claim a legacy customer.
- A hosted account must not inherit another account's cached Pro or owner state,
  including old caches without an account ID. Same-account caches retain the
  documented offline policy. Local desktop/dev owner activation is unchanged.
- Requests spanning account changes or app unmount must not restore stale
  entitlements, apply stale errors, or open a previous account's Stripe session.
- Custom JWT verification must reject an explicitly untrusted authorized party.
  SDK verification must honor configured issuer and audience constraints.
- Invalid, altered or out-of-window webhook signatures must cause no persistence
  or Stripe requests.

## Verification contract

Regression tests exercise actual route handlers, signed RSA tokens, Stripe
request boundaries and the shared React hook. The new tests reproduced six
server and four client failures on the original application source. Existing
API, shared-app, build and hosted browser checks remain required. Production
acceptance uses the existing isolated QA Clerk account, Free feature gates,
unpaid Checkout quotes and portal creation. No payment is submitted and no
customer subscription is changed by production checks.

These repairs do not establish a complete penetration test. Local workflow
features still use a client entitlement cache; this is not a server security
boundary against a user modifying their own browser. Server billing identity
and provider quotas must continue to be independently verified. Do not alter
the documented prelaunch policy that opens local features when purchases are
unavailable as an incidental security fix.

## Delivery record

PR200 merged as `3d1437b` after all 16 candidate checks passed. Exact production
`dpl_9snwb9keLDf6nXWnDVKudM4UfX4R` is READY on promptlab.tools. Candidate CI
passed 141 API, 1255 shared, 231 legacy, 25 landing browser and 47 hosted browser
cases (one credential-dependent skip), plus all six native matrix jobs.

Stripe test-mode run 39938236867 passed 13 lifecycle checks, monthly purchased
browser transitions/reload, real signed webhook delivery and stale replay, with
fixture and Clerk-session cleanup. Annual paid lifecycle coverage is API-only.
Production billing run 39940016974 passed: Free account, stable customer, portal,
USD9/month and USD79/year hosted Checkout quotes. Both owned quotes were expired;
independent GET readbacks confirmed unpaid status and no subscription. All 13
live negative authentication/origin/method/signature checks passed. A complete
read-only audit found 34 bound Stripe customers and zero conflicting aliases.
Production Free-account run39940019584 passed nine cases with five opt-in
scenarios skipped, including session revocation.

A final compatibility check found that pinned `@clerk/backend` 3.8.4 does not
expose the issuer option documented by newer versions. The SDK follow-up applies
configured claim validation directly to the SDK's verified payload. A regression
using the actual pinned SDK reproduces acceptance of a wrong configured issuer
on PR200's source and rejects it with the follow-up. Valid-token and wrong-audience cases pass too. PR202 merged as `e264e3b` after
all eight checks passed, including API144/shared1255/legacy231/landing25/hosted47.
Exact production `dpl_4SJs6mK7fv6uXWLJ8Do1b831yrDh` is READY on promptlab.tools.
Final SDK production billing run39942179675 passed authenticated license,
portal, both hosted quotes and Free state after reload; both new quotes were
expired and independently read back unpaid without subscriptions. All thirteen
negative production checks passed again. The core Free-account browser source
is unchanged across the SDK follow-up; its nine-case production acceptance is
retained. Repeated core-main native run39939912598 passed all six jobs.

The security issue is Done and the implementation RUN was read back. The complete
58-row dashboard snapshot retains the original 14 plan identities. See the
[structured evidence](evidence/ACCOUNT_BILLING_HARDENING_2026_10_23.json) for run IDs,
cleanup, source parity and verification limits.

Follow the canonical Issue Backlog security record and implementation RUN for
subsequent release evidence. Existing offline, refund and webhook arrival-log
policies remain unchanged.
