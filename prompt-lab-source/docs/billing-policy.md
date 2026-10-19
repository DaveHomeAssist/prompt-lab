# Prompt Lab Pro billing policy

Status: **Draft, not yet published.** This is the proposed customer policy for
the two open billing-acceptance items (commercial refund and access policy, and
the six-hour entitlement cache). It needs the owner's approval and a legal
review before it is published on promptlab.tools or relied on with customers.
Sections marked "Operator notes" are internal.

## Customer policy

### Plans and renewal

Prompt Lab Pro is sold as a subscription through Stripe Checkout: USD 9 per
month or USD 99 per year. A subscription renews automatically at the end of
each period at the same price until you cancel. Stripe processes payments;
Prompt Lab does not store card details.

### Cancelling

You can cancel at any time from Settings → Manage Billing → Manage Purchases,
which opens the Stripe customer portal. Cancellation takes effect at the end of
the period you have already paid for. Pro stays available until then and you
are not charged again. Cancelling does not by itself refund the current period.

### Refunds

- **14-day refund.** You can ask for a full refund within 14 days of your first
  Prompt Lab Pro payment (monthly or annual) or within 14 days of an annual
  renewal payment. Email [hi@promptlab.tools](mailto:hi@promptlab.tools) from the address on your account.
- **A full refund ends Pro.** When we refund a payment in full, we cancel the
  subscription at the same time and Pro ends on your devices at their next
  billing check (see "Pro status on your devices").
- **Monthly renewals** are not refundable, except for billing errors or where
  the law requires a refund.
- **Billing errors** such as duplicate charges, a charge after a cancellation
  took effect, or a charge at the wrong price are refunded in full.
- **Partial refunds or credits** that we offer as a goodwill gesture do not
  change your access.

### Failed payments

If a renewal payment fails, Stripe retries it. Pro stays available while the
subscription is past due. If the payment is not recovered and Stripe marks the
subscription unpaid or canceled, Pro ends. Updating your card in Manage
Purchases restores a past-due subscription.

### Disputes and chargebacks

If you dispute a Prompt Lab charge with your bank, we cancel your subscription
immediately so you are not charged again, and Pro ends. Please contact us first:
we refund billing errors directly. A dispute outcome does not restore the
canceled subscription; you can subscribe again at any time.

### Pro status on your devices

Prompt Lab checks your subscription with our billing server and remembers a
successful result on each device.

Revalidation window: `6 hours`

Offline grace: `7 days`

- A device re-checks your subscription once the revalidation window has passed,
  including in a tab that stays open, and when you choose **Refresh Status**.
- A cancellation that takes effect, a full refund or a dispute can therefore
  take up to 6 hours to appear on a device that already shows Pro. **Refresh
  Status** applies it immediately.
- A new purchase appears as soon as you choose **Sync Purchase** or refresh.
- If the billing server cannot be reached, Pro stays available on that device
  for up to 7 days after the last successful check. After that Pro pauses on
  that device until a check succeeds; nothing is canceled or charged.
- If we temporarily turn billing off, access that a device already has is kept.

## Operator notes

### Issuing refunds

Customers cannot refund themselves in the portal; every refund is issued by the
operator in the Stripe Dashboard.

- **14-day refund or full billing-error refund:** open the subscription and
  cancel it **immediately** with a refund of the last payment, so the refund and
  the end of access happen together. A refund issued from the payment page
  alone leaves the subscription active, and Pro continues until the period
  ends: the license lookup reads subscription status only and the webhook does
  not cancel on refunds.
- **Goodwill partial refund:** refund from the payment page; leave the
  subscription alone.

### Disputes are automated

`POST /api/billing/webhook` cancels the disputed customer's Prompt Lab
subscriptions when it receives `charge.dispute.created`. It only touches
subscriptions on the configured Prompt Lab prices that are active, trialing,
past due, unpaid or incomplete and that existed when the dispute was opened.
If cancellation fails, the webhook answers 5xx so that Stripe redelivers the
event.

The production webhook endpoint must be subscribed to `charge.dispute.created`
for this to run. Adding that event is a Stripe configuration change and needs
explicit owner approval.

### Where the behavior lives

| Policy point | Implementation |
| --- | --- |
| Pro while active, trialing or past due; Free when unpaid, canceled or incomplete | `api/_lib/stripeBilling.js` `ACTIVE_SUBSCRIPTION_STATUSES`, `normalizeBillingRecord()` |
| Live entitlement lookup per license check (customer search plus subscription list) | `api/_lib/stripeBilling.js` `lookupBillingForClerk()`, `api/billing/license.js` |
| Dispute cancels subscriptions | `api/_lib/stripeBilling.js` `applyWebhookAccessPolicy()`, `api/billing/webhook.js` |
| Revalidation window, offline grace and tab re-check interval | `prompt-lab-extension/src/lib/billingPolicy.js` |
| Cache, re-check and offline grace behavior | `prompt-lab-extension/src/hooks/useBillingState.js` `applyFailedValidation()` |
| In-app renewal and refund disclosure | `prompt-lab-extension/src/modals/BillingModal.jsx` |
| Tests | `tests/billing-policy.test.mjs`, `prompt-lab-extension/src/__tests__/useBillingState.test.jsx`, `prompt-lab-extension/src/__tests__/BillingModal.test.jsx` |

`scripts/docs-consistency.mjs` checks the revalidation window and offline grace
values above against `billingPolicy.js`.

### Limits that remain

- The entitlement cache is a client convenience, not a security boundary. A user
  who edits local storage can show Pro locally. Any future server-provided Pro
  feature must check the entitlement on the server.
- In-app feature gates are currently off (`FEATURE_GATES_ENABLED = false` in
  `prompt-lab-extension/src/lib/billing.js`), so every workflow feature is open
  to every user whatever their plan. This policy therefore changes the plan label
  and the purchase lifecycle, not which features a user can open today.
- Stripe retry and final-failure behavior (Smart Retries, then unpaid or
  canceled), portal cancellation mode and renewal reminder emails are Stripe
  Dashboard settings, not code. They must match this policy.
- The webhook arrival log is still not deduplicated or ordered. For dispute
  events its customer key holds the dispute ID, because a dispute object has no
  customer field.
