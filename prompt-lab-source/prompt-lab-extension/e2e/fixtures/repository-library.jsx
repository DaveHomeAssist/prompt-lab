import React from 'react';
import { createRoot } from 'react-dom/client';
import LibraryWorkspace from '../../src/LibraryWorkspace.jsx';
import usePromptLibrary from '../../src/hooks/usePromptLibrary.js';
import { createAppLibraryRepository } from '../../src/lib/appLibraryRepository.js';
import { createLoopbackTransport } from '../../../library-storage/command-client.mjs';
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
  return <main className="pl-app-shell" data-theme="light" style={{ height: '100dvh', display: 'flex', overflow: 'hidden', background: 'var(--pl-brand-ink)', color: 'var(--pl-brand-paper)' }}>
    <LibraryWorkspace lib={lib} compact={window.innerWidth < 720} loadEntry={() => {}} copy={() => {}} addToComposer={() => {}} sendToABTest={() => {}} />
  </main>;
}
createRoot(document.getElementById('root')).render(<Surface />);
