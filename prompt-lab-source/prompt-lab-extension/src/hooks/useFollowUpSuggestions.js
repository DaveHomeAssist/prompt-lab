import { useEffect, useMemo, useRef, useState } from 'react';
import { callModel } from '../api';
import { extractTextFromAnthropic } from '../promptUtils';
import { normalizeError } from '../lib/errorTaxonomy.js';
import {
  buildFollowUpPayload,
  parseFollowUpSuggestions,
  resolveFollowUpSource,
} from '../lib/followUpSuggestions.js';

/**
 * On-demand follow-up prompt suggestions for the selected successful run,
 * enhanced prompt, or raw draft (in that order).
 */
export default function useFollowUpSuggestions({ raw, enhanced, sourceRun = null, sourcePromptId = null }) {
  const [followUps, setFollowUps] = useState([]);
  const [followUpsLoading, setFollowUpsLoading] = useState(false);
  const [followUpsError, setFollowUpsError] = useState('');
  const reqRef = useRef(0);
  const source = useMemo(
    () => resolveFollowUpSource({ raw, enhanced, sourceRun, sourcePromptId }),
    [enhanced, raw, sourcePromptId, sourceRun],
  );
  const lastSourceKeyRef = useRef(source.key);

  useEffect(() => {
    if (lastSourceKeyRef.current === source.key) return;
    lastSourceKeyRef.current = source.key;
    reqRef.current += 1;
    setFollowUps([]);
    setFollowUpsError('');
    setFollowUpsLoading(false);
  }, [source.key]);

  const fetchFollowUps = async () => {
    if (!source.text || followUpsLoading) return;

    const reqId = reqRef.current + 1;
    reqRef.current = reqId;
    setFollowUpsLoading(true);
    setFollowUpsError('');
    try {
      const data = await callModel(buildFollowUpPayload({ source }));
      if (reqId !== reqRef.current) return;
      const parsed = parseFollowUpSuggestions(extractTextFromAnthropic(data));
      const generatedAt = new Date().toISOString();
      setFollowUps(parsed.map((suggestion) => ({ ...suggestion, source, generatedAt })));
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

  return {
    source,
    canSuggest: Boolean(source.text),
    followUps,
    followUpsLoading,
    followUpsError,
    fetchFollowUps,
    clearFollowUps,
  };
}
