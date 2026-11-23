import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { readHighlightSettings } from '../../prompt-lab-extension/src/lib/highlight/shortcutSettings.js';

globalThis.PromptLabHighlightNative = {
  configure: ({ enabled, accelerator }) => invoke('highlight_configure', { enabled, accelerator }),
};
const highlightSettings = readHighlightSettings();
invoke('highlight_configure', {
  enabled: highlightSettings.enabled,
  accelerator: highlightSettings.accelerator,
}).catch(() => {});
listen('promptlab:highlight-notice', (event) => {
  window.dispatchEvent(new CustomEvent('promptlab:highlight-notice', { detail: event.payload }));
}).catch(() => {});

// This entry point runs only in the desktop distribution. Browser builds never
// resolve Tauri dependencies or gain native filesystem commands.
globalThis.PromptLabDiagnosticsNative = {
  record: event => invoke('diagnostics_record', { event }),
  heartbeat: ({ visible, heapBytes }) => invoke('diagnostics_heartbeat', { visible, heapBytes }),
  read: () => invoke('diagnostics_read'),
  prepare: report => invoke('diagnostics_prepare', { report }),
  openIssue: reportId => invoke('diagnostics_open_issue', { reportId }),
  export: report => invoke('diagnostics_export', { report }),
};
listen('promptlab:report-problem', () => window.dispatchEvent(new Event('promptlab:report-problem'))).catch(() => {});
listen('promptlab:native-export', event => window.dispatchEvent(new CustomEvent('promptlab:native-export', { detail: event.payload }))).catch(() => {});
// Import after installing the bridge so diagnostics capture application startup.
import('../../prompt-lab-extension/src/main.jsx').catch(() => {
  // Startup failures can happen before React and the shared recorder exist.
  globalThis.PromptLabDiagnosticsNative.record({ code: 'uncaught_error', metadata: { errorType: 'Error' } }).catch(() => {});
  document.body.textContent = 'Prompt Lab could not start. Use Help → Export diagnostics and open folder, then restart the app.';
});
