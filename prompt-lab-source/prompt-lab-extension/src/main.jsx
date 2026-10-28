import './lib/diagnosticsStart.js';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import ErrorBoundary from './ErrorBoundary';
import ReportProblemHost from './ReportProblemHost.jsx';
import { libraryJournalSupported, startLibraryJournal } from './lib/libraryJournal.js';
import './index.css';

const render = () => ReactDOM.createRoot(document.getElementById('root')).render(
  <><ReportProblemHost /><ErrorBoundary>
    <HashRouter>
      <App />
    </HashRouter>
  </ErrorBoundary></>
);

// The desktop shell restores the durable Library journal into localStorage
// before any component reads it. startLibraryJournal never rejects.
if (libraryJournalSupported()) startLibraryJournal().then(render);
else render();
