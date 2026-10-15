import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { lookupBilling } from '../api/_lib/stripeBilling.js';

const API = 'https://api.stripe.com/v1/';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const objectId = (value) => typeof value === 'string' ? value : value?.id;

export function testCredentials(env) {
  assert.equal(env.PROMPTLAB_STRIPE_TEST_RUN, 'true', 'Explicit test run opt-in required.');
  const key = env.STRIPE_TEST_SECRET_KEY || '';
  assert.ok(/^(sk|rk)_test_\S+$/.test(key), 'A Stripe test key is required; live keys are forbidden.');
  assert.match(env.STRIPE_TEST_ACCOUNT_ID || '', /^acct_[A-Za-z0-9]+$/, 'Expected Stripe account required.');
  return { key, accountId: env.STRIPE_TEST_ACCOUNT_ID };
}

export function assertIsolated(account, balance, endpoints, expectedAccount) {
  assert.equal(account.id, expectedAccount, 'Wrong Stripe account.');
  assert.equal(balance.livemode, false, 'Stripe must confirm test mode.');
  assert.equal(endpoints.has_more, false, 'Incomplete webhook inventory.');
  assert.ok(Array.isArray(endpoints.data), 'Missing webhook inventory.');
  assert.ok(endpoints.data.every((endpoint) => endpoint.status === 'disabled'),
    'Use an isolated test account with no enabled webhook destinations.');
}

// Reuse the same mutation key when a response is lost after Stripe commits it.
export async function requestWithRetry(url, options, fetcher = fetch, wait = sleep) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetcher(url, { ...options, signal: AbortSignal.timeout(20000) });
      const payload = await response.json();
      if (response.status >= 500 || response.status === 429) {
        if (attempt < 2) { await wait(500 * (attempt + 1)); continue; }
      }
      return { response, payload };
    } catch {
      if (attempt === 2) throw new Error('Stripe response unavailable after three attempts; mutation outcome unknown.');
      await wait(500 * (attempt + 1));
    }
  }
}

