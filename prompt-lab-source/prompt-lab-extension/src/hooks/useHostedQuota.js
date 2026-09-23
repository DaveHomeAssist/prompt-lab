import { useEffect, useState } from 'react';
import {
  HOSTED_QUOTA_CHANGED,
  HOSTED_QUOTA_STORAGE_KEY,
  getHostedQuota,
  nextHostedQuotaReset,
  resetHostedQuotaCache,
} from '../lib/hostedQuota.js';

// setTimeout overflows past ~24.8 days; windows here are at most a day.
const MAX_TIMER_MS = 2 ** 31 - 1;

/** The live hosted quota snapshot; re-renders on new data and at resets. */
export default function useHostedQuota() {
  const [quota, setQuota] = useState(() => getHostedQuota());

  useEffect(() => {
    const refresh = () => setQuota(getHostedQuota());
    const onStorage = (event) => {
      if (event.key !== HOSTED_QUOTA_STORAGE_KEY) return;
      resetHostedQuotaCache();
      refresh();
    };
    window.addEventListener(HOSTED_QUOTA_CHANGED, refresh);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(HOSTED_QUOTA_CHANGED, refresh);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  // Drop a window from view once its reset time passes.
  useEffect(() => {
    const resetAt = nextHostedQuotaReset();
    if (resetAt == null) return undefined;
    const timer = setTimeout(
      () => setQuota(getHostedQuota()),
      Math.min(MAX_TIMER_MS, Math.max(0, resetAt - Date.now()) + 1000),
    );
    return () => clearTimeout(timer);
  }, [quota]);

  return quota;
}
