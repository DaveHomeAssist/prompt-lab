import { startAppCaptureParticipant } from './lib/libraryOriginCapture.js';
import './lib/diagnosticsStart.js';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import ErrorBoundary from './ErrorBoundary';
import ReportProblemHost from './ReportProblemHost.jsx';
import { libraryJournalSupported, startLibraryJournal } from './lib/libraryJournal.js';
import { startScratchJournal } from './lib/scratchJournal.js';
import './index.css';

const render = () => ReactDOM.createRoot(document.getElementById('root')).render(
  <><ReportProblemHost /><ErrorBoundary>
    <HashRouter>
      <App />
    </HashRouter>
  </ErrorBoundary></>
);

// Restore the desktop Library and Scratch mirrors before components read them.
// Both startup routines report recovery failures without rejecting.
startAppCaptureParticipant().then(() => {
  if (libraryJournalSupported()) return Promise.all([startLibraryJournal(), startScratchJournal()]);
}).then(render);
