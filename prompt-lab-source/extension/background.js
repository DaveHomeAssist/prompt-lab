// Prompt Lab — Background Service Worker
// Holds the API key in chrome.storage.local and proxies Anthropic API calls.
// The key NEVER touches the page context.

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== 'ANTHROPIC_REQUEST') return;

  chrome.storage.local.get('apiKey', async ({ apiKey }) => {
    if (!apiKey) {
      sendResponse({ error: 'No API key set. Open extension Options to add one.' });
      return;
    }
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify(msg.payload),
      });
      const data = await res.json();
      sendResponse({ data });
    } catch (e) {
      sendResponse({ error: e.message });
    }
  });

  // CRITICAL: return true keeps the message channel open for the async response.
  // Without this, sendResponse silently fails.
  return true;
});
