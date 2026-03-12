/**
 * Sends a model request through the extension's background service worker.
 * The API key is stored in chrome.storage.local and never touches this page.
 *
 * @param {Object} payload - The request body (model, max_tokens, messages, etc.)
 * @returns {Promise<Object>} - The parsed JSON response
 */
export function callModel(payload) {
  return new Promise((resolve, reject) => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      return reject(new Error('Not running as an extension. chrome.runtime unavailable.'));
    }
    chrome.runtime.sendMessage(
      { type: 'MODEL_REQUEST', payload },
      (response) => {
        if (chrome.runtime.lastError) {
          return reject(new Error(chrome.runtime.lastError.message));
        }
        if (!response) {
          return reject(
            new Error('No response from background. Is your API key set in Options?')
          );
        }
        if (response.error) {
          return reject(new Error(response.error));
        }
        resolve(response.data);
      }
    );
  });
}
