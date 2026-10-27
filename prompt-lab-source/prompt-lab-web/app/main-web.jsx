import '../../prompt-lab-extension/src/lib/diagnosticsStart.js';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { ClerkProvider, SignedIn, SignedOut, SignIn, UserButton, useUser, useAuth, useClerk } from '@clerk/clerk-react';
import App from '../../prompt-lab-extension/src/App';
import ErrorBoundary from '../../prompt-lab-extension/src/ErrorBoundary';
import ReportProblemHost from '../../prompt-lab-extension/src/ReportProblemHost.jsx';
import {
  clearLandingAttribution,
  parseLandingIntent,
  readLandingAttribution,
  stripLandingIntentParams,
} from '../../prompt-lab-extension/src/lib/landingAttribution.js';
import { buildAuthRedirectUrls, buildSignInContext } from '../../prompt-lab-extension/src/lib/signInContext.js';
import '../../prompt-lab-extension/src/index.css';

const CLERK_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const reportRoot = document.createElement('div');
reportRoot.id = 'promptlab-report-root';
document.body.appendChild(reportRoot);
ReactDOM.createRoot(reportRoot).render(<ReportProblemHost launcher />);

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
// AUD-006: every Clerk exit (sign-in, sign-up, extra verification) returns to
// /app/, carrying the upgrade intent when there is one.
const authRedirectUrls = typeof window !== 'undefined'
  ? buildAuthRedirectUrls(window.location.href, initialLandingIntent)
  : {};
const signInContext = buildSignInContext(initialLandingIntent);

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
  const clerk = useClerk();
  // Fallback account actions for Settings, the command palette and the phone
  // header's More menu, so Sign out never depends on the avatar being visible.
  const clerkAccountActions = React.useMemo(() => ({
    manageAccount: () => clerk.openUserProfile(),
    signOut: () => clerk.signOut({ redirectUrl: '/?splash=1' }),
  }), [clerk]);

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
        <main style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '20px',
          padding: '24px 16px',
          boxSizing: 'border-box',
          background: '#0f172a',
          fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
        }}>
          <section
            data-testid="signin-context"
            data-upgrade={signInContext.upgrade ? 'true' : 'false'}
            aria-labelledby="signin-context-heading"
            style={{ maxWidth: '400px', width: '100%', color: '#f0ede6', textAlign: 'center' }}
          >
            <a href="/" style={{ color: '#fdba74', fontSize: '13px', textDecoration: 'underline' }}>
              &larr; Back to promptlab.tools
            </a>
            <h1 id="signin-context-heading" style={{ margin: '14px 0 8px', fontSize: '22px', lineHeight: 1.25 }}>
              {signInContext.heading}
            </h1>
            <p style={{ margin: 0, fontSize: '14px', lineHeight: 1.5, color: '#cbd5e1' }}>
              {signInContext.body}
            </p>
          </section>
          <SignIn
            forceRedirectUrl={authRedirectUrls.forceRedirectUrl}
            fallbackRedirectUrl={authRedirectUrls.fallbackRedirectUrl}
            signUpForceRedirectUrl={authRedirectUrls.signUpForceRedirectUrl}
            signUpFallbackRedirectUrl={authRedirectUrls.signUpFallbackRedirectUrl}
            appearance={{
              layout: { socialButtonsVariant: 'blockButton' },
              variables: {
                colorPrimary: '#c2410c',
                colorBackground: '#06060a',
                colorText: '#f0ede6',
                colorNeutral: '#f0ede6',
                colorInputBackground: '#18181b',
                colorInputText: '#f0ede6',
                borderRadius: '0.75rem',
              },
              elements: {
                // Provider artwork includes dark pixels; give it a light surface
                // instead of relying on the card's general text color.
                socialButtonsBlockButton: {
                  backgroundColor: '#f0ede6',
                  color: '#18181b',
                  border: '1px solid #f0ede6',
                  '&:hover': { backgroundColor: '#ffffff' },
                  '&:focus-visible': { outline: '2px solid #fb923c', outlineOffset: '3px' },
                },
                socialButtonsBlockButtonText: { color: '#18181b' },
              },
            }}
          />
        </main>
      </SignedOut>
      <SignedIn>
        <HashRouter>
          <App
            {...landingProps}
            clerkUser={user}
            clerkGetToken={getToken}
            clerkAccountActions={clerkAccountActions}
            clerkUserButton={<UserButton afterSignOutUrl="/?splash=1" appearance={{ variables: { colorPrimary: '#c2410c' } }} />}
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
      <ClerkProvider
        publishableKey={CLERK_KEY}
        signInFallbackRedirectUrl={authRedirectUrls.fallbackRedirectUrl}
        signUpFallbackRedirectUrl={authRedirectUrls.signUpFallbackRedirectUrl}
      >
        <AuthGate />
      </ClerkProvider>
    </ErrorBoundary>
  );
}
