# Clerk MFA, sessions and recovery

## Scope and trust boundary

PromptLab's hosted React app uses Clerk's prebuilt SignIn and UserButton
components. Billing accepts signed Clerk bearer tokens; the hosted provider proxy
also accepts the same-origin Clerk session cookie for an owner quota exemption.
The server must authorize only completed authentication, independently of the UI.

The October 23 pass adds a check in both token verification paths: an explicit
session status must be `active`. Legacy tokens without `sts` remain compatible.
Signed `pending` tokens cannot use billing or the owner quota exemption. This
applies to unfinished MFA enrollment, password reset and other session tasks.
Pending visitors retain ordinary public demo limits on the public provider proxy.

## Production configuration acceptance remains open

Dashboard access requires an operator sign-in. No production MFA, session,
password or recovery setting was changed or confirmed in this pass. Do not infer
configuration from the SDK, defaults, source tests or an agent-created QA session.

After sign-in, select PromptLab's production instance and record the before and
after values of the following controls without recording secrets or user data:

- Authenticator MFA and backup codes. Enable backup codes before requiring MFA;
  verify enrollment and a single-use backup-code sign-in with a disposable user.
- Required MFA and passkey policy. Verify the installed prebuilt flow supports
  `setup-mfa`, interrupted enrollment resumes and pending access is denied before
  any mandatory enrollment rollout. Check provider plan and compatibility first.
- Maximum lifetime, inactivity timeout and multiple-account sessions. Keep a
  finite maximum lifetime. Custom durations may require a paid production plan;
  do not buy a plan as part of this pass. Confirm expiry and sign-out behavior.
- Compromised-password protections and password reset behavior. Use a disposable
  account to check recovery, stale sessions and notification behavior.
- UserProfile Security controls and session revocation. Confirm recent
  verification is requested for sensitive changes by the installed Clerk UI.

Retain a configuration rollback receipt. Do not reset real users' passwords,
remove their factors, regenerate their backup codes or revoke their sessions as a
test. Never store recovery codes or authentication credentials in this record.

## Recovery operations

Users should first use an enrolled alternative factor, passkey where permitted,
or an unused backup code. Clerk's prebuilt account Security controls manage MFA
and backup codes; PromptLab does not implement a separate recovery endpoint.

When every factor and backup code is lost, administrator recovery requires a
documented identity verification decision. An email address, Stripe receipt,
subscription or claimed account ownership alone does not establish identity.
Escalate cases without adequate proof instead of bypassing MFA. Record only a
minimal audit trail and never request passwords, full payment details or codes.

An MFA reset alone does not invalidate existing sessions. For suspected account
compromise, review and revoke affected sessions through Clerk, handle password
recovery through the supported flow, then verify new enrollment and access.
Any credential entry or change requires the operator to complete that step.

## Verification and limits

Regression tests use locally generated RSA keys and valid signed tokens with
`sts: pending`. They assert billing rejection before profile or Stripe requests,
exercise the actual pinned Clerk backend SDK, and verify ordinary public limits
still apply to pending owner tokens. Existing active-token tests cover both
legacy omitted status and normal identity/ownership handling.

JWT verification remains stateless: a previously issued valid token may remain
usable until expiration after server-side revocation. Configuration acceptance
and actual MFA/recovery sign-in tests are separate from these source tests.
The existing provider request limits, spending caps, pricing and billing policy
are outside this pass and remain unchanged.

Dominic Node 22.22.1 verification: all five new pending-session regressions fail
against main `6630cb1` before the guards. The full API suite passes 148 tests
after the guards; an added explicit active-status SDK case then passes with the
complete billing-auth file (30 tests). Documentation lint and four consistency
contracts pass. The progress snapshot preserves all 14 plan identities and
contains 59 distinct Notion issues; renderer generation and check pass.

## Vendor references

- [Session tasks](https://clerk.com/docs/guides/configure/session-tasks)
- [Session token claims](https://clerk.com/docs/guides/sessions/session-tokens)
- [MFA recovery](https://clerk.com/docs/guides/secure/mfa-recovery)
- [Session options](https://clerk.com/docs/guides/secure/session-options)
- [Reverification](https://clerk.com/docs/guides/secure/reverification)
