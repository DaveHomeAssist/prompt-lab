import { useEffect, useMemo, useRef, useState } from 'react';
import Ic from './icons';
import FollowUpOrigin from './FollowUpOrigin.jsx';
import { matchesLibrarySearch } from './lib/libraryMatching.js';
import { sortLibraryEntries } from './hooks/usePromptLibrary.js';
import PackStudioPanel from './PackStudioPanel.jsx';
import { handleTabArrowKeys } from './hooks/useDialogA11y.js';
import useDialogA11y from './hooks/useDialogA11y.js';
import { extractVars, wordDiff } from './promptUtils.js';
import usePersistedState from './usePersistedState.js';
import { DEFAULT_GOLDEN_THRESHOLD } from './constants.js';

const SMART_VIEWS = Object.freeze([
  { id: 'all', icon: 'FolderOpen', label: 'All prompts' },
  { id: 'recent', icon: 'Clock', label: 'Recent' },
  { id: 'frequent', icon: 'Zap', label: 'Frequently used' },
  { id: 'favorites', icon: 'Star', label: 'Favorites' },
  { id: 'templates', icon: 'Braces', label: 'Templates' },
  { id: 'incomplete', icon: 'CircleAlert', label: 'Incomplete' },
]);

const INSPECTOR_TABS = Object.freeze([
  ['details', 'Details'],
  ['content', 'Content'],
  ['variables', 'Variables'],
  ['variants', 'Variants'],
  ['notes', 'Notes'],
  ['tests', 'Tests'],
  ['versions', 'Version history'],
]);

const EMPTY_DETAILS = Object.freeze({
  title: '', purpose: '', owner: '', status: '', riskLevel: '', compatibility: '', collection: '', tags: '',
});

function entryText(entry) {
  return entry?.enhanced || entry?.original || '';
}

function stringList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function uniqueStrings(value) {
  return [...new Set(stringList(value))];
}

function isIncomplete(entry) {
  return !entry?.title?.trim()
    || !(entry?.tags || []).length
    || !entry?.metadata?.purpose?.trim()
    || !entry?.metadata?.status?.trim();
}

function isTemplate(entry) {
  return (entry?.inputs || []).length > 0
    || (entry?.tags || []).some((tag) => tag.toLowerCase() === 'template')
    || entry?.metadata?.type === 'template';
}

