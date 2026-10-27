import { diagnostics } from './diagnostics.js';
const PREFIX = '[PromptLab]';

export function logWarn(context, error) {
  diagnostics().exception('storage_warning', error);
  console.warn(PREFIX, 'A storage operation failed. See the diagnostic report.');
}

export function logError(context, error) {
  diagnostics().exception('storage_error', error);
  console.error(PREFIX, 'A storage operation failed. See the diagnostic report.');
}
