import '../../prompt-lab-extension/src/lib/diagnosticsStart.js';
import { redirectAppPathToHash } from '../../prompt-lab-extension/src/lib/appPathRoute.js';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { ClerkProvider, SignedIn, SignedOut, SignIn, UserButton, useUser, useAuth, useClerk } from '@clerk/clerk-react';
import { hasClerkSessionHint } from '../../prompt-lab-extension/src/lib/clerkSessionHint.js';
import ErrorBoundary from '../../prompt-lab-extension/src/ErrorBoundary';
import ReportProblemHost from '../../prompt-lab-extension/src/ReportProblemHost.jsx';
import {
  clearLandingAttribution,
  parseLandingIntent,
  readLandingAttribution,
  stripLandingIntentParams,
} from '../../prompt-lab-extension/src/lib/landingAttribution.js';
import { buildAuthRedirectUrls, buildSignInContext } from '../../prompt-lab-extension/src/lib/signInContext.js';
import { signInAppearance } from './signInAppearance.js';
import '../../prompt-lab-extension/src/index.css';
import './sign-in.css';

// /app/compare and friends -> /app/#/compare before the hash router mounts.
redirectAppPathToHash();

// AUD-007: the workbench is only needed once someone is signed in, so it is
// its own chunk. Signed-out phones get the sign-in screen without downloading
// and parsing it. When Clerk's session cookie says someone is probably signed
// in, start fetching it now so it loads alongside Clerk instead of after.
import { loadApp } from '@promptlab/workbench-loader';
const App = React.lazy(loadApp);
const likelySignedIn = typeof document !== 'undefined' && hasClerkSessionHint(document.cookie);
if (likelySignedIn) loadApp().catch(() => {});

function LoadingScreen() {
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

function SignInShell({ pending = false }) {
  return (
    <main className="pl-signin-gate">
      <section
        data-testid="signin-context"
        data-upgrade={signInContext.upgrade ? 'true' : 'false'}
        aria-labelledby="signin-context-heading"
        className="pl-signin-context"
      >
        <a className="pl-signin-logo" href="/" aria-label="Prompt Lab home">
          <span className="pl-signin-mark" aria-hidden="true">PL</span>
          Prompt Lab
        </a>
        <a className="pl-signin-back" href="/">
          &larr; Back to promptlab.tools
        </a>
        <h1 id="signin-context-heading">
          {signInContext.heading}
        </h1>
        <p>
          {signInContext.body}
        </p>
      </section>
      {pending ? (
        <div
          data-testid="signin-pending"
          role="status"
          aria-live="polite"
          className="pl-signin-pending"
        >
          Loading sign-in…
        </div>
      ) : <SignIn
        forceRedirectUrl={authRedirectUrls.forceRedirectUrl}
        fallbackRedirectUrl={authRedirectUrls.fallbackRedirectUrl}
        signUpForceRedirectUrl={authRedirectUrls.signUpForceRedirectUrl}
        signUpFallbackRedirectUrl={authRedirectUrls.signUpFallbackRedirectUrl}
        appearance={signInAppearance}
      />}
    </main>
  );
}

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
    // Signed-out visitors see the sign-in heading straight away; the Clerk
    // form fills in when Clerk has loaded. Probable sessions keep the neutral
    // loading screen so a signed-in user never sees a sign-in flash.
    return likelySignedIn ? <LoadingScreen /> : <SignInShell pending />;
  }

  return (
    <>
      <SignedOut>
        <SignInShell />
      </SignedOut>
      <SignedIn>
        <React.Suspense fallback={<LoadingScreen />}>
        <HashRouter>
          <App
            {...landingProps}
            clerkUser={user}
            clerkGetToken={getToken}
            clerkAccountActions={clerkAccountActions}
            clerkUserButton={<UserButton afterSignOutUrl="/?splash=1" appearance={{ variables: { colorPrimary: '#c2410c' } }} />}
          />
        </HashRouter>
        </React.Suspense>
      </SignedIn>
    </>
  );
}

if (!CLERK_KEY) {
  if (import.meta.env.DEV) {
    console.warn('[PromptLab] Clerk key missing - running unauthenticated in dev mode');
    // No sign-in step here, so wait for the workbench before the first render,
    // as before AUD-007. On the dev server the loader resolves at once (see
    // workbenchLoader.dev.js), so the app is mounted by the time the page has
    // loaded. Production never takes this branch, so its signed-out path still
    // renders without the workbench.
    const { default: Workbench } = await loadApp();
    ReactDOM.createRoot(document.getElementById('root')).render(
      <ErrorBoundary>
        <HashRouter>
          <Workbench {...landingProps} />
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
      {/* PRIV-08: no Clerk SDK telemetry. Clerk only collects it on development
          instances, which Vercel previews use after #274. */}
      <ClerkProvider
        publishableKey={CLERK_KEY}
        telemetry={false}
        signInFallbackRedirectUrl={authRedirectUrls.fallbackRedirectUrl}
        signUpFallbackRedirectUrl={authRedirectUrls.signUpFallbackRedirectUrl}
      >
        <AuthGate />
      </ClerkProvider>
    </ErrorBoundary>
  );
}