export async function runLifecycle(env = process.env, emit = console.log, hooks = {}) {
  const { key, accountId } = testCredentials(env);
  const runId = `promptlab-${randomUUID()}`;
  const report = { runId, accountId, startedAt: new Date().toISOString(), livemode: false,
    checks: [], objects: [], cleanup: [], limitations: [
      'Stripe test API and PromptLab billing lookup integration only; no real money.',
      'No authenticated paid browser session or webhook delivery/storage acceptance.',
      'Refund alone does not cancel an active subscription under current entitlement behavior.',
    ] };
  const clocks = [];
  const prices = [];
  let product;
  let sequence = 0;
  const metadata = { 'metadata[promptlab_test_run]': runId };

  async function request(path, data, method = data ? 'POST' : 'GET') {
    const { response, payload } = await requestWithRetry(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${key}`,
        ...(data ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        ...(method === 'POST' ? { 'Idempotency-Key': `${runId}-${++sequence}` } : {}),
      },
      ...(data ? { body: new URLSearchParams(data) } : {}),
    });
    // Do not include upstream payloads, payment URLs, or credentials in receipts.
    assert.ok(response.ok, `Stripe ${method} ${path.split('?')[0]}: HTTP ${response.status} (${payload.error?.code || payload.error?.type || 'unknown'})`);
    if ('livemode' in payload) assert.equal(payload.livemode, false, 'Unexpected live object.');
    return payload;
  }

  async function check(name, evidence) {
    await hooks.onCheck?.(name, evidence);
    report.checks.push({ name, ...evidence });
    emit(JSON.stringify({ check: name, ...evidence }));
  }

  async function owned(path) {
    const value = await request(path);
    assert.equal(value.metadata?.promptlab_test_run, runId, 'Refusing to mutate an unowned object.');
    return value;
  }

  async function advance(clockId, frozenTime) {
    await request(`test_helpers/test_clocks/${clockId}/advance`, { frozen_time: frozenTime });
    for (let attempt = 0; attempt < 90; attempt += 1) {
      const clock = await request(`test_helpers/test_clocks/${clockId}`);
      if (clock.status === 'ready') return;
      assert.equal(clock.status, 'advancing', 'Test clock failed.');
      await sleep(2000);
    }
    throw new Error('Test clock did not become ready within 180 seconds.');
  }

  const periodEnd = (sub) => {
    const end = sub.items?.data?.[0]?.current_period_end ?? sub.current_period_end;
    assert.ok(Number.isInteger(end), 'Missing subscription period end.');
    return end;
  };

  try {
    const account = await request('account');
    const balance = await request('balance');
    const endpoints = await request('webhook_endpoints?limit=100');
    assertIsolated(account, balance, endpoints, accountId);
    await check('test isolation', { accountId, livemode: false, enabledWebhookDestinations: 0 });
    product = await request('products', { name: `PromptLab disposable lifecycle ${runId}`, ...metadata });
    report.objects.push({ type: 'product', id: product.id });

    for (const [period, interval, amount] of [['monthly', 'month', 900], ['annual', 'year', 9900]]) {
      const price = await request('prices', { product: product.id, currency: 'usd',
        unit_amount: amount, 'recurring[interval]': interval, ...metadata });
      prices.push(price.id);
      report.objects.push({ type: 'price', id: price.id, period });
      const clock = await request('test_helpers/test_clocks', {
        frozen_time: Math.floor(Date.now() / 1000), name: `${runId}-${period}`,
      });
      clocks.push({ id: clock.id, name: clock.name });
      report.objects.push({ type: 'clock', id: clock.id, period });
      const paymentMethod = await request('payment_methods', { type: 'card', 'card[token]': 'tok_visa', ...metadata });
      // No email is supplied, so synthetic billing cannot email a real person.
      const customer = await request('customers', { name: `PromptLab test ${period}`,
        test_clock: clock.id, payment_method: paymentMethod.id,
        'invoice_settings[default_payment_method]': paymentMethod.id, ...metadata });
      report.objects.push({ type: 'customer', id: customer.id, period });
      const config = { secretKey: key, monthlyPriceId: period === 'monthly' ? price.id : '',
        yearlyPriceId: period === 'annual' ? price.id : '', portalReturnUrl: 'https://example.invalid/' };
      await hooks.onCustomer?.({ period, customer, config, request });
      async function entitlement(expectedPlan, expectedStatus) {
        const billing = await lookupBilling(config, { customerId: customer.id });
        assert.equal(billing.customerId, customer.id);
        assert.equal(billing.plan, expectedPlan);
        assert.equal(billing.status, expectedStatus);
        if (expectedPlan === 'pro') assert.equal(billing.billingPeriod, period);
        return { plan: billing.plan, status: billing.status, billingPeriod: billing.billingPeriod };
      }
      await check(`${period} before activation`, await entitlement('free', 'inactive'));
      let subscription = await request('subscriptions', { customer: customer.id,
        'items[0][price]': price.id, payment_behavior: 'error_if_incomplete', ...metadata });
      report.objects.push({ type: 'subscription', id: subscription.id, period });
      const firstEnd = periodEnd(subscription);
      const firstInvoiceId = objectId(subscription.latest_invoice);
      const firstInvoice = await request(`invoices/${firstInvoiceId}`);
      assert.equal(firstInvoice.status, 'paid');
      assert.equal(firstInvoice.amount_paid, amount);
      await check(`${period} activation`, { subscriptionId: subscription.id, invoiceId: firstInvoiceId,
        amountPaid: amount, ...(await entitlement('pro', 'active')) });

      // Advance once to create the renewal invoice and again past automatic collection delay.
      await advance(clock.id, firstEnd + 60);
      await advance(clock.id, firstEnd + 7200);
      subscription = await request(`subscriptions/${subscription.id}`);
      const renewalId = objectId(subscription.latest_invoice);
      assert.notEqual(renewalId, firstInvoiceId, 'Renewal must create a new invoice.');
      const renewal = await request(`invoices/${renewalId}`);
      assert.equal(renewal.status, 'paid');
      assert.equal(renewal.amount_paid, amount);
      assert.equal(renewal.billing_reason, 'subscription_cycle');
      assert.ok(periodEnd(subscription) > firstEnd);
      await check(`${period} renewal`, { invoiceId: renewalId, amountPaid: amount,
        ...(await entitlement('pro', 'active')) });

      const charges = await request(`charges?customer=${customer.id}&limit=100`);
      assert.equal(charges.has_more, false);
      assert.equal(charges.data.length, 2, 'Expected activation and renewal charges only.');
      const charge = charges.data.find((item) => item.status === 'succeeded' && item.amount === amount);
      assert.ok(charge);
      assert.equal(charge.customer, customer.id);
      assert.equal(charge.livemode, false);
      const partialAmount = Math.floor(amount / 2);
      const partial = await request('refunds', { charge: charge.id, amount: partialAmount, ...metadata });
      assert.equal(partial.status, 'succeeded');
      assert.equal(partial.amount, partialAmount);
      const remainder = await request('refunds', { charge: charge.id, ...metadata });
      assert.equal(remainder.status, 'succeeded');
      assert.equal(remainder.amount, amount - partialAmount);
      const refunded = await request(`charges/${charge.id}`);
      assert.equal(refunded.amount_refunded, amount);
      assert.equal(refunded.refunded, true);
      await check(`${period} partial and full refund`, { chargeId: charge.id,
        refundIds: [partial.id, remainder.id], amountRefunded: amount,
        ...(await entitlement('pro', 'active')) });

      await owned(`subscriptions/${subscription.id}`);
      subscription = await request(`subscriptions/${subscription.id}`, { cancel_at_period_end: true });
      assert.equal(subscription.cancel_at_period_end, true);
      await check(`${period} scheduled cancellation retains access`, await entitlement('pro', 'active'));
      await advance(clock.id, periodEnd(subscription) + 60);
      subscription = await request(`subscriptions/${subscription.id}`);
      assert.equal(subscription.status, 'canceled');
      await check(`${period} cancellation takes effect`, await entitlement('free', 'canceled'));
      const finalCharges = await request(`charges?customer=${customer.id}&limit=100`);
      assert.equal(finalCharges.has_more, false);
      assert.equal(finalCharges.data.length, 2, 'Canceled subscription must not charge again.');
    }
  } catch (error) {
    report.error = String(error.message).replaceAll(key, '[redacted]');
  } finally {
    for (const clock of clocks) {
      try {
        const current = await request(`test_helpers/test_clocks/${clock.id}`);
        assert.equal(current.name, clock.name);
        const deleted = await request(`test_helpers/test_clocks/${clock.id}`, null, 'DELETE');
        assert.equal(deleted.deleted, true);
        report.cleanup.push({ id: clock.id, deleted: true });
      } catch (error) { report.cleanup.push({ id: clock.id, error: String(error.message).replaceAll(key, '[redacted]') }); }
    }
    for (const customer of report.objects.filter((item) => item.type === 'customer')) {
      try {
        const deleted = await request(`customers/${customer.id}`);
        assert.equal(deleted.deleted, true, 'Test clock cleanup must delete its customer.');
        report.cleanup.push({ id: customer.id, deleted: true });
      } catch (error) { report.cleanup.push({ id: customer.id, error: String(error.message).replaceAll(key, '[redacted]') }); }
    }
    for (const [type, id] of [...prices.map((id) => ['prices', id]), ...(product ? [['products', product.id]] : [])]) {
      try {
        await owned(`${type}/${id}`);
        const archived = await request(`${type}/${id}`, { active: false });
        assert.equal(archived.active, false);
        report.cleanup.push({ id, active: false });
      } catch (error) { report.cleanup.push({ id, error: String(error.message).replaceAll(key, '[redacted]') }); }
    }
  }
  report.finishedAt = new Date().toISOString();
  report.passed = !report.error && report.cleanup.every((item) => !item.error);
  if (env.STRIPE_TEST_REPORT_PATH) await writeFile(env.STRIPE_TEST_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  emit(JSON.stringify(report));
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runLifecycle().then((report) => { process.exitCode = report.passed ? 0 : 1; }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
