import { expect } from '@playwright/test';
import { BILLING_FEATURES } from '../src/lib/billing.js';

// Keep the Free-account smoke aligned with this revision's declared policy.
// A gated export is verified as gated, never counted as downloaded-file proof.
export function isFreeFeatureGated(feature) {
  return process.env.PROMPTLAB_EXPECT_BILLING_ENABLED !== 'false'
    && Object.hasOwn(BILLING_FEATURES, feature);
}

export async function downloadFreeWorkspace(page) {
  if (isFreeFeatureGated('export')) {
    await page.getByRole('button', { name: 'Export Library (Pro)', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Library export is a Pro feature', exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Close billing modal', exact: true }).click();
    console.info('[production Library] current Free export gate verified; no file export exercised');
    return null;
  }
  // Attach both rejection handlers immediately so a missing button or download
  // cannot escape the caller's finally block and leave its QA session active.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export Library', exact: true }).click(),
  ]);
  return download;
}
