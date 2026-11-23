// Cancel a highlight request. Abort belongs to the AbortController. Calling it
// on the signal throws, and that throw must not skip the native window close.

export function cancelHighlight(controller, cancelNative) {
  try {
    if (controller && typeof controller.abort === 'function') controller.abort();
  } catch { /* A thrown abort still has to reach the native cancel. */ }
  try {
    const pending = typeof cancelNative === 'function' ? cancelNative() : undefined;
    if (pending && typeof pending.catch === 'function') pending.catch(() => {});
  } catch { /* The card still closes. */ }
}
