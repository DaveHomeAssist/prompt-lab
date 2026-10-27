import { diagnostics } from './diagnostics.js';
const PREFIX = '[PromptLab]';
function source(context) {
  // Map known call sites to fixed labels. Never retain interpolated titles/IDs.
  if (typeof context !== 'string') return 'unknown';
  if (context.startsWith('library journal ')) return 'library_journal';
  if (context.startsWith('localStorage ')) return 'local_storage';
  if (context === 'IndexedDB unavailable') return 'indexeddb';
  if (['read pads payload', 'read scratch payload', 'pad schema migration'].includes(context)) return 'scratch_read';
  if (['persist pads state (quota exceeded?)', 'promote scratch note', 'pad insert date', 'pad format'].includes(context)) return 'scratch_save';
  if (['pad download', 'scratch download'].includes(context)) return 'scratch_export';
  if (context === 'load experiments') return 'experiments_read';
  if (context === 'save experiment') return 'experiments_save';
  if (['load eval runs', 'refresh eval runs'].includes(context)) return 'run_read';
  if (['save arena run', 'save blocked eval run', 'save eval run', 'save canceled eval run', 'save failed eval run', 'update eval run', 'persist run record'].includes(context)) return 'run_save';
  if (context === 'refresh test cases') return 'test_case_read';
  if (['save blocked test case run', 'save test case run'].includes(context) || context.startsWith('test case batch: ')) return 'test_case_save';
  return 'unknown';
}

export function logWarn(context, error) {
  diagnostics().exception('storage_warning', error, { source: source(context) });
  console.warn(PREFIX, 'A storage operation failed. See the diagnostic report.');
}

export function logError(context, error) {
  diagnostics().exception('storage_error', error, { source: source(context) });
  console.error(PREFIX, 'A storage operation failed. See the diagnostic report.');
}
