import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { ClerkProvider, SignedIn, SignedOut, SignIn, UserButton, useUser, useAuth } from '@clerk/clerk-react';
import App from '../../prompt-lab-extension/src/App';
import ErrorBoundary from '../../prompt-lab-extension/src/ErrorBoundary';
import {
  buildLandingIntentRedirectUrl,
  clearLandingAttribution,
  parseLandingIntent,
  readLandingAttribution,
  stripLandingIntentParams,
} from '../../prompt-lab-extension/src/lib/landingAttribution.js';
import '../../prompt-lab-extension/src/index.css';

const CLERK_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

function getLandingStorage() {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

const landingStorage = getLandingStorage();
const initialLandingIntent = typeof window !== 'undefined'
  ? parseLandingIntent(window.location.search)
  : null;
const initialLandingAttribution = readLandingAttribution(landingStorage);
const landingIntentRedirectUrl = typeof window !== 'undefined' && initialLandingIntent
  ? buildLandingIntentRedirectUrl(window.location.href, initialLandingIntent)
  : '';

function consumeLandingIntent() {
  if (typeof window === 'undefined' || !initialLandingIntent) return;
  const nextUrl = stripLandingIntentParams(window.location.href);
  if (!nextUrl) return;
  try {
    window.history.replaceState(window.history.state, '', nextUrl);
  } catch {
    // The handoff is already one-shot in React state if History is unavailable.
  }
}

function consumeLandingAttribution() {
  clearLandingAttribution(landingStorage);
}

const landingProps = {
  landingIntent: initialLandingIntent,
  landingAttribution: initialLandingAttribution,
  onLandingIntentConsumed: consumeLandingIntent,
  onLandingAttributionConsumed: consumeLandingAttribution,
};

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
            forceRedirectUrl={landingIntentRedirectUrl || undefined}
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
            {...landingProps}
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
          <App {...landingProps} />
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
