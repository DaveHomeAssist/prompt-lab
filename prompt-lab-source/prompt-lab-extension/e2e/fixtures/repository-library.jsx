import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import LibraryWorkspace from '../../src/LibraryWorkspace.jsx';
import usePromptLibrary from '../../src/hooks/usePromptLibrary.js';
import { createAppLibraryRepository } from '../../src/lib/appLibraryRepository.js';
import { createLoopbackTransport } from '../../../library-storage/command-client.mjs';
import { T } from '../../src/constants.js';
import WorkspaceImportModal from '../../src/modals/WorkspaceImportModal.jsx';
import '../../src/index.css';

const options = window.fixtureOptions;
const transport = createLoopbackTransport({ ...options, getToken: () => options.token });
const apply = transport.apply;
transport.apply = async request => { if (window.fixtureBarrier) await window.fixtureBarrier; return apply(request); };
window.repository = createAppLibraryRepository({ ...options, transport });
window.holdSave = () => { window.fixtureBarrier = new Promise(resolve => { window.releaseSave = () => { window.fixtureBarrier = null; resolve(); }; }); };
window.messages = [];
function Surface() {
  const lib = usePromptLibrary(message => window.messages.push(message), { repository: window.repository });
  const [mode, setMode] = useState('light');
  window.setFixtureTheme = setMode;
  return <main className="pl-app-shell" data-theme={mode} style={{ height: '100dvh', display: 'flex', overflow: 'hidden', background: 'var(--pl-brand-ink)', color: 'var(--pl-brand-paper)' }}>
    <LibraryWorkspace m={T[mode]} lib={lib} compact={window.innerWidth < 720} loadEntry={() => {}} copy={() => {}} addToComposer={() => {}} sendToABTest={() => {}} />
    {lib.importPreview && <WorkspaceImportModal m={T[mode]} preview={lib.importPreview} applying={lib.importApplying}
      onChoice={lib.chooseImportResolution} onApply={lib.confirmImport} onRetry={lib.retryImport} onClose={lib.cancelImportPreview} />}
  </main>;
}
createRoot(document.getElementById('root')).render(<Surface />);
