import { SignIn, SignUp, SignInButton, UserButton, useAuth } from '@clerk/clerk-react';
import { useState } from 'react';

/**
 * Auth wrapper for the hosted web app — BYOK model.
 *
 * The app always renders. Auth is optional and only unlocks premium features.
 * When signed out, the header shows a "Sign in" button.
 * When signed in, the header shows the Clerk UserButton.
 *
 * A sign-in/sign-up modal can be triggered from the header button.
 */
export default function AuthGate({ children }) {
  // Transparent wrapper — always render children.
  // Clerk context is available via useAuth/useUser in any descendant.
  return children;
}

/**
 * Header auth controls for the hosted web app.
 * Shows Sign In button when signed out, UserButton when signed in.
 */
export function WebUserButton() {
  const { isSignedIn, isLoaded } = useAuth();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authView, setAuthView] = useState('sign-in');

  if (!isLoaded) return null;

  if (isSignedIn) {
    return (
      <UserButton
        afterSignOutUrl="/app/"
        appearance={{
          elements: {
            avatarBox: { width: '28px', height: '28px' },
          },
        }}
      />
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => { setShowAuthModal(true); setAuthView('sign-in'); }}
        className="ui-control px-2.5 py-1 rounded-lg text-xs font-semibold bg-violet-600 hover:bg-violet-500 text-white transition-colors"
      >
        Sign in
      </button>

      {showAuthModal && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            backgroundColor: 'rgba(2, 6, 23, 0.85)',
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowAuthModal(false); }}
        >
          <div style={{ position: 'relative', maxWidth: '420px', width: '100%' }}>
            <button
              type="button"
              onClick={() => setShowAuthModal(false)}
              style={{
                position: 'absolute', top: '-2rem', right: 0,
                background: 'none', border: 'none', color: '#94a3b8',
                fontSize: '1.25rem', cursor: 'pointer', padding: '0.25rem',
              }}
              aria-label="Close"
            >
              ✕
            </button>

            {authView === 'sign-in' ? (
              <SignIn
                routing="hash"
                afterSignInUrl="/app/"
                appearance={{ elements: { rootBox: { width: '100%' } } }}
              />
            ) : (
              <SignUp
                routing="hash"
                afterSignUpUrl="/app/"
                appearance={{ elements: { rootBox: { width: '100%' } } }}
              />
            )}

            <div style={{ textAlign: 'center', marginTop: '0.75rem' }}>
              <button
                type="button"
                onClick={() => setAuthView(authView === 'sign-in' ? 'sign-up' : 'sign-in')}
                style={{
                  background: 'none', border: 'none', color: '#7c3aed',
                  fontSize: '0.8125rem', cursor: 'pointer', padding: '0.5rem',
                  fontFamily: 'system-ui, -apple-system, sans-serif',
                }}
              >
                {authView === 'sign-in' ? 'Need an account? Sign up' : 'Already have an account? Sign in'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
