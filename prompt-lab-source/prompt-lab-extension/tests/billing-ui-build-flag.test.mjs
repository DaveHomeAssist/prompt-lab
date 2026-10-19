import assert from 'node:assert/strict';
import test from 'node:test';
import { billingUiDefine } from '../scripts/billing-ui-define.mjs';

const KEY = 'import.meta.env.VITE_PROMPTLAB_BILLING_UI';

test('extension production builds hide billing UI (no sign-in, checkout cannot complete)', () => {
  assert.equal(billingUiDefine('build', {})[KEY], '"off"');
});

test('dev server and tests keep billing UI', () => {
  assert.equal(billingUiDefine('serve', {})[KEY], undefined);
});

test('VITE_PROMPTLAB_BILLING_UI=on re-enables billing UI in an extension build', () => {
  assert.equal(billingUiDefine('build', { VITE_PROMPTLAB_BILLING_UI: 'on' })[KEY], undefined);
});
