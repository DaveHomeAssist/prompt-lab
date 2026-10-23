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
The broader production Free-account smoke is still running at this snapshot.

A final compatibility check found that pinned `@clerk/backend` 3.8.4 does not
expose the issuer option documented by newer versions. The SDK follow-up applies
configured claim validation directly to the SDK's verified payload. A regression
using the actual pinned SDK reproduces acceptance of a wrong configured issuer
on PR200's source and rejects it with the follow-up. Valid issuer and audience
negative coverage pass too. Follow-up API validation and release are pending.

Follow the canonical Issue Backlog security record and implementation RUN for
subsequent release evidence. Existing offline, refund and webhook arrival-log
policies remain unchanged.
