1. PROJECT SUMMARY

Objective
- Move Prompt Lab from emergency billing containment to a safe, authenticated, monitored billing state without allowing the Vercel spend incident to recur.

Key outcomes
- Preserve the current production containment on `promptlab.tools` until hard thresholds prove the incident is over.
- Enforce account only billing for hosted `license`, `checkout`, and `portal` routes with verified Clerk identity required before billing compute begins.
- Add route level controls so billing safety does not depend on the Vercel firewall alone.
- Commit and preserve the already deployed billing hardening so production, tests, and git history stay aligned.
- Reopen billing only after a monitored stability soak window passes with no anomalies.
- Document the root cause, failure chain, kill switch, and permanent guardrails.

Assumptions
- Primary project in scope is Prompt Lab.
- Current production alias `promptlab.tools` points to deployment `dpl_64oQZRjBuz2S12BLAx5aMRwr8SYy`.
- A Vercel firewall deny rule is active for `/api/billing/license`, and public probes currently fail before runtime.
- Billing route and client hardening are deployed, tested locally, and still uncommitted in the main Prompt Lab worktree.
- Clerk remains the required hosted billing identity layer, and Stripe remains the billing provider.
- One operator can execute platform, code, deploy, and verification work without a separate infra team.
- Baseline metrics will be gathered from the most recent quiet production window after containment.

2. PHASED IMPLEMENTATION PLAN

Phase Name
- Phase 1. Containment Validation

Goal
- Confirm the production incident has stopped at the platform level before any change is made to billing access or edge controls.

Key Milestones
- Verify `promptlab.tools` still resolves to deployment `dpl_64oQZRjBuz2S12BLAx5aMRwr8SYy`.
- Confirm recent Vercel logs for `/api/billing/license` remain empty and no new `300 second` timeouts appear.
- Capture a 24 hour metric baseline for `license`, `checkout`, and `portal` covering invocations, average duration, P95 duration, active CPU, and provisioned memory.
- Confirm the firewall rule scope, active state, and exact public request behavior for billing routes.
- Record a formal containment decision using the go or no go thresholds below.

Dependencies
- Access to Vercel project `prompt-lab`
- Production deployment already live
- Existing firewall rule active

Required Resources
- Vercel Observability
- Vercel CLI
- Production URL access
- Dave as operator

Estimated Timeline
- 0.5 to 1 working day

Owner / Responsible Party
- Dave, with Codex support

Risks / Failure Points
- Quiet logs may hide delayed queue drain or retries outside the observation window.
- Edge denials can mask a still broken runtime path.
- Baseline values can be misleading if measured during a still settling period.

Phase Name
- Phase 2. Root Cause and Traffic Attribution

Goal
- Determine the exact trigger, amplification path, and failed protections behind the incident so the permanent fix addresses the real source.

Key Milestones
- Pull route level request patterns for `/api/billing/license`, including deployment correlation, request spikes, and any available source data.
- Determine whether the flood originated from hosted Prompt Lab clients, stale sessions, bots, or third party callers.
- Audit the shared billing client and all billing entry points for polling, retry loops, silent revalidation, and unsigned fetch paths.
- Map which billing routes require hosted web access, which should stay account only, and which should remain unavailable to unsigned callers.
- Produce a root cause record that includes all four required elements:
- Exact trigger
- Amplification mechanism
- Why protections failed
- Why the issue was not detected earlier

Dependencies
- Phase 1 containment still holding
- Access to production logs, codebase, and deployed route behavior

Required Resources
- Vercel logs and metrics
- Prompt Lab codebase
- Clerk auth flow knowledge
- Stripe billing flow knowledge

Estimated Timeline
- 0.5 to 1.5 working days

Owner / Responsible Party
- Dave, with Codex support

Risks / Failure Points
- Observability may not expose enough caller detail.
- More than one traffic source may have contributed.
- The original traffic source may go quiet after the edge block, leaving attribution partial.

Phase Name
- Phase 3. Control Layer Hardening

Goal
- Add system enforced billing controls so failure is cheap, fast, and bounded even if edge protection is removed or weakened.

Key Milestones
- Enforce auth before compute on hosted billing routes so identity validation runs before any Stripe or billing lookup work.
- Add server side rate limiting on all hosted billing routes, not only `license`, using the policy defined below.
- Enforce a hard upstream timeout cap of less than 10 seconds on Clerk, Stripe, and storage calls.
- Add structured route logging with action, auth state, duration, response code, and timeout markers.
- Add an environment based kill switch such as `BILLING_ENABLED=false` that makes hosted billing routes return `503` immediately.
- Add a circuit breaker that temporarily disables a route and requires manual re enable if timeout or latency thresholds are breached.

Dependencies
- Phase 2 root cause direction confirmed
- Billing routes already isolated in code

Required Resources
- Git
- Node test environment
- Vercel deploy workflow
- Clerk and Stripe route knowledge

Estimated Timeline
- 1 to 2 working days

Owner / Responsible Party
- Dave, with Codex support

