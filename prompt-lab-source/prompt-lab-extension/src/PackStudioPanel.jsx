import { useMemo, useState } from 'react';
import Ic from './icons';
import { reconcilePacks, removePack, upsertPack } from './lib/packStore.js';
import { exportPackFromEntries } from './lib/packExport.js';

/**
 * Pack Studio — list installed/authored packs, publish selected prompts as a
 * schema-valid pack file, and uninstall a pack's entries in one action.
 */
export default function PackStudioPanel({ m, lib, compact = false, onClose }) {
  const [packTitle, setPackTitle] = useState('');
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [refreshTick, setRefreshTick] = useState(0);
  const [statusLine, setStatusLine] = useState('');

  const packs = useMemo(
    () => reconcilePacks(lib.library),
    // refreshTick forces a registry re-read after uninstall/publish.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lib.library, refreshTick],
  );

  const toggleSelected = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const publishPack = () => {
    const entries = lib.library.filter((entry) => selectedIds.has(entry.id));
    if (entries.length === 0 || !packTitle.trim()) return;
    const pack = exportPackFromEntries(entries, { title: packTitle });
    upsertPack({ id: pack.id, title: pack.title, version: pack.version, source: 'authored' });
    const url = URL.createObjectURL(new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' }));
    const anchor = Object.assign(document.createElement('a'), { href: url, download: `${pack.id}-v${pack.version}.json` });
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    setStatusLine(`Exported ${entries.length} prompts as ${pack.title}.`);
    setPackTitle('');
    setSelectedIds(new Set());
    setRefreshTick((tick) => tick + 1);
  };

  const uninstallPack = (pack) => {
    if (!window.confirm(`Remove pack "${pack.title}" and its ${pack.entryCount} prompts from your library?`)) return;
    const removed = lib.removeEntriesByPackId?.(pack.id) ?? 0;
    removePack(pack.id);
    setStatusLine(removed > 0 ? `Removed ${removed} prompts from ${pack.title}.` : `Removed pack ${pack.title}.`);
    setRefreshTick((tick) => tick + 1);
  };

  return (
    <div className={`border-b ${m.border} ${m.surface} p-3 flex flex-col gap-3 ${compact ? '' : 'max-h-96 overflow-y-auto'}`}>
      <div className="flex items-center justify-between">
        <p className={`text-xs font-semibold ${m.textSub} uppercase tracking-wider flex items-center gap-1.5`}>
          <Ic n="Layers" size={12} />Pack Studio
        </p>
        <button type="button" onClick={onClose} aria-label="Close pack studio" className={`ui-control px-2 py-1 rounded-lg text-xs ${m.btn} ${m.textAlt} transition-colors`}>Close</button>
      </div>
      {statusLine && <p className={`text-xs ${m.textSub}`} role="status">{statusLine}</p>}

      <section>
        <p className={`text-xs font-semibold ${m.text} mb-1.5`}>Installed packs</p>
        {packs.length === 0 && (
          <p className={`text-xs ${m.textMuted}`}>No packs yet. Load a starter library, import a pack file, or publish one below.</p>
        )}
        <div className="flex flex-col gap-1.5">
          {packs.map((pack) => (
            <div key={pack.id} className={`flex items-center justify-between gap-2 border ${m.border} rounded-lg px-2.5 py-1.5 text-xs`}>
              <div className="min-w-0">
                <span className={`font-semibold ${m.text} truncate block`}>{pack.title}</span>
                <span className={m.textMuted}>{pack.entryCount} prompts · {pack.source}{pack.version ? ` · v${pack.version}` : ''}</span>
              </div>
              <button type="button" onClick={() => uninstallPack(pack)}
                className="ui-control px-2 py-1 rounded-lg text-xs bg-red-500/10 text-red-300 hover:bg-red-500/20 transition-colors shrink-0">
                Uninstall
              </button>
            </div>
          ))}
        </div>
      </section>

      <section>
        <p className={`text-xs font-semibold ${m.text} mb-1.5`}>Publish a pack</p>
        <input
          value={packTitle}
          onChange={(e) => setPackTitle(e.target.value)}
          placeholder="Pack name…"
          aria-label="New pack name"
          className={`w-full ${m.input} border rounded-lg px-2 py-1.5 text-xs focus:outline-none mb-2 ${m.text}`}
        />
        <div className={`flex flex-col gap-1 max-h-40 overflow-y-auto border ${m.border} rounded-lg p-2`}>
          {lib.library.length === 0 && <p className={`text-xs ${m.textMuted}`}>Library is empty.</p>}
          {lib.library.map((entry) => (
            <label key={entry.id} className={`flex items-center gap-2 text-xs ${m.textBody} cursor-pointer`}>
              <input
                type="checkbox"
                checked={selectedIds.has(entry.id)}
                onChange={() => toggleSelected(entry.id)}
              />
              <span className="truncate">{entry.title}</span>
            </label>
          ))}
        </div>
        <button
          type="button"
          onClick={publishPack}
          disabled={selectedIds.size === 0 || !packTitle.trim()}
          className="ui-control mt-2 px-3 py-1.5 rounded-lg text-xs font-semibold bg-orange-500/90 hover:bg-orange-400 disabled:opacity-40 text-white transition-colors">
          Export {selectedIds.size > 0 ? `${selectedIds.size} prompts` : 'pack'} as JSON
        </button>
      </section>
    </div>
  );
}
