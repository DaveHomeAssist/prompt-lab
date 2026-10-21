// AUD-013: the single source for Prompt Lab Pro prices and the Pro feature
// list. The app (BillingModal, sign-in card, feature gates) imports this
// module; the static pages that ship raw HTML (landing page, terms, billing
// policy, the docs/ copy of the landing page) keep literal text, and
// tests/pricing-copy.test.mjs fails if any of them disagree with it.
// scripts/check-stripe-prices.mjs compares these amounts with the configured
// Stripe prices (read-only).
//
// Changing a price: update the amounts here, then the literals the test
// names, then the Stripe price IDs. Never change a live Stripe price without
// Dave's sign-off.

export const PRICING_CURRENCY = 'usd';

export const PRO_PRICES = Object.freeze({
  monthly: Object.freeze({ period: 'monthly', interval: 'month', amountCents: 900 }),
  annual: Object.freeze({ period: 'annual', interval: 'year', amountCents: 7900 }),
});

// Annual price before the 2026-10 change. Existing subscribers keep it
// (STRIPE_LEGACY_YEARLY_PRICE_IDS); it is never offered at checkout.
export const LEGACY_ANNUAL_AMOUNT_CENTS = 9900;

export function formatUsd(cents) {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

export function formatUsdWords(cents) {
  const dollars = cents / 100;
  return `USD ${Number.isInteger(dollars) ? dollars : dollars.toFixed(2)}`;
}

export const ANNUAL_SAVINGS_CENTS = PRO_PRICES.monthly.amountCents * 12 - PRO_PRICES.annual.amountCents;
export const ANNUAL_EFFECTIVE_MONTHLY_CENTS = Math.round(PRO_PRICES.annual.amountCents / 12);

export const PRICE_COPY = Object.freeze({
  monthly: formatUsd(PRO_PRICES.monthly.amountCents), // "$9"
  annual: formatUsd(PRO_PRICES.annual.amountCents), // "$79"
  monthlyPerPeriod: `${formatUsd(PRO_PRICES.monthly.amountCents)}/month`,
  annualPerPeriod: `${formatUsd(PRO_PRICES.annual.amountCents)}/year`,
  annualSavings: formatUsd(ANNUAL_SAVINGS_CENTS), // "$29"
  annualEffectiveMonthly: formatUsd(ANNUAL_EFFECTIVE_MONTHLY_CENTS), // "$6.58"
  legacyAnnual: formatUsd(LEGACY_ANNUAL_AMOUNT_CENTS),
  termsSentence: `${formatUsdWords(PRO_PRICES.monthly.amountCents)} per month or ${formatUsdWords(PRO_PRICES.annual.amountCents)} per year`,
  legacyAnnualWords: `${formatUsdWords(LEGACY_ANNUAL_AMOUNT_CENTS)} per year`,
});

// Pro features, in landing-page order. `label`/`description` are the in-app
// copy; `landingLabel` is the line on the landing pricing card.
// OPEN DECISION (AUD-008, Dave): whether the diff viewer stays Pro. This list
// records the current behaviour only; do not move features without that call.
export const PRO_FEATURE_LIST = Object.freeze([
  Object.freeze({
    id: 'abTesting',
    label: 'A/B testing',
    description: 'Run prompt variants head-to-head inside Evaluate.',
    landingLabel: 'A/B Compare in Evaluate',
  }),
  Object.freeze({
    id: 'diffView',
    label: 'Diff viewer',
    description: 'Compare generated outputs side-by-side.',
    landingLabel: 'Side-by-side diff viewer',
    pendingDecision: 'AUD-008',
  }),
  Object.freeze({
    id: 'batchRuns',
    label: 'Batch runs',
    description: 'Run saved test cases in one pass.',
    landingLabel: 'Batch test-case runs',
  }),
  Object.freeze({
    id: 'collections',
    label: 'Collections',
    description: 'Organize prompts into reusable groups.',
    landingLabel: 'Collections for grouped libraries',
  }),
]);
