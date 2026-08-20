import { useMemo, useState } from 'react';
import Ic from './icons';
import PackStudioPanel from './PackStudioPanel.jsx';

const SMART_VIEWS = [
  ['all', 'Library', 'Library'],
  ['favorites', 'Star', 'Favorites'],
  ['recent', 'Clock', 'Recent'],
  ['frequent', 'Zap', 'Frequent'],
  ['templates', 'Braces', 'Templates'],
  ['incomplete', 'CircleAlert', 'Incomplete'],
];

function entryText(entry) {
  return entry.enhanced || entry.original || '';
}

function isIncomplete(entry) {
  return !entry.title?.trim()
    || !(entry.tags || []).length
    || !entry.metadata?.purpose?.trim()
    || !entry.metadata?.status?.trim();
}

function formatEntryDate(entry) {
  const value = entry.updatedAt || entry.updated_at || entry.createdAt;
  if (!value) return 'Starter';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Saved locally'
    : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function viewEntries(lib, smartView) {
  const source = smartView === 'trash' ? lib.trash : lib.filtered;
  if (smartView === 'favorites') return source.filter((entry) => entry.favorite);
  if (smartView === 'recent') return [...source].sort((a, b) => new Date(b.lastAccessedAt || b.updatedAt) - new Date(a.lastAccessedAt || a.updatedAt));
  if (smartView === 'frequent') return [...source].sort((a, b) => (b.useCount || 0) - (a.useCount || 0));
  if (smartView === 'templates') return source.filter((entry) => (entry.inputs || []).length || (entry.tags || []).includes('template'));
  if (smartView === 'incomplete') return source.filter(isIncomplete);
  return source;
}

export default function LibraryWorkspace({
  m,
  lib,
  loadEntry,
  copy,
  addToComposer,
  sendToABTest,
  openSavePanel,
}) {
  const [smartView, setSmartView] = useState('all');
  const [layout, setLayout] = useState('list');
  const [selectedId, setSelectedId] = useState(null);
  const [checkedIds, setCheckedIds] = useState([]);
  const [bulkTag, setBulkTag] = useState('');
  const [bulkCollection, setBulkCollection] = useState('');
  const [inspectorTab, setInspectorTab] = useState('details');
  const [showPackStudio, setShowPackStudio] = useState(false);
  const entries = useMemo(() => viewEntries(lib, smartView), [lib.filtered, lib.trash, smartView]);
  const selected = (smartView === 'trash' ? lib.trash : lib.library).find((entry) => entry.id === selectedId) || null;
  const allVisibleChecked = entries.length > 0 && entries.every((entry) => checkedIds.includes(entry.id));

  const chooseView = (nextView) => {
    setSmartView(nextView);
    setCheckedIds([]);
    setSelectedId(null);
    if (nextView !== 'trash') {
      lib.setActiveTag(null);
      lib.setActiveCollection(null);
    }
  };

  const toggleChecked = (id) => setCheckedIds((current) => (
    current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
  ));

  const updateSelected = (patch) => {
    if (!selected) return;
    lib.updateEntries([selected.id], (entry) => ({ ...entry, ...patch, updatedAt: new Date().toISOString() }));
  };

  return (
    <div className="pl-library-workspace">
      <aside className="pl-library-rail" aria-label="Library views">
        <div className="pl-library-rail-title">
          <div><p className="pl-eyebrow">Prompt index</p><h2>Library</h2></div>
          <span>{lib.library.length}</span>
        </div>
        <nav>
          {SMART_VIEWS.map(([id, icon, label]) => (
            <button key={id} type="button" aria-current={smartView === id ? 'page' : undefined} onClick={() => chooseView(id)}>
              <Ic n={icon} size={14} /><span>{label}</span>
              {id === 'favorites' && <small>{lib.library.filter((entry) => entry.favorite).length}</small>}
              {id === 'incomplete' && <small>{lib.library.filter(isIncomplete).length}</small>}
            </button>
          ))}
        </nav>

        <section>
          <p className="pl-eyebrow">Collections</p>
          {lib.collections.map((collection) => (
            <button key={collection} type="button" aria-current={lib.activeCollection === collection ? 'page' : undefined} onClick={() => {
              setSmartView('collection');
              lib.setActiveTag(null);
              lib.setActiveCollection(collection);
            }}><Ic n="Folder" size={13} /><span>{collection}</span></button>
          ))}
        </section>

        <section>
          <p className="pl-eyebrow">Tags</p>
          <div className="pl-library-tag-cloud">
            {lib.allLibTags.map((tag) => (
              <button key={tag} type="button" aria-pressed={lib.activeTag === tag} onClick={() => {
                setSmartView('tag');
                lib.setActiveCollection(null);
                lib.setActiveTag(tag);
              }}>#{tag}</button>
            ))}
          </div>
        </section>

        <button type="button" className="pl-trash-link" aria-current={smartView === 'trash' ? 'page' : undefined} onClick={() => chooseView('trash')}>
          <Ic n="Trash2" size={14} /><span>Recently Deleted</span><small>{lib.trash.length}</small>
        </button>
      </aside>

      <main className="pl-library-index">
        <header className="pl-library-toolbar">
          <label className="pl-library-search">
            <span className="sr-only">Search prompts</span><Ic n="Search" size={14} />
            <input data-testid="library-search" value={lib.search} onChange={(event) => lib.setSearch(event.target.value)} placeholder="Search title, text, tags…" />
          </label>
          <select aria-label="Sort prompts" value={lib.sortBy} onChange={(event) => lib.setSortBy(event.target.value)}>
            <option value="newest">Newest</option><option value="oldest">Oldest</option><option value="most-used">Most used</option><option value="a-z">A–Z</option><option value="z-a">Z–A</option><option value="group">Collection</option>
          </select>
          <div className="pl-layout-toggle" aria-label="Library layout">
            <button type="button" aria-pressed={layout === 'list'} onClick={() => setLayout('list')} aria-label="List view"><Ic n="List" size={14} /></button>
            <button type="button" aria-pressed={layout === 'tiles'} onClick={() => setLayout('tiles')} aria-label="Tile view"><Ic n="LayoutGrid" size={14} /></button>
          </div>
          <button type="button" className="pl-secondary-button" onClick={lib.exportLib}><Ic n="Download" size={13} /> Export</button>
          <button type="button" aria-label="Open pack studio" className="pl-secondary-button" onClick={() => setShowPackStudio((value) => !value)}><Ic n="Layers" size={13} /> Packs</button>
          <label className="pl-secondary-button pl-import-button"><Ic n="Upload" size={13} /> Import<input type="file" accept="application/json" onChange={lib.importLib} /></label>
        </header>

        {showPackStudio && <PackStudioPanel m={m} lib={lib} compact onClose={() => setShowPackStudio(false)} />}

        {checkedIds.length > 0 && smartView !== 'trash' && (
          <div className="pl-bulk-bar" role="region" aria-label="Bulk actions">
            <strong>{checkedIds.length} selected</strong>
            <label>Move to<select value={bulkCollection} onChange={(event) => {
              const value = event.target.value;
              setBulkCollection(value);
              if (value) lib.moveEntriesToCollection(checkedIds, value);
            }}><option value="">Choose…</option>{lib.collections.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>Add tag<input value={bulkTag} onChange={(event) => setBulkTag(event.target.value)} onKeyDown={(event) => {
              if (event.key === 'Enter' && bulkTag.trim()) {
                lib.addTagToEntries(checkedIds, bulkTag.trim());
                setBulkTag('');
              }
            }} placeholder="Type + Enter" /></label>
            <button type="button" onClick={() => { lib.deleteEntries(checkedIds); setCheckedIds([]); }}><Ic n="Trash2" size={13} /> Delete</button>
            <button type="button" onClick={() => setCheckedIds([])}>Clear</button>
          </div>
        )}

        <div className="pl-library-index-heading">
          <div>
            <p className="pl-eyebrow">{smartView === 'collection' ? lib.activeCollection : smartView === 'tag' ? `#${lib.activeTag}` : SMART_VIEWS.find(([id]) => id === smartView)?.[2] || 'Library'}</p>
            <h2>{entries.length} {entries.length === 1 ? 'prompt' : 'prompts'}</h2>
          </div>
          {entries.length > 0 && <label><input type="checkbox" checked={allVisibleChecked} onChange={() => setCheckedIds(allVisibleChecked ? [] : entries.map((entry) => entry.id))} /> Select all</label>}
        </div>

        {entries.length === 0 ? (
          <div className="pl-library-empty"><Ic n={smartView === 'trash' ? 'Trash2' : 'Search'} size={22} /><h3>Nothing here yet</h3><p>Change the active view or clear the current search and filters.</p></div>
        ) : (
          <div className={`pl-library-results is-${layout}`}>
            {entries.map((entry) => (
              <article key={entry.id} className="pl-library-card" aria-selected={selectedId === entry.id} onClick={() => setSelectedId(entry.id)}>
                <div className="pl-library-card-select" onClick={(event) => event.stopPropagation()}>
                  <input type="checkbox" aria-label={`Select ${entry.title}`} checked={checkedIds.includes(entry.id)} onChange={() => toggleChecked(entry.id)} />
                </div>
                <div className="pl-library-card-copy">
                  <div className="pl-library-card-title"><h3>{entry.title}</h3>{entry.favorite && <Ic n="Star" size={12} className="text-amber-400" />}{entry.metadata?.suite?.verdict && <span title={`Test suite: ${entry.metadata.suite.passed}/${entry.metadata.suite.total} passed (${new Date(entry.metadata.suite.lastRunAt).toLocaleString()})`} className={entry.metadata.suite.verdict === 'pass' ? 'pl-suite-pass' : 'pl-suite-fail'}>{entry.metadata.suite.verdict === 'pass' ? '✓ suite' : '✗ suite'}</span>}</div>
                  <p>{entryText(entry).slice(0, layout === 'tiles' ? 180 : 260)}</p>
                  <div>{entry.collection && <span>{entry.collection}</span>}{(entry.tags || []).slice(0, 4).map((tag) => <span key={tag}>#{tag}</span>)}</div>
                </div>
                <div className="pl-library-card-meta"><span>{entry.versions?.length || 1} ver</span><span>{entry.useCount || 0} uses</span><time>{formatEntryDate(entry)}</time></div>
                <div className="pl-library-card-actions" onClick={(event) => event.stopPropagation()}>
                  {smartView === 'trash' ? <>
                    <button type="button" onClick={() => lib.restoreDeleted(entry.id)}>Restore</button>
                    <button type="button" onClick={() => lib.permanentlyDelete(entry.id)} aria-label={`Permanently delete ${entry.title}`}><Ic n="Trash2" size={13} /></button>
                  </> : <>
                    <button type="button" onClick={() => loadEntry(entry)}>Open</button>
                    <button type="button" onClick={() => copy(entryText(entry))} aria-label={`Copy ${entry.title}`}><Ic n="Copy" size={13} /></button>
                    <button type="button" onClick={() => lib.setFavorite(entry.id)} aria-label={`${entry.favorite ? 'Unfavorite' : 'Favorite'} ${entry.title}`}><Ic n="Star" size={13} /></button>
                  </>}
                </div>
              </article>
            ))}
          </div>
        )}
      </main>

      <aside className="pl-library-inspector" aria-label="Prompt inspector">
        {!selected ? <div className="pl-inspector-empty"><Ic n="PanelRight" size={22} /><p>Select a prompt to inspect its saved content, metadata, and history.</p></div> : <>
          <header>
            <div><p className="pl-eyebrow">Inspector</p><h2>{selected.title}</h2></div>
            {smartView !== 'trash' && <button type="button" className="pl-icon-button" onClick={() => lib.setFavorite(selected.id)} aria-label="Toggle favorite"><Ic n="Star" size={14} /></button>}
          </header>
          <div className="pl-inspector-tabs" role="tablist">
            {['details', 'content', 'versions'].map((tab) => <button key={tab} role="tab" aria-selected={inspectorTab === tab} onClick={() => setInspectorTab(tab)}>{tab}</button>)}
          </div>
          <div className="pl-inspector-content">
            {inspectorTab === 'details' && <>
              <label>Title<input value={selected.title} onChange={(event) => updateSelected({ title: event.target.value })} disabled={smartView === 'trash'} /></label>
              <label>Purpose<textarea value={selected.metadata?.purpose || ''} onChange={(event) => updateSelected({ metadata: { ...selected.metadata, purpose: event.target.value } })} disabled={smartView === 'trash'} /></label>
              <label>Status<select value={selected.metadata?.status || ''} onChange={(event) => updateSelected({ metadata: { ...selected.metadata, status: event.target.value } })} disabled={smartView === 'trash'}><option value="">Not set</option><option value="draft">Draft</option><option value="active">Active</option><option value="deprecated">Deprecated</option></select></label>
              <label>Collection<select value={selected.collection || ''} onChange={(event) => updateSelected({ collection: event.target.value })} disabled={smartView === 'trash'}><option value="">None</option>{lib.collections.map((item) => <option key={item}>{item}</option>)}</select></label>
              <div className="pl-inspector-tags">{(selected.tags || []).map((tag) => <span key={tag}>#{tag}</span>)}</div>
            </>}
            {inspectorTab === 'content' && <pre>{entryText(selected)}</pre>}
            {inspectorTab === 'versions' && <div className="pl-version-list">{(selected.versions || []).map((version, index) => <button key={version.id} type="button" disabled={smartView === 'trash'} onClick={() => lib.restoreVersion(selected.id, version)}><strong>Version {(selected.versions?.length || 0) - index}</strong><time>{new Date(version.savedAt).toLocaleString()}</time><small>{version.changeNote || 'Saved version'}</small></button>)}</div>}
          </div>
          {smartView !== 'trash' && <footer>
            <button type="button" className="pl-primary-button" onClick={() => loadEntry(selected)}>Open in Write</button>
            <button type="button" className="pl-secondary-button" onClick={() => addToComposer(selected)}>Compose</button>
            <button type="button" className="pl-icon-button" onClick={() => lib.duplicateEntry(selected.id)} aria-label="Duplicate prompt"><Ic n="CopyPlus" size={14} /></button>
            <button type="button" className="pl-icon-button" onClick={() => lib.del(selected.id)} aria-label="Delete prompt"><Ic n="Trash2" size={14} /></button>
          </footer>}
        </>}
      </aside>
    </div>
  );
}
