# April 2026 response completion incident

Historical postmortem recovered October 26, 2026. Source: the preserved June
branch at `66b02e1`, incident record dated April 29. Original account identifiers,
support correspondence, financial amounts, and deployment identifiers are omitted.
This document records a historical cause, not current production configuration.

## Failure and impact

The incident record attributes unexpected hosting usage to billing functions that
returned Web `Response` objects without completing Vercel's Node `ServerResponse`.
Even a quick disabled or error result could leave the invocation running until
the runtime timeout. The documented timeout evidence implicated license and
checkout routes. The same response pattern affected the webhook, but the record
did not establish it as the source of the observed spend.

## Lesson retained

Business logic tests that call a handler with a Web `Request` cannot alone prove
that a Node deployment writes headers, status and body and calls `response.end()`.
Verify the actual host adapter as well as the business response.

The current implementation is [`nodeHandler.js`](../api/_lib/nodeHandler.js).
The current billing suite already has Node license and portal tests. The recovered
[`nodeFunctionAdapter.test.mjs`](../tests/nodeFunctionAdapter.test.mjs) adds explicit
exactly-once completion, status/header/binary forwarding, error completion, Web
caller compatibility and disabled checkout/license/portal/webhook coverage.

## Historical containment versus current policy

The original response included an adapter, bounded function durations and disabled
cost-bearing features. Those historical settings are not restored here. Current
configuration and tests own today's limits and enabled features. In particular,
disabled client billing endpoints use a terminal response while the webhook must
retain its retryable failure behavior. Tests must assert each route's current
contract rather than copying historical status codes.

## Verification boundary

Regression fixtures make no provider, Stripe, Clerk or Notion requests. Passing
them establishes local Node response behavior. CI, deployment records, real route
termination, runtime logs and spending observations remain distinct evidence.
