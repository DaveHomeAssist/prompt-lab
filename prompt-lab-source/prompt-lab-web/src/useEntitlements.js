import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';

const FREE_STATE = {
  plan: 'free',
  entitlements: [],
  isLoaded: false,
  error: null,
};

const EntitlementContext = createContext(FREE_STATE);

/**
 * Fetches entitlements from /api/entitlements using the Clerk session token.
 * Caches in React context so all consumers share one fetch.
 */
export function EntitlementProvider({ children }) {
  const { getToken, isSignedIn, isLoaded: authLoaded } = useAuth();
  const [state, setState] = useState(FREE_STATE);

  const refresh = useCallback(async () => {
    if (!isSignedIn) {
      setState({ ...FREE_STATE, isLoaded: true });
      return;
    }

    try {
      const token = await getToken();
      const res = await fetch('/api/entitlements', {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        setState({ ...FREE_STATE, isLoaded: true, error: `HTTP ${res.status}` });
        return;
      }

      const data = await res.json();
      setState({
        plan: data.plan || 'free',
        entitlements: Array.isArray(data.entitlements) ? data.entitlements : [],
        isLoaded: true,
        error: null,
      });
    } catch (err) {
      setState({ ...FREE_STATE, isLoaded: true, error: err.message });
    }
  }, [getToken, isSignedIn]);

  useEffect(() => {
    if (authLoaded) refresh();
  }, [authLoaded, refresh]);

  const value = useMemo(() => ({ ...state, refresh }), [state, refresh]);

  return (
    <EntitlementContext.Provider value={value}>
      {children}
    </EntitlementContext.Provider>
  );
}

/**
 * Returns entitlement state and a `can(featureKey)` helper.
 * Falls safe: returns false for any feature when entitlements are unavailable.
 */
export default function useEntitlements() {
  const ctx = useContext(EntitlementContext);
  const entitlementSet = useMemo(
    () => new Set(ctx.entitlements),
    [ctx.entitlements],
  );

  const can = useCallback(
    (featureKey) => entitlementSet.has(featureKey),
    [entitlementSet],
  );

  return {
    plan: ctx.plan,
    entitlements: ctx.entitlements,
    isLoaded: ctx.isLoaded,
    error: ctx.error,
    can,
    refresh: ctx.refresh,
  };
}