function timestamp(value) {
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatEntryDate(entry) {
  const value = entry?.updatedAt || entry?.updated_at || entry?.createdAt;
  if (!value) return 'Starter';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Saved locally'
    : date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function trashExpiryLabel(entry) {
  const deletedAt = timestamp(entry?.deletedAt);
  if (!deletedAt) return 'Removed after 30 days';
  const expiresAt = deletedAt + (30 * 24 * 60 * 60 * 1000);
  const days = Math.max(0, Math.ceil((expiresAt - Date.now()) / (24 * 60 * 60 * 1000)));
  return days === 0 ? 'Removed today' : `${days} ${days === 1 ? 'day' : 'days'} left`;
}

function detailsForEntry(entry) {
  if (!entry) return { ...EMPTY_DETAILS };
  return {
    title: entry.title || '',
    purpose: entry.metadata?.purpose || '',
    owner: entry.metadata?.owner || '',
    status: entry.metadata?.status || '',
    riskLevel: entry.metadata?.riskLevel || '',
    compatibility: (entry.metadata?.compatibility || []).join(', '),
    collection: entry.collection || '',
    tags: (entry.tags || []).join(', '),
  };
}

function smartViewCount(library, id) {
  if (id === 'favorites') return library.filter((entry) => entry.favorite).length;
  if (id === 'templates') return library.filter(isTemplate).length;
  if (id === 'incomplete') return library.filter(isIncomplete).length;
  return library.length;
}

function FilterChip({ label, onRemove }) {
  return <span className="pl-library-filter-chip"><span>{label}</span><button type="button" onClick={onRemove} aria-label={`Remove ${label} filter`}><Ic n="X" size={10} /></button></span>;
}

function VersionComparison({ entry, onRestore }) {
  const versions = useMemo(() => (entry.versions || []).map((version, index) => ({
    ...version, choiceId: `history:${version.id || index}`, label: `Version ${index + 1}`,
  })), [entry.versions]);
  const choices = useMemo(() => [
    ...versions,
    { ...entry, choiceId: 'current', label: 'Current version', savedAt: entry.updatedAt || entry.updated_at || entry.createdAt },
  ], [entry, versions]);
  const [leftId, setLeftId] = useState(versions.at(-1)?.choiceId || 'current');
  const [rightId, setRightId] = useState('current');
  const left = choices.find((choice) => choice.choiceId === leftId) || choices[0];
  const right = choices.find((choice) => choice.choiceId === rightId) || choices.at(-1);
  const differences = useMemo(() => wordDiff(entryText(left), entryText(right)), [left, right]);
  const changedWords = differences.filter((part) => part.t !== 'eq').length;

  if (versions.length === 0) {
    return <div className="pl-version-empty"><p>No earlier versions yet.</p><small>Saving a changed prompt creates history automatically.</small></div>;
  }

  return <div className="pl-version-workspace">
    <div className="pl-version-compare-controls">
      <label>Compare from<select value={leftId} onChange={(event) => setLeftId(event.target.value)}>{choices.map((choice) => <option key={choice.choiceId} value={choice.choiceId}>{choice.label}</option>)}</select></label>
      <label>Compare to<select value={rightId} onChange={(event) => setRightId(event.target.value)}>{choices.map((choice) => <option key={choice.choiceId} value={choice.choiceId}>{choice.label}</option>)}</select></label>
    </div>
    <p className="pl-version-summary" aria-live="polite">{changedWords} changed {changedWords === 1 ? 'word' : 'words'}</p>
    <div className="pl-version-side-by-side">
      <section aria-label={`${left.label} content`}><strong>{left.label}</strong><pre>{entryText(left)}</pre></section>
      <section aria-label={`${right.label} content`}><strong>{right.label}</strong><pre>{entryText(right)}</pre></section>
    </div>
    <div className="pl-version-inline-diff" aria-label="Word-level changes">
      {differences.map((part, index) => {
        if (part.t === 'add') return <ins key={`${part.t}-${index}`}>{part.v}{' '}</ins>;
        if (part.t === 'del') return <del key={`${part.t}-${index}`}>{part.v}{' '}</del>;
        return <span key={`${part.t}-${index}`}>{part.v}{' '}</span>;
      })}
    </div>
    <p className="pl-version-safety-note"><Ic n="RotateCcw" size={12} /> Restoring is nondestructive: the current content is retained in version history.</p>
    <div className="pl-version-list" aria-label="Saved versions">
      {[...versions].reverse().map((version) => <div key={version.choiceId} className="pl-version-row">
        <div><strong>{version.label}</strong><time>{new Date(version.savedAt).toLocaleString()}</time><small>{version.changeNote || 'Saved version'}</small></div>
        <button type="button" onClick={() => onRestore(version)}>Restore as current</button>
      </div>)}
    </div>
  </div>;
}

function InspectorContent({ selected, smartView, inspectorTab, detailsDraft, setDetailsDraft, detailsDirty, saveDetails, lib, canUseCollections, openBilling, copy }) {
  const content = entryText(selected);
  const variableNames = uniqueStrings([
    ...extractVars(selected.original || ''), ...extractVars(selected.enhanced || ''),
    ...(selected.inputs || []).map((input) => input.key),
  ]);
  const inputByKey = new Map((selected.inputs || []).map((input) => [input.key, input]));

  if (inspectorTab === 'details') {
    return <div className="pl-inspector-details-form">
      <label>Title<input value={detailsDraft.title} onChange={(event) => setDetailsDraft((current) => ({ ...current, title: event.target.value }))} disabled={smartView === 'trash'} /></label>
      <label>Purpose<textarea value={detailsDraft.purpose} onChange={(event) => setDetailsDraft((current) => ({ ...current, purpose: event.target.value }))} disabled={smartView === 'trash'} /></label>
      <label>Owner<input value={detailsDraft.owner} onChange={(event) => setDetailsDraft((current) => ({ ...current, owner: event.target.value }))} disabled={smartView === 'trash'} /></label>
      <div className="pl-inspector-form-row">
        <label>Status<select value={detailsDraft.status} onChange={(event) => setDetailsDraft((current) => ({ ...current, status: event.target.value }))} disabled={smartView === 'trash'}><option value="">Not set</option><option value="draft">Draft</option><option value="active">Active</option><option value="deprecated">Deprecated</option></select></label>
        <label>Risk<select value={detailsDraft.riskLevel} onChange={(event) => setDetailsDraft((current) => ({ ...current, riskLevel: event.target.value }))} disabled={smartView === 'trash'}><option value="">Not set</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
      </div>
      <label>Compatibility<input value={detailsDraft.compatibility} onChange={(event) => setDetailsDraft((current) => ({ ...current, compatibility: event.target.value }))} placeholder="Claude, GPT, Gemini" disabled={smartView === 'trash'} /></label>
      <label>Tags<input value={detailsDraft.tags} onChange={(event) => setDetailsDraft((current) => ({ ...current, tags: event.target.value }))} placeholder="research, template" disabled={smartView === 'trash'} /></label>
      <label>Collection<select value={detailsDraft.collection} onChange={(event) => setDetailsDraft((current) => ({ ...current, collection: event.target.value }))} disabled={smartView === 'trash' || !canUseCollections}><option value="">None</option>{lib.collections.map((item) => <option key={item}>{item}</option>)}</select></label>
      {!canUseCollections && smartView !== 'trash' && <button type="button" className="pl-inline-upgrade" onClick={() => openBilling?.('collections')}>Unlock collections</button>}
      {smartView !== 'trash' && <button type="button" className="pl-primary-button" disabled={!detailsDirty || !detailsDraft.title.trim()} onClick={saveDetails}>Save details</button>}
      <dl className="pl-inspector-audit-metadata">
        <div><dt>Created</dt><dd>{new Date(selected.createdAt).toLocaleString()}</dd></div>
        <div><dt>Updated</dt><dd>{new Date(selected.updatedAt || selected.updated_at || selected.createdAt).toLocaleString()}</dd></div>
        <div><dt>Uses</dt><dd>{selected.useCount || 0}</dd></div>
        <div><dt>Saved versions</dt><dd>{selected.versions?.length || 0}</dd></div>
      </dl>
    </div>;
  }

  if (inspectorTab === 'content') {
    return <div className="pl-inspector-content-view">
      {selected.original?.trim() && <section><div><h3>Original</h3><button type="button" onClick={() => copy(selected.original)}>Copy original</button></div><pre>{selected.original}</pre></section>}
      <section><div><h3>Saved output</h3><button type="button" onClick={() => copy(content)}>Copy output</button></div><pre>{content}</pre></section>
    </div>;
  }

  if (inspectorTab === 'variables') {
    return variableNames.length > 0 ? <div className="pl-variable-list">
      {variableNames.map((name) => {
        const input = inputByKey.get(name);
        return <div key={name}><code>{`{{${name}}}`}</code><span>{input?.label || 'Detected variable'}</span><small>{input ? `${input.type}${input.required ? ' · required' : ''}` : 'No saved input definition'}</small></div>;
      })}
    </div> : <div className="pl-inspector-empty-state"><p>No variables in this prompt.</p><small>Use double braces, such as {'{{topic}}'}, to make reusable inputs.</small></div>;
  }

  if (inspectorTab === 'variants') {
    return (selected.variants || []).length > 0
      ? <div className="pl-variant-list">{selected.variants.map((variant, index) => <section key={variant.id || `${variant.label}-${index}`}><div><h3>{variant.label || `Variant ${index + 1}`}</h3><button type="button" onClick={() => copy(variant.content)}>Copy</button></div><pre>{variant.content}</pre></section>)}</div>
      : <div className="pl-inspector-empty-state"><p>No saved variants.</p><small>Enhance a prompt to create alternate candidates.</small></div>;
  }

  if (inspectorTab === 'notes') {
    return selected.notes?.trim()
      ? <div className="pl-saved-notes"><pre>{selected.notes}</pre><button type="button" onClick={() => copy(selected.notes)}>Copy notes</button></div>
      : <div className="pl-inspector-empty-state"><p>No saved notes.</p><small>Notes can be added while saving from the Editor.</small></div>;
  }

  if (inspectorTab === 'tests') {
    return <div className="pl-saved-tests">
      {selected.metadata?.suite && <div className={`pl-suite-summary is-${selected.metadata.suite.verdict || 'unknown'}`}><strong>Latest suite: {selected.metadata.suite.verdict || 'Unknown'}</strong><span>{selected.metadata.suite.passed || 0}/{selected.metadata.suite.total || 0} passed</span></div>}
      {selected.goldenResponse?.text && <section><h3>Golden response</h3><pre>{selected.goldenResponse.text}</pre><small>Similarity threshold: {Math.round((selected.goldenThreshold ?? DEFAULT_GOLDEN_THRESHOLD) * 100)}%</small></section>}
      {(selected.testCases || []).map((testCase, index) => <section key={testCase.id || index}><h3>{testCase.name || `Test ${index + 1}`}</h3><pre>{testCase.input}</pre>{testCase.expectedTraits?.length > 0 && <p><strong>Expected:</strong> {testCase.expectedTraits.join(', ')}</p>}{testCase.exclusions?.length > 0 && <p><strong>Exclude:</strong> {testCase.exclusions.join(', ')}</p>}{testCase.notes && <small>{testCase.notes}</small>}</section>)}
      {!selected.goldenResponse?.text && !(selected.testCases || []).length && <div className="pl-inspector-empty-state"><p>No tests saved.</p><small>Open the prompt in Evaluate to add cases and a golden response.</small></div>}
    </div>;
  }

  return <VersionComparison entry={selected} onRestore={(version) => lib.restoreVersion(selected.id, version)} />;
}

export default function LibraryWorkspace({
  m, lib, loadEntry, copy, addToComposer, sendToABTest, openSavePanel,
  onNewPrompt, onOpenScratchSource, onExportEntries,
  canUseCollections = true, canExportLibrary = true,
  canImportLibrary = canExportLibrary, canUsePacks = true, openBilling,
  compact = false,
}) {
  const [smartView, setSmartView] = useState('all');
  // Persisted like the other UI preferences (pl2-mode, pl2-density) so the
  // chosen layout survives navigating away and reloading. The validator keeps
  // a corrupted or removed value from rendering an unknown `is-<layout>` class.
  const [layout, setLayout] = usePersistedState('pl2-library-layout', 'list', {
    validate: (value) => (value === 'list' || value === 'tiles' ? value : 'list'),
  });
  const [selectedId, setSelectedId] = useState(null);
  const [checkedIds, setCheckedIds] = useState([]);
  const [searchDraft, setSearchDraft] = useState(lib.search || '');
  const [statusFilter, setStatusFilter] = useState('');
  const [bulkTag, setBulkTag] = useState('');
  const [bulkCollection, setBulkCollection] = useState('');
  const [inspectorTab, setInspectorTab] = useState('details');
  const [detailsDraft, setDetailsDraft] = useState({ ...EMPTY_DETAILS });
  const [showPackStudio, setShowPackStudio] = useState(false);
  const [showCollectionManager, setShowCollectionManager] = useState(false);
  const [collectionDraft, setCollectionDraft] = useState('');
  const [renamingCollection, setRenamingCollection] = useState('');
  const [renameCollectionDraft, setRenameCollectionDraft] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const importInputRef = useRef(null);
  const inspectorDialogRef = useDialogA11y({
    open: compact && Boolean(selectedId),
    onClose: () => setSelectedId(null),
  });

  useEffect(() => setSearchDraft(lib.search || ''), [lib.search]);
  useEffect(() => {
    const invalidCollection = smartView === 'collection' && (!lib.activeCollection || !lib.collections.includes(lib.activeCollection));
    const invalidTag = smartView === 'tag' && (!lib.activeTag || !lib.allLibTags.includes(lib.activeTag));
    if (invalidCollection || invalidTag) {
      if (invalidCollection) lib.setActiveCollection(null);
      if (invalidTag) lib.setActiveTag(null);
      setSmartView('all');
      setCheckedIds([]);
    }
  }, [smartView, lib.activeCollection, lib.activeTag, lib.collections, lib.allLibTags]);
  const selected = useMemo(() => (smartView === 'trash' ? lib.trash : lib.library).find((entry) => entry.id === selectedId) || null, [lib.library, lib.trash, selectedId, smartView]);
  useEffect(() => setDetailsDraft(detailsForEntry(selected)), [selected?.id, selected?.updatedAt, selected?.updated_at]);
  const expectedDetails = useMemo(() => detailsForEntry(selected), [selected]);
  const detailsDirty = selected ? JSON.stringify(detailsDraft) !== JSON.stringify(expectedDetails) : false;

  const entries = useMemo(() => {
    let source = smartView === 'trash' ? [...lib.trash] : [...lib.library];
    source = source.filter((entry) => matchesLibrarySearch(entry, searchDraft));
    if (statusFilter) source = source.filter((entry) => entry.metadata?.status === statusFilter);
    if (smartView === 'favorites') source = source.filter((entry) => entry.favorite);
    if (smartView === 'templates') source = source.filter(isTemplate);
    if (smartView === 'incomplete') source = source.filter(isIncomplete);
    if (smartView === 'collection') source = source.filter((entry) => entry.collection === lib.activeCollection);
    if (smartView === 'tag') source = source.filter((entry) => (entry.tags || []).includes(lib.activeTag));
    if (smartView === 'recent') return source.sort((left, right) => timestamp(right.lastAccessedAt || right.updatedAt) - timestamp(left.lastAccessedAt || left.updatedAt));
    if (smartView === 'frequent') return source.sort((left, right) => (right.useCount || 0) - (left.useCount || 0));
    if (smartView === 'trash') return source.sort((left, right) => timestamp(right.deletedAt) - timestamp(left.deletedAt));
    return sortLibraryEntries(source, lib.sortBy);
  }, [lib.activeCollection, lib.activeTag, lib.library, lib.sortBy, lib.trash, searchDraft, smartView, statusFilter]);

  const checkedEntries = useMemo(() => {
    const ids = new Set(checkedIds);
    return entries.filter((entry) => ids.has(entry.id));
  }, [checkedIds, entries]);
  const allVisibleChecked = entries.length > 0 && entries.every((entry) => checkedIds.includes(entry.id));
  const hasFilters = smartView !== 'all' || Boolean(searchDraft.trim() || statusFilter || lib.activeCollection || lib.activeTag);

  const chooseView = (nextView) => {
    setSmartView(nextView); setCheckedIds([]); setSelectedId(null); setInspectorTab('details');
    if (nextView !== 'collection') lib.setActiveCollection(null);
    if (nextView !== 'tag') lib.setActiveTag(null);
  };
  const selectEntry = (entry) => { setSelectedId(entry.id); setInspectorTab('details'); lib.trackRecentAccess?.(entry.id); };
  const toggleChecked = (id) => setCheckedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const clearFilters = () => {
    setSmartView('all'); setSearchDraft(''); setStatusFilter(''); lib.setSearch('');
    lib.setActiveTag(null); lib.setActiveCollection(null); setCheckedIds([]);
  };
  const saveDetails = () => {
    if (!selected || smartView === 'trash' || !detailsDraft.title.trim()) return;
    const result = lib.updateEntries([selected.id], (entry) => ({
      ...entry,
      title: detailsDraft.title.trim(),
      tags: uniqueStrings(detailsDraft.tags),
      collection: canUseCollections ? detailsDraft.collection : entry.collection,
      metadata: {
        ...(entry.metadata || {}), purpose: detailsDraft.purpose.trim(), owner: detailsDraft.owner.trim(),
        status: detailsDraft.status, riskLevel: detailsDraft.riskLevel,
        compatibility: uniqueStrings(detailsDraft.compatibility),
      },
      updatedAt: new Date().toISOString(),
    }));
    if (result === false || result === 0 || result === null) {
      setAnnouncement('Details were not saved. Your edits remain in the inspector.');
      return;
    }
    setAnnouncement(`Saved details for ${detailsDraft.title.trim()}.`);
  };
  const runBulk = (action, message) => {
    const result = action();
    if (result === false || result === 0 || result === null) {
      setAnnouncement('No prompts were changed. Your selection is still active.');
      return;
    }
    setAnnouncement(message);
    setCheckedIds([]);
  };
  const exportSelected = () => {
    if (!canExportLibrary) { openBilling?.('export'); return; }
    if (onExportEntries) onExportEntries(checkedEntries);
    else if (typeof lib.exportEntries === 'function') lib.exportEntries(checkedEntries);
    else {
      const payload = {
        version: '1.7.1', schemaVersion: 1, exportedAt: new Date().toISOString(),
        count: checkedEntries.length, library: checkedEntries,
        collections: uniqueStrings(checkedEntries.map((entry) => entry.collection)),
      };
      const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
      const anchor = Object.assign(document.createElement('a'), { href: url, download: 'prompt-library-selection.json' });
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    }
    setAnnouncement(`Exported ${checkedEntries.length} prompts with complete metadata.`);
  };
  const createCollection = () => {
    if (!canUseCollections) { openBilling?.('collections'); return; }
    const name = collectionDraft.trim();
    if (!name || lib.collections.some((collection) => collection.toLowerCase() === name.toLowerCase())) return;
    lib.setCollections((current) => [...current, name]); setCollectionDraft(''); setAnnouncement(`Created collection ${name}.`);
  };
  const saveCollectionRename = () => {
    const nextName = renameCollectionDraft.trim();
    if (!renamingCollection || !nextName) return;
    lib.setCollections((current) => current.map((name) => name === renamingCollection ? nextName : name));
    const ids = lib.library.filter((entry) => entry.collection === renamingCollection).map((entry) => entry.id);
    lib.updateEntries(ids, (entry) => ({ ...entry, collection: nextName }));
    if (lib.activeCollection === renamingCollection) lib.setActiveCollection(nextName);
    setRenamingCollection(''); setRenameCollectionDraft(''); setAnnouncement(`Renamed collection to ${nextName}.`);
  };
  const handleNewPrompt = () => { setSelectedId(null); if (onNewPrompt) onNewPrompt(); else openSavePanel?.({ mode: 'new' }); };

  return <div className={`pl-library-workspace${selected ? ' has-inspector-selection' : ''}${smartView === 'trash' ? ' is-trash-view' : ''}`}>
    <p className="sr-only" aria-live="polite">{announcement}</p>
    <aside className="pl-library-rail" aria-label="Library views">
      <div className="pl-library-rail-title"><div><p className="pl-eyebrow">Prompt index</p><h2>Library</h2></div><span>{lib.library.length}</span></div>
      <button type="button" className="pl-library-new-button" onClick={handleNewPrompt}><Ic n="Plus" size={14} /> New Prompt</button>
      <nav aria-label="Smart views">
        {SMART_VIEWS.map(({ id, icon, label }) => <button key={id} type="button" aria-current={smartView === id ? 'page' : undefined} onClick={() => chooseView(id)}><Ic n={icon} size={14} /><span>{label}</span><small>{smartViewCount(lib.library, id)}</small></button>)}
      </nav>

      <section className="pl-library-collections">
        <div className="pl-library-section-heading"><p className="pl-eyebrow">Collections</p><button type="button" onClick={() => { if (!canUseCollections) openBilling?.('collections'); else setShowCollectionManager((value) => !value); }} aria-expanded={canUseCollections ? showCollectionManager : undefined} aria-label={canUseCollections ? 'Manage collections' : 'Unlock collections'}><Ic n="Plus" size={12} /></button></div>
        {canUseCollections ? lib.collections.map((collection) => <div key={collection} className="pl-library-rail-row"><button type="button" aria-current={smartView === 'collection' && lib.activeCollection === collection ? 'page' : undefined} onClick={() => { setSmartView('collection'); setCheckedIds([]); setSelectedId(null); lib.setActiveTag(null); lib.setActiveCollection(collection); }}><Ic n="Folder" size={13} /><span>{collection}</span><small>{lib.library.filter((entry) => entry.collection === collection).length}</small></button></div>) : <button type="button" className="pl-library-locked-row" onClick={() => openBilling?.('collections')}>Collections · Pro</button>}
        {showCollectionManager && canUseCollections && <div className="pl-collection-manager">
          <div className="pl-collection-create"><input value={collectionDraft} onChange={(event) => setCollectionDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') createCollection(); }} placeholder="New collection" aria-label="New collection name" /><button type="button" onClick={createCollection} disabled={!collectionDraft.trim()}>Add</button></div>
          {lib.collections.map((collection) => renamingCollection === collection
            ? <div key={collection} className="pl-collection-edit"><input value={renameCollectionDraft} onChange={(event) => setRenameCollectionDraft(event.target.value)} aria-label={`Rename ${collection}`} /><button type="button" onClick={saveCollectionRename}>Save</button><button type="button" onClick={() => setRenamingCollection('')}>Cancel</button></div>
            : <div key={collection} className="pl-collection-manage-row"><span>{collection}</span><button type="button" onClick={() => { setRenamingCollection(collection); setRenameCollectionDraft(collection); }}>Rename</button><button type="button" onClick={() => lib.deleteCollection(collection)} aria-label={`Delete collection ${collection}`}>Delete</button></div>)}
          <small>Deleting a collection keeps its prompts.</small>
        </div>}
      </section>

      <section><p className="pl-eyebrow">Tags</p><div className="pl-library-tag-cloud">
        {lib.allLibTags.map((tag) => <button key={tag} type="button" aria-pressed={smartView === 'tag' && lib.activeTag === tag} onClick={() => { setSmartView('tag'); setCheckedIds([]); setSelectedId(null); lib.setActiveCollection(null); lib.setActiveTag(tag); }}>#{tag}</button>)}
      </div></section>
      <button type="button" className="pl-trash-link" aria-current={smartView === 'trash' ? 'page' : undefined} onClick={() => chooseView('trash')}><Ic n="Trash2" size={14} /><span>Recently Deleted</span><small>{lib.trash.length}</small></button>
      <small className="pl-trash-retention-note">Items are permanently removed after 30 days.</small>
    </aside>

    <section className="pl-library-index" aria-label="Prompt index">
      <header className="pl-library-toolbar">
        <label className="pl-library-search"><span className="sr-only">Search prompts</span><Ic n="Search" size={14} /><input data-testid="library-search" value={searchDraft} onChange={(event) => { setSearchDraft(event.target.value); lib.setSearch(event.target.value); }} placeholder="Search title, text, tags, metadata…" /></label>
        <select aria-label="Filter by status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">All statuses</option><option value="draft">Draft</option><option value="active">Active</option><option value="deprecated">Deprecated</option></select>
        <select aria-label="Sort prompts" value={lib.sortBy} onChange={(event) => lib.setSortBy(event.target.value)}><option value="newest">Newest</option><option value="oldest">Oldest</option><option value="most-used">Most used</option><option value="a-z">A–Z</option><option value="z-a">Z–A</option><option value="group">Collection</option><option value="manual">Manual</option></select>
        <div className="pl-layout-toggle" aria-label="Library layout"><button type="button" aria-pressed={layout === 'list'} onClick={() => setLayout('list')} aria-label="List view"><Ic n="List" size={14} /></button><button type="button" aria-pressed={layout === 'tiles'} onClick={() => setLayout('tiles')} aria-label="Tile view"><Ic n="LayoutGrid" size={14} /></button></div>
        <button type="button" className="pl-secondary-button" onClick={canExportLibrary ? lib.exportLib : () => openBilling?.('export')}><Ic n="Download" size={13} /> {canExportLibrary ? 'Export' : 'Export Pro'}</button>
        <button type="button" aria-label={canUsePacks ? 'Open pack studio' : 'Unlock pack studio'} className="pl-secondary-button" onClick={() => canUsePacks ? setShowPackStudio((value) => !value) : openBilling?.('packs')} aria-expanded={canUsePacks ? showPackStudio : undefined}><Ic n="Layers" size={13} /> {canUsePacks ? 'Packs' : 'Packs Pro'}</button>
        {canImportLibrary ? <><button type="button" className="pl-secondary-button" onClick={() => importInputRef.current?.click()}><Ic n="Upload" size={13} /> Import</button><input ref={importInputRef} className="sr-only" type="file" accept="application/json" aria-label="Import Prompt Lab workspace" aria-hidden="true" tabIndex={-1} onChange={lib.importLib} /></> : <button type="button" className="pl-secondary-button" onClick={() => openBilling?.('import')}><Ic n="Upload" size={13} /> Import Pro</button>}
      </header>

      {showPackStudio && canUsePacks && <PackStudioPanel m={m} lib={lib} compact onClose={() => setShowPackStudio(false)} />}
      {hasFilters && <div className="pl-library-filter-bar" aria-label="Active filters">
        {smartView !== 'all' && smartView !== 'collection' && smartView !== 'tag' && <FilterChip label={SMART_VIEWS.find((view) => view.id === smartView)?.label || 'Recently Deleted'} onRemove={() => chooseView('all')} />}
        {searchDraft.trim() && <FilterChip label={`Search: ${searchDraft.trim()}`} onRemove={() => { setSearchDraft(''); lib.setSearch(''); }} />}
        {statusFilter && <FilterChip label={`Status: ${statusFilter}`} onRemove={() => setStatusFilter('')} />}
        {lib.activeCollection && <FilterChip label={`Collection: ${lib.activeCollection}`} onRemove={() => { lib.setActiveCollection(null); setSmartView('all'); }} />}
        {lib.activeTag && <FilterChip label={`Tag: ${lib.activeTag}`} onRemove={() => { lib.setActiveTag(null); setSmartView('all'); }} />}
        <button type="button" className="pl-library-clear-filters" onClick={clearFilters}>Clear all</button>
      </div>}

      {checkedIds.length > 0 && <div className="pl-bulk-bar" role="toolbar" aria-label="Bulk actions">
        <strong>{checkedIds.length} selected</strong>
        {smartView === 'trash' ? <>
          <button type="button" onClick={() => runBulk(() => checkedEntries.forEach((entry) => lib.restoreDeleted(entry.id)), `Restored ${checkedEntries.length} prompts.`)}>Restore</button>
          <button type="button" onClick={() => runBulk(() => { if (lib.permanentlyDeleteEntries) lib.permanentlyDeleteEntries(checkedIds); else checkedEntries.forEach((entry) => lib.permanentlyDelete(entry.id)); }, `Requested permanent deletion of ${checkedEntries.length} prompts.`)}><Ic n="Trash2" size={13} /> Delete forever</button>
        </> : <>
          {canUseCollections ? <label>Move to<select aria-label="Move selected prompts to collection" value={bulkCollection} onChange={(event) => { const value = event.target.value; setBulkCollection(value); if (value) runBulk(() => lib.moveEntriesToCollection(checkedIds, value), `Moved ${checkedIds.length} prompts to ${value}.`); }}><option value="">Choose…</option>{lib.collections.map((item) => <option key={item}>{item}</option>)}</select></label> : <button type="button" onClick={() => openBilling?.('collections')}>Collections Pro</button>}
          <label>Add tag<input value={bulkTag} onChange={(event) => setBulkTag(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && bulkTag.trim()) { const tag = bulkTag.trim(); runBulk(() => lib.addTagToEntries(checkedIds, tag), `Added #${tag} to ${checkedIds.length} prompts.`); setBulkTag(''); } }} placeholder="Type + Enter" /></label>
          <button type="button" onClick={() => runBulk(() => lib.updateEntries(checkedIds, (entry) => ({ ...entry, favorite: true })), `Favorited ${checkedIds.length} prompts.`)}><Ic n="Star" size={13} /> Favorite</button>
          <button type="button" onClick={() => runBulk(() => lib.updateEntries(checkedIds, (entry) => ({ ...entry, favorite: false })), `Unfavorited ${checkedIds.length} prompts.`)}>Unfavorite</button>
          <button type="button" onClick={() => runBulk(() => checkedEntries.forEach((entry) => lib.duplicateEntry(entry.id)), `Duplicated ${checkedIds.length} prompts.`)}><Ic n="CopyPlus" size={13} /> Duplicate</button>
          <button type="button" onClick={() => copy(checkedEntries.map(entryText).join('\n\n---\n\n'))}><Ic n="Copy" size={13} /> Copy</button>
          <button type="button" onClick={exportSelected}><Ic n="Download" size={13} /> Export selected</button>
          <button type="button" onClick={() => runBulk(() => lib.deleteEntries(checkedIds), `Moved ${checkedIds.length} prompts to Recently Deleted.`)}><Ic n="Trash2" size={13} /> Move to trash</button>
        </>}
        <button type="button" onClick={() => setCheckedIds([])}>Clear selection</button>
      </div>}

      <div className="pl-library-index-heading">
        <div><p className="pl-eyebrow">{smartView === 'collection' ? lib.activeCollection : smartView === 'tag' ? `#${lib.activeTag}` : smartView === 'trash' ? 'Recently Deleted' : SMART_VIEWS.find((view) => view.id === smartView)?.label || 'All prompts'}</p><h2>{entries.length} {entries.length === 1 ? 'prompt' : 'prompts'}</h2></div>
        <div className="pl-library-index-actions">{entries.length > 0 && <label><input type="checkbox" checked={allVisibleChecked} onChange={() => setCheckedIds(allVisibleChecked ? [] : entries.map((entry) => entry.id))} /> Select all</label>}<button type="button" className="pl-primary-button" onClick={handleNewPrompt}><Ic n="Plus" size={13} /> New Prompt</button></div>
      </div>

      {entries.length === 0
        ? <div className="pl-library-empty"><Ic n={smartView === 'trash' ? 'Trash2' : 'Search'} size={22} /><h3>Nothing here yet</h3><p>{hasFilters ? 'Change or clear the active filters.' : 'Save a prompt from the Editor to start your reusable library.'}</p>{hasFilters ? <button type="button" onClick={clearFilters}>Clear filters</button> : <button type="button" onClick={handleNewPrompt}>Create a prompt</button>}</div>
        : <div className={`pl-library-results is-${layout}`} role="list" aria-label="Saved prompts">
          {entries.map((entry, index) => <article key={entry.id} className={`pl-library-card${selectedId === entry.id ? ' is-selected' : ''}`} role="listitem">
            <label className="pl-library-card-select"><input type="checkbox" aria-label={`Select ${entry.title}`} checked={checkedIds.includes(entry.id)} onChange={() => toggleChecked(entry.id)} /></label>
            <button type="button" className="pl-library-card-open" aria-pressed={selectedId === entry.id} aria-label={`Inspect ${entry.title}`} onClick={() => selectEntry(entry)}>
              <span className="pl-library-card-copy"><span className="pl-library-card-title"><strong>{entry.title}</strong>{entry.favorite && <Ic n="Star" size={12} className="text-amber-400" />}{entry.metadata?.suite?.verdict && <span className={entry.metadata.suite.verdict === 'pass' ? 'pl-suite-pass' : 'pl-suite-fail'}>{entry.metadata.suite.verdict === 'pass' ? '✓ suite' : '✗ suite'}</span>}</span><span className="pl-library-card-excerpt">{entryText(entry).slice(0, layout === 'tiles' ? 180 : 260)}</span><span className="pl-library-card-labels">{entry.collection && <span>{entry.collection}</span>}{(entry.tags || []).slice(0, 4).map((tag) => <span key={tag}>#{tag}</span>)}</span></span>
              <span className="pl-library-card-meta"><span>{entry.versions?.length || 0} ver</span><span>{entry.useCount || 0} uses</span><time>{smartView === 'trash' ? trashExpiryLabel(entry) : formatEntryDate(entry)}</time></span>
            </button>
            <div className="pl-library-card-actions">
              {lib.sortBy === 'manual' && !['trash', 'recent', 'frequent'].includes(smartView) && <>
                <button type="button" aria-label={`Move ${entry.title} up`} disabled={index === 0} onClick={() => lib.moveLibraryEntryByOffset(entry.id, -1, entries)}><Ic n="ChevronUp" size={13} /></button>
                <button type="button" aria-label={`Move ${entry.title} down`} disabled={index === entries.length - 1} onClick={() => lib.moveLibraryEntryByOffset(entry.id, 1, entries)}><Ic n="ChevronDown" size={13} /></button>
              </>}
              {smartView === 'trash' ? <><button type="button" onClick={() => lib.restoreDeleted(entry.id)}>Restore</button><button type="button" onClick={() => lib.permanentlyDelete(entry.id)} aria-label={`Permanently delete ${entry.title}`}><Ic n="Trash2" size={13} /></button></> : <><button type="button" onClick={() => loadEntry(entry)}>Editor</button><button type="button" onClick={() => copy(entryText(entry))} aria-label={`Copy ${entry.title}`}><Ic n="Copy" size={13} /></button><button type="button" onClick={() => lib.setFavorite(entry.id)} aria-label={`${entry.favorite ? 'Unfavorite' : 'Favorite'} ${entry.title}`}><Ic n="Star" size={13} /></button></>}
            </div>
          </article>)}
        </div>}
    </section>

    <aside
      ref={inspectorDialogRef}
      className="pl-library-inspector"
      role={compact && selected ? 'dialog' : undefined}
      aria-modal={compact && selected ? 'true' : undefined}
      aria-label={selected ? undefined : 'Prompt inspector'}
      aria-labelledby={selected ? 'prompt-inspector-title' : undefined}
      tabIndex={compact && selected ? -1 : undefined}
    >
      {!selected ? <div className="pl-inspector-empty"><Ic n="PanelRight" size={22} /><p>Select a prompt to inspect its content, metadata, tests, and version history.</p></div> : <>
        <header>
          <button type="button" className="pl-library-mobile-back" onClick={() => setSelectedId(null)}><Ic n="ArrowRight" size={13} /> Back to prompts</button>
          <div className="pl-library-inspector-heading"><div><p className="pl-eyebrow">{smartView === 'trash' ? 'Recently Deleted' : 'Inspector'}</p><h2 id="prompt-inspector-title">{selected.title}</h2></div><button type="button" className="pl-icon-button" onClick={() => setSelectedId(null)} aria-label="Close prompt inspector"><Ic n="X" size={14} /></button></div>
          {selected.sourceNoteId && <button type="button" className="pl-source-note-link" onClick={() => onOpenScratchSource?.(selected.sourceNoteId, selected)}><Ic n="FileText" size={13} /> Open source in Scratch</button>}
        </header>
        <div className="pl-inspector-tabs" role="tablist" aria-label="Prompt details" onKeyDown={(event) => handleTabArrowKeys(event, inspectorTab, setInspectorTab)}>
          {INSPECTOR_TABS.map(([id, label]) => <button key={id} type="button" role="tab" data-tab-id={id} id={`library-tab-${id}`} aria-controls="library-inspector-panel" aria-selected={inspectorTab === id} tabIndex={inspectorTab === id ? 0 : -1} onClick={() => setInspectorTab(id)}>{label}</button>)}
        </div>
        <div className="pl-inspector-content" role="tabpanel" id="library-inspector-panel" aria-labelledby={`library-tab-${inspectorTab}`} tabIndex={0}>
          {selected.metadata?.followUpOrigin && <FollowUpOrigin origin={selected.metadata.followUpOrigin} library={lib.library} onOpenParent={selectEntry} m={m} />}
          {lib.library.some(child => child.metadata?.followUpOrigin?.sourcePromptId === selected.id) && <section aria-label="Follow-up prompts">
            <h3>Follow-up prompts</h3>
            {lib.library.filter(child => child.metadata?.followUpOrigin?.sourcePromptId === selected.id).map(child => <button key={child.id} type="button" className="pl-secondary-button" onClick={() => selectEntry(child)}>{child.title}</button>)}
          </section>}
          <InspectorContent selected={selected} smartView={smartView} inspectorTab={inspectorTab} detailsDraft={detailsDraft} setDetailsDraft={setDetailsDraft} detailsDirty={detailsDirty} saveDetails={saveDetails} lib={lib} canUseCollections={canUseCollections} openBilling={openBilling} copy={copy} />
        </div>
        <footer>
          {smartView === 'trash' ? <><button type="button" className="pl-primary-button" onClick={() => { lib.restoreDeleted(selected.id); setSelectedId(null); }}>Restore prompt</button><button type="button" className="pl-secondary-button" onClick={() => { lib.permanentlyDelete(selected.id); setSelectedId(null); }}>Delete forever</button></> : <>
            <button type="button" className="pl-primary-button" onClick={() => loadEntry(selected)}>Open in Editor</button>
            <button type="button" className="pl-secondary-button" onClick={() => addToComposer?.(selected)}>Composer</button>
            <button type="button" className="pl-secondary-button" onClick={() => sendToABTest?.(selected)}>A/B test</button>
            <button type="button" className="pl-secondary-button" onClick={() => copy(entryText(selected))}>Copy</button>
            <button type="button" className="pl-icon-button" onClick={() => lib.setFavorite(selected.id)} aria-label={`${selected.favorite ? 'Unfavorite' : 'Favorite'} prompt`}><Ic n="Star" size={14} /></button>
            <button type="button" className="pl-icon-button" onClick={() => lib.duplicateEntry(selected.id)} aria-label="Duplicate prompt"><Ic n="CopyPlus" size={14} /></button>
            <button type="button" className="pl-icon-button" onClick={() => { const deleted = lib.del(selected.id); if (deleted !== false) setSelectedId(null); }} aria-label="Move prompt to Recently Deleted"><Ic n="Trash2" size={14} /></button>
          </>}
        </footer>
      </>}
    </aside>
  </div>;
}
