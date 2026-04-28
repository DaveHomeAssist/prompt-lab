import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { ClerkProvider, SignedIn, SignedOut, SignIn, UserButton, useUser, useAuth } from '@clerk/clerk-react';
import App from '../../prompt-lab-extension/src/App';
import ErrorBoundary from '../../prompt-lab-extension/src/ErrorBoundary';
import '../../prompt-lab-extension/src/index.css';

const CLERK_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

function AuthGate() {
  const { user, isLoaded } = useUser();
  const { getToken } = useAuth();

  if (!isLoaded) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0f172a',
        color: '#94a3b8',
        fontFamily: 'system-ui, sans-serif',
        fontSize: '15px',
      }}>
        Loading...
      </div>
    );
  }

  return (
    <>
      <SignedOut>
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0f172a',
        }}>
          <SignIn
            appearance={{
              variables: {
                colorPrimary: '#8b5cf6',
                colorBackground: '#111827',
                colorText: '#e2e8f0',
                colorInputBackground: '#1e293b',
                colorInputText: '#e2e8f0',
                borderRadius: '0.75rem',
              },
            }}
          />
        </div>
      </SignedOut>
      <SignedIn>
        <HashRouter>
          <App
            clerkUser={user}
            clerkGetToken={getToken}
            clerkUserButton={<UserButton afterSignOutUrl="/" appearance={{ variables: { colorPrimary: '#8b5cf6' } }} />}
          />
        </HashRouter>
      </SignedIn>
    </>
  );
}

if (!CLERK_KEY) {
  if (import.meta.env.DEV) {
    console.warn('[PromptLab] Clerk key missing - running unauthenticated in dev mode');
    ReactDOM.createRoot(document.getElementById('root')).render(
      <ErrorBoundary>
        <HashRouter>
          <App />
        </HashRouter>
      </ErrorBoundary>
    );
  } else {
    ReactDOM.createRoot(document.getElementById('root')).render(
      <ErrorBoundary>
        <div style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
          <h1>Configuration Error</h1>
          <p>Authentication is not configured. Please contact support.</p>
        </div>
      </ErrorBoundary>
    );
  }
} else {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <ErrorBoundary>
      <ClerkProvider publishableKey={CLERK_KEY}>
        <AuthGate />
      </ClerkProvider>
    </ErrorBoundary>
  );
}
