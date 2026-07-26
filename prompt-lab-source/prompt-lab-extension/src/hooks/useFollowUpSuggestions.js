import { useEffect, useRef, useState } from 'react';
import { callModel } from '../api';
import { extractTextFromAnthropic } from '../promptUtils';
import { normalizeError } from '../lib/errorTaxonomy.js';
import { buildFollowUpPayload, parseFollowUpSuggestions } from '../lib/followUpSuggestions.js';

/**
 * On-demand follow-up prompt suggestions for the current enhance result.
 * Suggestions invalidate whenever the enhanced output changes so stale chains
 * are never offered against a new result.
 */
export default function useFollowUpSuggestions({ raw, enhanced }) {
  const [followUps, setFollowUps] = useState([]);
  const [followUpsLoading, setFollowUpsLoading] = useState(false);
  const [followUpsError, setFollowUpsError] = useState('');
  const reqRef = useRef(0);
  const lastEnhancedRef = useRef(enhanced);

  useEffect(() => {
    if (lastEnhancedRef.current === enhanced) return;
    lastEnhancedRef.current = enhanced;
    reqRef.current += 1;
    setFollowUps([]);
    setFollowUpsError('');
    setFollowUpsLoading(false);
  }, [enhanced]);

  const fetchFollowUps = async () => {
    const source = String(enhanced || raw || '').trim();
    if (!source || followUpsLoading) return;

    const reqId = reqRef.current + 1;
    reqRef.current = reqId;
    setFollowUpsLoading(true);
    setFollowUpsError('');
    try {
      const data = await callModel(buildFollowUpPayload({ raw, enhanced }));
      if (reqId !== reqRef.current) return;
      const parsed = parseFollowUpSuggestions(extractTextFromAnthropic(data));
      setFollowUps(parsed);
      if (parsed.length === 0) {
        setFollowUpsError('No follow-up suggestions came back. Try again.');
      }
    } catch (caught) {
      if (reqId !== reqRef.current) return;
      const appError = normalizeError(caught, 'execution');
      setFollowUpsError(appError.userMessage || 'Could not fetch follow-up suggestions.');
    } finally {
      if (reqId === reqRef.current) setFollowUpsLoading(false);
    }
  };

  const clearFollowUps = () => {
    reqRef.current += 1;
    setFollowUps([]);
    setFollowUpsError('');
    setFollowUpsLoading(false);
  };

  return { followUps, followUpsLoading, followUpsError, fetchFollowUps, clearFollowUps };
}
