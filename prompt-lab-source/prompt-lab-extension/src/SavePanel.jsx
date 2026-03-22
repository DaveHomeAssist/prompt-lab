import Ic from './icons';
import { ALL_TAGS } from './constants';
import TagChip from './TagChip';

export default function SavePanel({
  m,
  compact,
  showSave,
  closeSavePanel,
  saveTargetId,
  saveTitle,
  setSaveTitle,
  saveCollection,
  setSaveCollection,
  saveTags,
  setSaveTags,
  changeNote,
  setChangeNote,
  newCollName,
  setNewCollName,
  showNewColl,
  setShowNewColl,
  collections,
  commitNewCollection,
  doSave,
  canSavePanel,
  primaryModKey,
}) {
  if (!showSave) return null;

  return (
    <aside
      className={`pl-modal-panel fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l ${m.border} ${m.modal} shadow-2xl`}
      role="dialog"
      aria-modal="false"
      aria-labelledby="save-panel-title"
    >
      <div className={`flex items-start justify-between gap-3 border-b ${m.border} px-4 py-4`}>
        <div>
          <p id="save-panel-title" className={`text-sm font-semibold ${m.text}`}>
            {saveTargetId ? 'Update Prompt' : 'Save to Library'}
          </p>
          <p className={`mt-1 text-xs ${m.textMuted}`}>
            Keep editing in the background while you set title, collection, and tags.
          </p>
        </div>
        <button
          type="button"
          onClick={closeSavePanel}
          className={`ui-control rounded-lg p-2 ${m.btn} ${m.textAlt} transition-colors hover:text-violet-400`}
          aria-label="Close save panel"
        >
          <Ic n="X" size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="flex flex-col gap-4">
          <div>
            <label className={`mb-1.5 block text-xs font-semibold uppercase tracking-wider ${m.textSub}`}>Title</label>
            <input
              autoFocus
              className={`${m.input} w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500 ${m.text}`}
              placeholder="Prompt title…"
              value={saveTitle}
              onChange={(e) => setSaveTitle(e.target.value)}
            />
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <label className={`block text-xs font-semibold uppercase tracking-wider ${m.textSub}`}>Collection</label>
              {!showNewColl && (
                <button
                  type="button"
                  onClick={() => setShowNewColl(true)}
                  className={`ui-control inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold transition-colors ${m.btn} ${m.textAlt}`}
                >
                  <Ic n="Plus" size={11} />
                  New
                </button>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <select
                value={saveCollection}
                onChange={(e) => setSaveCollection(e.target.value)}
                className={`${m.input} w-full border rounded-lg px-3 py-2 text-sm ${m.text} focus:outline-none focus:border-violet-500`}
              >
                <option value="">No Collection</option>
                {collections.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              {showNewColl && (
                <div className="flex gap-2">
                  <input
                    autoFocus
                    className={`flex-1 ${m.input} border rounded-lg px-3 py-2 text-sm ${m.text} focus:outline-none focus:border-violet-500`}
                    placeholder="New collection name…"
                    value={newCollName}
                    onChange={(e) => setNewCollName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitNewCollection();
                      if (e.key === 'Escape') {
                        setNewCollName('');
                        setShowNewColl(false);
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={commitNewCollection}
                    className="ui-control rounded-lg bg-violet-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-violet-500"
                  >
                    Add
                  </button>
                </div>
              )}
            </div>
          </div>

          <div>
            <p className={`mb-2 text-xs font-semibold uppercase tracking-wider ${m.textSub}`}>Tags</p>
            <div className="flex flex-wrap gap-1.5">
              {ALL_TAGS.map((t) => (
                <TagChip
                  key={t}
                  tag={t}
                  selected={saveTags.includes(t)}
                  onClick={() => setSaveTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]))}
                />
              ))}
            </div>
          </div>

          {saveTargetId && (
            <div>
              <label className={`mb-1.5 block text-xs font-semibold uppercase tracking-wider ${m.textSub}`}>Change Note</label>
              <input
                className={`${m.input} w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 ${m.text}`}
                placeholder="What changed? (optional)"
                value={changeNote}
                onChange={(e) => setChangeNote(e.target.value)}
              />
            </div>
          )}
        </div>
      </div>

      <div className={`border-t ${m.border} px-4 py-4`}>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => doSave()}
            disabled={!canSavePanel}
            className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-green-600 py-2 text-sm font-semibold text-white transition-colors hover:bg-green-500 disabled:opacity-40"
          >
            <Ic n="Save" size={12} />
            Save {primaryModKey}+S
          </button>
          <button
            type="button"
            onClick={closeSavePanel}
            className={`ui-control rounded-lg px-4 text-sm transition-colors ${m.btn} ${m.textBody}`}
          >
            Close
          </button>
        </div>
      </div>
    </aside>
  );
}
