/**
 * Sends a model request through the platform adapter.
 * In extension mode, this goes through chrome.runtime.sendMessage.
 * In desktop mode, this calls providers directly via fetch.
 */
import { callModel as platformCallModel } from './lib/platform.js';

export function callModel(payload) {
  return platformCallModel(payload);
}
