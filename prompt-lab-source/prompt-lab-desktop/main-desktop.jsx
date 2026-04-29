import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from '../prompt-lab-extension/src/App';
import ErrorBoundary from '../prompt-lab-extension/src/ErrorBoundary';
import '../prompt-lab-extension/src/index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <HashRouter>
      <App />
    </HashRouter>
  </ErrorBoundary>
);
