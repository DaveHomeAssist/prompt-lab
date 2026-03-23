import React from 'react';
import ReactDOM from 'react-dom/client';
import { ClerkProvider } from '@clerk/clerk-react';
import App from '../../prompt-lab-extension/src/App';
import ErrorBoundary from '../../prompt-lab-extension/src/ErrorBoundary';
import { WebSlotProvider } from '../../prompt-lab-extension/src/WebSlotContext';
import { WebUserButton } from './AuthGate';
import { EntitlementProvider } from './useEntitlements';
import '../../prompt-lab-extension/src/index.css';

const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

const clerkAppearance = {
  baseTheme: undefined,
  variables: {
    colorPrimary: '#7c3aed',
    colorBackground: '#0f172a',
    colorText: '#e2e8f0',
    colorInputBackground: '#1e293b',
    colorInputText: '#e2e8f0',
    borderRadius: '0.5rem',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  elements: {
    card: { backgroundColor: '#0f172a', border: '1px solid #334155' },
    headerTitle: { color: '#e2e8f0' },
    headerSubtitle: { color: '#94a3b8' },
    socialButtonsBlockButton: { border: '1px solid #334155' },
    formButtonPrimary: { backgroundColor: '#7c3aed', '&:hover': { backgroundColor: '#6d28d9' } },
    footerActionLink: { color: '#7c3aed' },
  },
};

/**
 * Web root — BYOK model.
 *
 * The app always renders for all users. Clerk provides optional auth context.
 * When signed in, EntitlementProvider resolves premium features.
 * When signed out, all entitlements fail safe to free tier.
 * The header shows "Sign in" (signed out) or UserButton (signed in).
 */
function WebRoot() {
  if (!CLERK_PUBLISHABLE_KEY) {
    return (
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    );
  }

  return (
    <ClerkProvider
      publishableKey={CLERK_PUBLISHABLE_KEY}
      appearance={clerkAppearance}
    >
      <ErrorBoundary>
        <EntitlementProvider>
          <WebSlotProvider value={{ UserButton: WebUserButton }}>
            <App />
          </WebSlotProvider>
        </EntitlementProvider>
      </ErrorBoundary>
    </ClerkProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<WebRoot />);
