import { useEffect } from 'react';
import Ic from './icons';
import { wordDiff } from './promptUtils';
import { getPromptSnapshot } from './lib/promptSchema.js';

function DiffTokens({ fromText, toText, m }) {
  const segments = wordDiff(fromText, toText);
  return (
    <div className={`text-xs leading-relaxed ${m.codeBlock} rounded-lg p-3 whitespace-pre-wrap break-words`}>
      {segments.map((segment, index) => (
        <span
          key={`${segment.t}-${index}`}
          className={`${segment.t === 'add' ? m.diffAdd : segment.t === 'del' ? m.diffDel : m.diffEq} px-0.5 rounded mr-0.5`}
        >
          {segment.v}
        </span>
      ))}
    </div>
  );
}

function SnapshotPane({ label, snapshot, m }) {
  const sections = [
    ['Enhanced', snapshot?.enhanced],
    ['Original', snapshot?.original],
    ['Notes', snapshot?.notes],
  ].filter(([, value]) => typeof value === 'string' && value.trim());

  return (
    <div className={`${m.surface} border ${m.border} rounded-xl p-4 flex flex-col gap-3 min-h-0`}>
      <div className="flex items-center justify-between gap-3">
        <h3 className={`text-sm font-semibold ${m.text}`}>{label}</h3>
      </div>
      {sections.length === 0 ? (
        <p className={`text-xs ${m.textMuted}`}>No content saved for this snapshot.</p>
      ) : (
        sections.map(([title, value]) => (
          <div key={title} className="min-h-0">
            <p className={`text-[11px] font-semibold uppercase tracking-wider ${m.textSub} mb-1.5`}>{title}</p>
            <div className={`text-xs ${m.textBody} ${m.codeBlock} rounded-lg p-3 whitespace-pre-wrap break-words max-h-40 overflow-y-auto`}>
              {value}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

export default function VersionDiffModal({
  entry,
  selectedIndex,
  onSelectIndex,
  onClose,
  onRestore,
  m,
}) {
  const versions = Array.isArray(entry?.versions) ? [...entry.versions].reverse() : [];
  const safeIndex = versions.length === 0 ? 0 : Math.min(Math.max(selectedIndex ?? 0, 0), versions.length - 1);
  const selectedVersion = versions[safeIndex] || null;
  const currentSnapshot = entry ? getPromptSnapshot(entry) : null;

  useEffect(() => {
    if (!entry) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [entry, onClose]);

  useEffect(() => {
    if (entry && versions.length > 0 && selectedIndex == null) {
      onSelectIndex?.(0);
    }
  }, [entry, onSelectIndex, selectedIndex, versions.length]);

  if (!entry) return null;

  const handleRestore = () => {
    if (!selectedVersion) return;
    const confirmed = window.confirm(`Restore "${entry.title}" to the snapshot from ${new Date(selectedVersion.savedAt).toLocaleString()}?`);
    if (!confirmed) return;
    onRestore?.(selectedVersion);
    onClose?.();
  };

  return (
    <div className={`fixed inset-0 ${m.modalBg} z-50 flex items-center justify-center p-4`} onClick={onClose}>
      <div
        className={`${m.modal} border rounded-2xl w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="version-history-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className={`px-5 py-4 border-b ${m.border} flex items-center justify-between gap-4`}>
          <div className="min-w-0">
            <p className={`text-[11px] uppercase tracking-[0.18em] font-semibold text-blue-400 mb-1`}>Version History</p>
            <h2 id="version-history-title" className={`text-base font-semibold ${m.text} truncate`}>{entry.title}</h2>
            <p className={`text-xs ${m.textMuted} mt-1`}>
              {versions.length} saved snapshot{versions.length === 1 ? '' : 's'}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleRestore}
              disabled={!selectedVersion}
              className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Ic n="RotateCcw" size={11} />
              Restore This Version
            </button>
            <button type="button" onClick={onClose} className={`rounded-lg p-2 ${m.btn} ${m.textAlt}`} aria-label="Close version history">
              <Ic n="X" size={14} />
            </button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[280px,1fr]">
          <aside className={`border-b lg:border-b-0 lg:border-r ${m.border} p-3 flex flex-col min-h-0`}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className={`text-[11px] uppercase tracking-wider font-semibold ${m.textSub}`}>Snapshots</p>
              <span className={`text-xs ${m.textMuted}`}>Newest first</span>
            </div>
            <div className="flex-1 overflow-y-auto flex flex-col gap-2 pr-1">
              {versions.map((version, index) => {
                const active = index === safeIndex;
                return (
                  <button
                    key={version.id || `${version.savedAt}-${index}`}
                    type="button"
                    onClick={() => onSelectIndex?.(index)}
                    className={`rounded-xl border p-3 text-left transition-colors ${active ? 'border-violet-500 bg-violet-500/10' : `${m.border} ${m.btn}`}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-xs font-semibold ${m.text}`}>Snapshot {versions.length - index}</span>
                      {version.source && (
                        <span className={`rounded px-1.5 py-0.5 text-[10px] ${version.source === 'restore' ? 'bg-blue-500/15 text-blue-400' : 'bg-violet-500/15 text-violet-400'}`}>
                          {version.source}
                        </span>
                      )}
                    </div>
                    <p className={`text-xs ${m.textMuted} mt-1`}>{new Date(version.savedAt).toLocaleString()}</p>
                    {version.changeNote && (
                      <p className={`text-xs ${m.textAlt} mt-2 line-clamp-2`}>{version.changeNote}</p>
                    )}
                    {!version.changeNote && (
                      <p className={`text-xs ${m.textAlt} mt-2 line-clamp-2`}>{version.enhanced}</p>
                    )}
                  </button>
                );
              })}
            </div>
          </aside>

          <section className="min-h-0 overflow-y-auto p-4 flex flex-col gap-4">
            {selectedVersion ? (
              <>
                <div className={`${m.surface} border ${m.border} rounded-xl p-4`}>
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <span className={`text-xs ${m.textMuted}`}>{new Date(selectedVersion.savedAt).toLocaleString()}</span>
                    {selectedVersion.source && (
                      <span className={`rounded px-1.5 py-0.5 text-[10px] ${selectedVersion.source === 'restore' ? 'bg-blue-500/15 text-blue-400' : 'bg-violet-500/15 text-violet-400'}`}>
                        {selectedVersion.source}
                      </span>
                    )}
                  </div>
                  {selectedVersion.changeNote ? (
                    <p className={`text-sm ${m.textBody}`}>{selectedVersion.changeNote}</p>
                  ) : (
                    <p className={`text-sm ${m.textMuted}`}>No change note saved for this snapshot.</p>
                  )}
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  <SnapshotPane label="Selected Version" snapshot={selectedVersion} m={m} />
                  <SnapshotPane label="Current Prompt" snapshot={currentSnapshot} m={m} />
                </div>

                <div className={`${m.surface} border ${m.border} rounded-xl p-4 flex flex-col gap-4`}>
                  <div>
                    <p className={`text-[11px] font-semibold uppercase tracking-wider ${m.textSub} mb-2`}>Enhanced Diff</p>
                    <DiffTokens fromText={selectedVersion.enhanced} toText={currentSnapshot?.enhanced} m={m} />
                  </div>
                  {(selectedVersion.original || currentSnapshot?.original) && (
                    <div>
                      <p className={`text-[11px] font-semibold uppercase tracking-wider ${m.textSub} mb-2`}>Original Diff</p>
                      <DiffTokens fromText={selectedVersion.original} toText={currentSnapshot?.original} m={m} />
                    </div>
                  )}
                  {(selectedVersion.notes || currentSnapshot?.notes) && (
                    <div>
                      <p className={`text-[11px] font-semibold uppercase tracking-wider ${m.textSub} mb-2`}>Notes Diff</p>
                      <DiffTokens fromText={selectedVersion.notes} toText={currentSnapshot?.notes} m={m} />
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className={`${m.surface} border ${m.border} rounded-xl p-6`}>
                <p className={`text-sm ${m.textMuted}`}>No version snapshots are available for this prompt.</p>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
