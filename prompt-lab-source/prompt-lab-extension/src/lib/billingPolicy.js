// Client entitlement cache policy. docs/billing-policy.md states these values
// in prose and scripts/docs-consistency.mjs pins the document to them, so
// change both together. Keep this module import-free so Node can load it.

const HOUR_MS = 60 * 60 * 1000;

// A successfully verified Pro entitlement is trusted on this device for this
// long before it is checked with the billing server again.
export const BILLING_REVALIDATE_AFTER_HOURS = 6;
export const BILLING_REVALIDATE_AFTER_MS = BILLING_REVALIDATE_AFTER_HOURS * HOUR_MS;

// When billing cannot be reached, cached Pro continues for at most this long,
// counted from the last successful verification (not the last failed attempt).
export const BILLING_OFFLINE_GRACE_DAYS = 7;
export const BILLING_OFFLINE_GRACE_MS = BILLING_OFFLINE_GRACE_DAYS * 24 * HOUR_MS;

// Long-lived tabs re-evaluate the cache on this interval and whenever the page
// becomes visible again, so the window above holds without a reload.
export const BILLING_REVALIDATE_CHECK_INTERVAL_MS = 15 * 60 * 1000;
