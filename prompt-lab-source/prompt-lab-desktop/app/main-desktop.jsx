import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

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
