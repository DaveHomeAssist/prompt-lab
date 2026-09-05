import { useEffect, useRef, useState } from 'react';
import { getEvalRunById } from './experimentStore.js';
import { describeFollowUpSource } from './lib/followUpProvenance.js';

export default function FollowUpOrigin({ origin, library = [], onOpenParent, m }) {
  const [sourceOutput, setSourceOutput] = useState(null);
  const [sourceError, setSourceError] = useState('');
  const identity = JSON.stringify(origin);
  const owner = useRef(identity);
  owner.current = identity;
  useEffect(() => {
    owner.current = identity;
    setSourceOutput(null);
    setSourceError('');
    return () => { owner.current = null; };
  }, [identity]);
  if (!origin) return null;
  const parent = library.find(entry => entry.id === origin.sourcePromptId);
  const showOutput = async () => {
    setSourceError('');
    setSourceOutput(null);
    try {
      let output = null;
      if (origin.sourceRunId) {
        const run = await getEvalRunById(origin.sourceRunId);
        output = origin.sourceCandidateId
          ? run?.candidates?.find(candidate => candidate.id === origin.sourceCandidateId)?.content
          : run?.output;
      } else if (origin.sourcePromptVersionId && parent) {
        const version = parent.currentVersionId === origin.sourcePromptVersionId
          ? parent : parent.versions?.find(item => item.id === origin.sourcePromptVersionId);
        output = origin.sourceKind === 'draft-prompt' ? version?.original : version?.enhanced;
      }
      if (!output) throw new Error('The original source output is unavailable on this device. Its reference is retained.');
      if (owner.current === identity) setSourceOutput(output);
    } catch (error) { if (owner.current === identity) setSourceError(error.message || 'Unable to load the source output.'); }
  };
  return (
    <section aria-label="Follow-up provenance" className={`rounded-lg border ${m.border} p-2 text-xs ${m.textSub}`}>
      <p className={`font-semibold ${m.textBody}`}>From {describeFollowUpSource(origin)}: {origin.sourceTitle || parent?.title || 'Unsaved or external source'}</p>
      <p>Source model: {origin.sourceModel || 'Unknown'} · Suggested by {origin.generationProvider || 'Unknown'} / {origin.generationModel || 'Unknown'}</p>
      {origin.sourceRunId && <p className="break-all">Run: {origin.sourceRunId}</p>}
      {origin.generatedAt && <p>Suggested {new Date(origin.generatedAt).toLocaleString()}</p>}
      {origin.redacted && <p>The source was redacted before suggestion generation.</p>}
      {origin.unresolvedReferences && <p>Some source references were not included in this import.</p>}
      <div className="mt-1 flex flex-wrap gap-2">
        {parent && onOpenParent && <button type="button" onClick={() => onOpenParent(parent)} className={`min-h-11 rounded px-2 ${m.btn} ${m.textBody}`}>Open parent prompt</button>}
        <button type="button" onClick={showOutput} className={`min-h-11 rounded px-2 ${m.btn} ${m.textBody}`}>View source output</button>
      </div>
      {sourceError && <p role="status" className="mt-1 text-amber-500">{sourceError}</p>}
      {sourceOutput && <pre className={`mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words ${m.textBody}`}>{sourceOutput}</pre>}
    </section>
  );
}