Risks / Failure Points
- Control logic can drift between environments if feature flags are not documented.
- Rate limiting can block legitimate traffic if thresholds are set without baseline data.
- Logging can be too sparse to debug or too noisy to use if not standardized.

Phase Name
- Phase 4. Code Preservation and Release Alignment

Goal
- Make the deployed billing contract durable in source control and keep code, tests, and production behavior aligned.

Key Milestones
- Review and commit the current local Prompt Lab billing hardening changes on a dedicated incident branch.
- Ensure all three hosted billing routes require verified Clerk identity and do not accept public customer identifiers.
- Keep regression tests for signed in success paths, unsigned failure paths, timeout behavior, and client side no fetch behavior without a Clerk token.
- Add or update operator docs to reflect account only billing and the new kill switch behavior.
- Deploy a clean preview build from the committed incident branch.
- Add or update client constraints so billing refresh behavior, retry behavior, and caching follow the safety contract.

Dependencies
- Phase 3 control layer implemented
- Local repo state reviewed so unrelated changes are not accidentally included

Required Resources
- Git
- Node test environment
- Preview deployment workflow
- Prompt Lab docs

Estimated Timeline
- 0.5 to 1 working day

Owner / Responsible Party
- Dave, with Codex support

Risks / Failure Points
- Uncommitted unrelated repo changes can pollute the incident branch.
- Preview behavior can differ from production if env flags or auth settings are inconsistent.
- Tests can pass while deployment protection still changes route behavior.

Phase Name
- Phase 5. Stability Soak

Goal
- Prove the hardened system stays stable under real conditions before any billing route is reopened to production traffic.

Key Milestones
- Run a 24 to 48 hour soak window with the current containment still in place.
- Monitor all hosted billing routes for unexpected invocations, elevated duration, timeouts, and memory growth.
- Confirm there is no unexplained billing traffic during the soak window.
- Record pass or fail against the formal thresholds below.
- Do not proceed unless the soak exit criteria are fully met.

Dependencies
- Phase 4 preview deployment complete
- Production monitoring configured

Required Resources
- Vercel Observability
- Alerting destination such as email or Slack
- Dave as operator

Estimated Timeline
- 1 to 2 working days

Owner / Responsible Party
- Dave, with Codex support

Risks / Failure Points
- A short soak window may miss periodic or delayed callers.
- Unknown traffic can remain hidden if only one route is monitored.
- Teams can be tempted to reopen early if pressure is high.

Phase Name
- Phase 6. Controlled Billing Reopen

Goal
- Restore billing functionality in narrow stages, with hard rollback rules and no public anonymous access.

Key Milestones
- Reopen only signed in `checkout` and `portal` first, leaving `license` blocked unless it is required and verified safe.
- Run signed in end to end browser smoke tests against preview, then production, using a real Prompt Lab account.
- Narrow the firewall rule only after signed in traffic is proven and all thresholds remain green.
- Recheck metrics after each reopen step before proceeding to the next step.
- Execute the kill switch immediately if any rollback trigger fires.
- Keep hosted `license` disabled by default unless a documented product requirement and load proof justify enabling it.

Dependencies
- Phase 5 soak passed
- Verified signed in test account available
- Kill switch verified in non production

Required Resources
- Vercel production and preview deployments
- Clerk signed in account
- Stripe testable billing account or safe production account
- Browser verification

Estimated Timeline
- 1 to 2 working days

Owner / Responsible Party
- Dave, with Codex support

Risks / Failure Points
- Removing the edge block too early can restart the spend path.
- Signed in flows may still fail if route auth and client auth are not fully aligned.
- One route can look healthy while another route still has a latent timeout path.

Phase Name
- Phase 7. Post Incident Guardrails and Closeout

Goal
- Lock in durable detection, response, and documentation so the same billing failure class is caught early and shut down quickly.

Key Milestones
- Add real time alerts for billing route duration spikes, invocation spikes, timeout count, and memory anomalies.
- Document the incident timeline, root cause, controls added, kill switch, and rollback steps in Prompt Lab docs.
- Update Notion development log and bug backlog status once billing reopen work is complete or formally paused.
- Define billing release gates so future billing changes cannot ship without auth, timeout, and rate limit verification.
- Close the incident only after at least one stable monitoring window with no renewed spend anomaly.

Dependencies
- Phase 6 complete or formally paused in a safe state
- Access to docs and Notion tracking systems

Required Resources
- Vercel alerts and firewall controls
- Prompt Lab docs
- Notion logging databases
- Dave as release owner

Estimated Timeline
- 0.5 to 1.5 working days

Owner / Responsible Party
- Dave, with Codex support

Risks / Failure Points
- Incident may be declared resolved before enough monitoring time passes.
- Alerts may exist but not be routed to a monitored destination.
- Future billing work can bypass the new contract if release gates are not enforced.

3. EXECUTION NOTES

Critical sequencing constraints
- Do not relax the firewall deny rule until the stability soak passes and signed in preview billing is verified.
- Implement auth before compute, rate limiting, timeout caps, and kill switch behavior before any production reopen.
- Commit the current deployed hardening before broader reopen work so git history reflects production behavior.
- Treat any new long duration billing function, timeout, or unexplained invocation spike as an immediate rollback condition.

