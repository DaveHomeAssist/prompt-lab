// Service-worker entry for highlight enhance. Bundled into the extension as
// highlight-worker.js. Uses the same provider module as the background worker
// (extension/lib/providers.js), which is the path the side panel already uses.

import { callProvider } from '../extension/lib/providers.js';
import { activeProviderRoute, migrateLegacyDefaults } from '../extension/lib/providerRegistry.js';
import { enhanceHighlightText } from './lib/highlight/enhancePayload.js';

export async function enhanceSelection(text, settings, generation, signal) {
  const store = migrateLegacyDefaults(settings || {});
  const route = activeProviderRoute(store);
  return enhanceHighlightText(text, {
    route,
    generation,
    signal,
    call: (payload, options) => callProvider({
      provider: route.provider,
      payload,
      settings: store,
      signal: options?.signal,
    }),
  });
}
