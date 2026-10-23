# Account and billing hardening, October 23, 2026

## Repair scope and acceptance

Dave requested a focused login, paywall, Clerk and Stripe hardening pass.
The repair targets existing account boundaries without changing pricing,
legacy annual subscriptions, offline grace, public API budgets or legal terms.

- Stripe customer discovery must never transfer another Clerk account's binding.
  Either metadata spelling is supported, but all populated bindings must agree.
  Conflicting search results fail closed before email fallback. Existing unbound
  legacy customer linking remains supported; it is not permission to overwrite
  a populated binding.
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

Pending candidate verification, CI, merge, production deployment and signed-in
acceptance. Follow the canonical Issue Backlog security record and implementation
RUN for current evidence; do not infer completion from this repair brief.
