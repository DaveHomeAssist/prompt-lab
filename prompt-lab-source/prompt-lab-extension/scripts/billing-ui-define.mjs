// Extension production builds hide Upgrade/Pro billing UI: the extension has
// no sign-in, so checkout cannot complete. Tests and the dev server keep it.
// Set VITE_PROMPTLAB_BILLING_UI=on to build an extension with billing UI.
export function billingUiDefine(command, env = process.env) {
  if (command !== 'build' || env.VITE_PROMPTLAB_BILLING_UI === 'on') return {};
  return { 'import.meta.env.VITE_PROMPTLAB_BILLING_UI': JSON.stringify('off') };
}
