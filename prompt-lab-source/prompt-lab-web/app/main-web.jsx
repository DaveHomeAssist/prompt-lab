import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { ClerkProvider, SignedIn, SignedOut, SignIn, UserButton, useUser, useAuth } from '@clerk/clerk-react';
import App from '../../prompt-lab-extension/src/App';
import ErrorBoundary from '../../prompt-lab-extension/src/ErrorBoundary';
import '../../prompt-lab-extension/src/index.css';

const CLERK_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

const clerkAppearance = {
  variables: {
    colorPrimary: '#8b5cf6',
    colorBackground: '#111827',
    colorText: '#f3f4f6',
    colorTextSecondary: '#cbd5e1',
    colorInputBackground: '#162033',
    colorInputText: '#f8fafc',
    colorDanger: '#fb7185',
    colorSuccess: '#34d399',
    colorNeutral: '#94a3b8',
    colorMuted: '#94a3b8',
    borderRadius: '0.9rem',
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
  },
  elements: {
    rootBox: 'w-full',
    cardBox: 'w-full shadow-none',
    card: 'border border-slate-800 bg-slate-950/88 text-slate-100 shadow-[0_24px_80px_rgba(2,6,23,0.55)] backdrop-blur-xl',
    headerTitle: 'text-slate-100 text-2xl font-semibold tracking-tight',
    headerSubtitle: 'text-slate-400',
    socialButtonsBlockButton: 'border border-slate-700 bg-slate-900 text-slate-100 shadow-none hover:bg-slate-800 hover:border-slate-600 transition-colors',
    socialButtonsBlockButtonText: 'text-slate-100 font-medium',
    dividerLine: 'bg-slate-800',
    dividerText: 'text-slate-500',
    formFieldLabel: 'text-slate-200 font-medium',
    formFieldInput: 'border border-slate-700 bg-slate-900 text-slate-50 placeholder:text-slate-500 focus:border-violet-400 focus:ring-2 focus:ring-violet-500/35 shadow-none',
    formFieldHintText: 'text-slate-400',
    formFieldErrorText: 'text-rose-300',
    formButtonPrimary: 'bg-violet-600 text-white shadow-none hover:bg-violet-500 focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 transition-colors',
    footerActionText: 'text-slate-400',
    footerActionLink: 'text-violet-300 hover:text-violet-200',
    identityPreviewText: 'text-slate-200',
    identityPreviewEditButton: 'text-slate-300 hover:text-white',
    formResendCodeLink: 'text-violet-300 hover:text-violet-200',
    otpCodeFieldInput: 'border border-slate-700 bg-slate-900 text-slate-50',
    alert: 'border border-rose-500/30 bg-rose-500/10 text-rose-200',
    userButtonTrigger: 'rounded-xl ring-1 ring-slate-800/70 hover:ring-violet-500/35 transition-colors',
    userButtonPopoverCard: 'border border-slate-800 bg-slate-950/96 text-slate-100 shadow-[0_24px_80px_rgba(2,6,23,0.55)] backdrop-blur-xl',
    userButtonPopoverMain: 'bg-transparent',
    userPreview: 'border-b border-slate-800',
    userPreviewMainIdentifier: 'text-slate-100',
    userPreviewSecondaryIdentifier: 'text-slate-400',
    userButtonPopoverActionButton: 'text-slate-200 hover:bg-slate-900 hover:text-white transition-colors',
    userButtonPopoverActionButtonText: 'text-slate-200',
    userButtonPopoverActionButtonIcon: 'text-slate-400',
    userButtonPopoverFooter: 'border-t border-slate-800 bg-slate-950/90',
    userButtonPopoverFooterPages: 'hidden',
    navbar: 'border-r border-slate-800 bg-slate-950/92',
    navbarButton: 'text-slate-300 hover:bg-slate-900 hover:text-white',
    navbarMobileMenuButton: 'text-slate-200 hover:bg-slate-900',
    pageScrollBox: 'bg-transparent',
    profileSectionTitleText: 'text-slate-300',
    profileSectionContent: 'border border-slate-800 bg-slate-950/85',
    badge: 'border border-emerald-500/25 bg-emerald-500/10 text-emerald-200',
  },
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
          background: 'radial-gradient(circle at top, rgba(139,92,246,0.12), transparent 32%), #020617',
          padding: '24px',
        }}>
          <SignIn
            appearance={clerkAppearance}
          />
        </div>
      </SignedOut>
      <SignedIn>
        <HashRouter>
          <App
            clerkUser={user}
            clerkGetToken={getToken}
            clerkUserButton={<UserButton afterSignOutUrl="/" appearance={clerkAppearance} />}
          />
        </HashRouter>
      </SignedIn>
    </>
  );
}

if (!CLERK_KEY) {
  console.error('Missing VITE_CLERK_PUBLISHABLE_KEY — falling back to unauthenticated mode.');
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
      <ClerkProvider publishableKey={CLERK_KEY} appearance={clerkAppearance}>
        <AuthGate />
      </ClerkProvider>
    </ErrorBoundary>
  );
}