Parallelizable work
- Documentation updates and Notion tracking can proceed while containment monitoring runs.
- Alert setup can run in parallel with source attribution once the exact billing routes are confirmed.
- Test additions and commit preparation can proceed while the soak window is running.

Quick wins vs long lead tasks
- Quick wins:
- Confirm deployment alias and current edge rule state.
- Commit the already tested billing hardening changes.
- Add route alerts, rate limiting, and the environment kill switch.
- Long lead tasks:
- Determine the exact origin of the original traffic flood.
- Safely reopen authenticated billing without reintroducing runtime cost spikes.
- Complete the full soak window before declaring the incident closed.

Global Controls
- Auth before compute on all hosted billing routes
- Route level rate limiting on `license`, `checkout`, and `portal`
- Hard upstream timeout cap below 10 seconds
- Structured billing logs with route, action, auth state, status code, and duration
- Environment kill switch `BILLING_ENABLED`
- Edge firewall rule retained until reopen criteria pass
- Circuit breaker with manual re enable requirement
- Hosted `license` route disabled by default unless explicitly justified and verified safe

Billing Route Contract
- Step 1: Validate Clerk session
- Step 2: Reject unsigned or invalid sessions with `401`
- Step 3: Check `BILLING_ENABLED` and circuit breaker state before any downstream work
- Step 4: Enforce route level rate limit before any Stripe, database, or license logic
- Step 5: Only then call Stripe, storage, or internal billing logic

Rate Limiting Policy
- `license`: 5 requests per minute per signed in user, 20 requests per minute global
- `checkout`: 10 requests per minute per signed in user
- `portal`: 10 requests per minute per signed in user
- Burst allowance: up to 2 times the steady rate for 10 seconds
- Failure behavior: return `429` immediately, perform no server retries, and require exponential client backoff

Client Guardrails
- No billing polling interval below 30 seconds
- No automatic client retries without exponential backoff
- No background hosted billing calls without explicit user action
- License refresh must be user triggered or cached with a TTL of at least 5 minutes
- No unsigned billing requests are permitted from hosted clients

Log Format
- `[Billing] route=<route> action=<action> auth=<yes/no> status=<code> duration=<ms> timeout=<true/false>`

Go or No Go Thresholds
- Invocation rate must stay below 5 requests per minute sustained for 24 hours on `license` while blocked and below 10 requests per minute sustained for reopened signed in routes unless a known test window is active.
- Average duration must stay below 500 milliseconds for reopened billing routes.
- P95 duration must stay below 2 seconds for reopened billing routes.
- Timeout count must remain at 0 in the soak window and after each reopen step.
- Provisioned memory and active CPU must stay within 20 percent of the quiet baseline captured in Phase 1.
- Any unexplained traffic source is an automatic no go.

Kill Switch
- Re enable or widen the Vercel firewall deny rule immediately.
- Set `BILLING_ENABLED=false` in the affected environment.
- Redeploy with hosted billing routes returning `503` immediately if the env flag path is not already active.
- Confirm public probe behavior and production logs within 5 minutes of kill switch execution.

Circuit Breaker
- Trigger if timeout count rises above 0 or if P95 duration stays above 5 seconds for 2 minutes
- On trigger, immediately disable the affected route and return `503`
- Log the circuit breaker event using the billing log format
- Require manual re enable after root cause review and a fresh preview validation pass

Alert Triggers
- Any timeout count above 0 on hosted billing routes
- Average duration above 2 seconds for 5 minutes
- P95 duration above 5 seconds for 5 minutes
- Invocation rate above 2 times the post containment baseline
- Memory or active CPU above baseline plus 20 percent for 10 minutes

Alert Actions
- Send immediate operator alert to the active response channel
- Run the kill switch checklist
- Freeze billing reopen work until the cause is identified

Billing Safety Contract
- Auth required before compute
- Rate limiting enforced per route
- Hard timeout below 10 seconds
- No client polling below 30 seconds
- No unsigned billing requests allowed
- Circuit breaker active
- Kill switch available and tested
- These controls are release gates for any hosted billing change

4. NEXT ACTIONS

1. Export the last 24 hours of Vercel metrics for `/api/billing/license`, `/api/billing/checkout`, and `/api/billing/portal` and write down the baseline values for invocations, average duration, P95 duration, active CPU, and memory.
2. Inspect the active Vercel firewall configuration for `prompt-lab`, confirm the exact deny rule scope for `/api/billing/license`, and document the exact steps to widen or remove it.
3. Review the local Prompt Lab billing hardening changes, isolate only the incident related files, and commit them on a dedicated incident branch.
4. Implement or verify the explicit rate limiting policy, `BILLING_ENABLED` kill switch behavior, auth before compute, and the billing route contract on all hosted billing routes.
5. Add the client guardrails and circuit breaker logic, then create a preview deployment and run signed in smoke tests for checkout, portal, and license refresh before any production reopen decision.
