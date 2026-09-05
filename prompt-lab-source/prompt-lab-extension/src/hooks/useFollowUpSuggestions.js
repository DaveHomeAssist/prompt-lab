import { useEffect, useRef, useState } from 'react';
import { callModel } from '../api';
import { extractTextFromAnthropic } from '../promptUtils';
import { normalizeError } from '../lib/errorTaxonomy.js';
import { buildFollowUpPayload, parseFollowUpSuggestions } from '../lib/followUpSuggestions.js';
import { normalizeFollowUpOrigin } from '../lib/followUpProvenance.js';
import useSensitivePreflight from './useSensitivePreflight.js';

export default function useFollowUpSuggestions({ raw, enhanced, source = null }) {
  const [followUps, setFollowUps] = useState([]);
  const [followUpsLoading, setFollowUpsLoading] = useState(false);
  const [followUpsError, setFollowUpsError] = useState('');
  const active = useRef(null);
  const preflight = useSensitivePreflight();
  const ownerKey = JSON.stringify([raw, enhanced, source]);
  const owner = useRef(ownerKey);
  owner.current = ownerKey;
  const previousOwner = useRef(ownerKey);

  useEffect(() => {
    if (previousOwner.current !== ownerKey) {
      previousOwner.current = ownerKey;
      preflight.invalidate();
      setFollowUps([]);
      setFollowUpsError('');
      setFollowUpsLoading(false);
    }
    return () => {
      active.current?.controller.abort();
      active.current = null;
    };
  }, [ownerKey]);

  const fetchFollowUps = async () => {
    const payload = buildFollowUpPayload({ raw, enhanced, source });
    if (!payload.messages[0].content || active.current) return;
    const sourceSnapshot = source ? JSON.parse(JSON.stringify(source)) : { kind: enhanced ? 'enhanced-prompt' : 'draft-prompt' };
    const execute = async (approvedPayload) => {
      if (owner.current !== ownerKey || active.current) return;
      const attempt = { id: crypto.randomUUID(), controller: new AbortController() };
      active.current = attempt;
      const isCurrent = () => active.current === attempt && owner.current === ownerKey && !attempt.controller.signal.aborted;
      const generatedAt = new Date().toISOString();
      setFollowUpsLoading(true);
      setFollowUpsError('');
      try {
        const data = await callModel(approvedPayload, { signal: attempt.controller.signal });
        if (!isCurrent()) return;
        const origin = normalizeFollowUpOrigin({
          generationId: attempt.id, generatedAt,
          generationProvider: data?.provider, generationModel: data?.model,
          sourceKind: sourceSnapshot.kind, sourcePromptId: sourceSnapshot.promptId,
          sourcePromptVersionId: sourceSnapshot.promptVersionId, sourceRunId: sourceSnapshot.runId,
          sourceCandidateId: sourceSnapshot.candidateId, sourceTitle: sourceSnapshot.title,
          sourceProvider: sourceSnapshot.provider, sourceModel: sourceSnapshot.model,
          redacted: approvedPayload.messages[0].content !== payload.messages[0].content,
        });
        const parsed = parseFollowUpSuggestions(extractTextFromAnthropic(data));
        setFollowUps(parsed.map((suggestion, index) => ({ ...suggestion, id: `${attempt.id}:${index}`, origin })));
        if (!parsed.length) setFollowUpsError('No follow-up suggestions came back. Try again.');
      } catch (caught) {
        if (!isCurrent()) return;
        const appError = normalizeError(caught, 'execution');
        setFollowUpsError(appError.userMessage || 'Could not fetch follow-up suggestions.');
      } finally {
        if (active.current === attempt) {
          active.current = null;
          setFollowUpsLoading(false);
        }
      }
    };
    const reviewed = preflight.review({ payload, scope: 'follow-ups', label: 'Follow-up suggestions',
      isCurrent: () => owner.current === ownerKey, resume: execute });
    if (reviewed.payload) return execute(reviewed.payload);
  };

  const clearFollowUps = () => {
    active.current?.controller.abort();
    active.current = null;
    preflight.invalidate();
    setFollowUps([]);
    setFollowUpsError('');
    setFollowUpsLoading(false);
  };

  return { followUps, followUpsLoading, followUpsError, fetchFollowUps, clearFollowUps,
    piiWarning: preflight.piiWarning, piiSendAnyway: preflight.piiSendAnyway,
    piiRedactAndSend: preflight.piiRedactAndSend, piiCancel: preflight.piiCancel };
}
