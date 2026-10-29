import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ProBadge from './ProBadge.jsx';
import Ic from './icons';
import ArtworkPopover from './ArtworkPopover.jsx';
import ArtworkPicker, { Artwork } from './ArtworkPicker.jsx';
import { LIBRARY_LAYOUTS, safeArtwork } from './lib/libraryPresentation.js';
import FollowUpOrigin from './FollowUpOrigin.jsx';
import { matchesLibrarySearch } from './lib/libraryMatching.js';
import { entryTimestamp as timestamp, filterSmartView, orderSmartView } from './lib/librarySmartViews.js';
import { reconcileFolders, folderTree, folderDescendants, changeFolder } from './lib/collectionFolders.js';
import PackStudioPanel from './PackStudioPanel.jsx';
import StarterPackCard from './StarterPackCard.jsx';
import TestCasesPanel from './TestCasesPanel.jsx';
import { handleTabArrowKeys } from './hooks/useDialogA11y.js';
import useDialogA11y from './hooks/useDialogA11y.js';
import { extractVars, wordDiff } from './promptUtils.js';
import usePersistedState from './usePersistedState.js';
import PanelResizer, { clampWidth } from './PanelResizer.jsx';
import { INSPECTOR_WIDTH, LIBRARY_DRAWER_WIDTH, inspectorMaxWidth } from './lib/sidePane.js';
import { APP_VERSION, DEFAULT_GOLDEN_THRESHOLD } from './constants.js';
import { getVersionCount } from './lib/promptSchema.js';

const SMART_VIEWS = Object.freeze([
  { id: 'all', icon: 'FolderOpen', label: 'All prompts' },
  // Recent and Frequently used reorder the whole library rather than filter it.
  // Recent shows a sort hint instead of a count that equals All prompts;
  // Frequently used counts the prompts that have actually been used.
  { id: 'recent', icon: 'Clock', label: 'Recent', reorderHint: 'Last opened first' },
  { id: 'frequent', icon: 'Zap', label: 'Frequently used', reorderHint: 'Most used first', counted: true },
  { id: 'favorites', icon: 'Star', label: 'Favorites' },
  { id: 'templates', icon: 'Braces', label: 'Templates' },
  { id: 'incomplete', icon: 'CircleAlert', label: 'Incomplete' },
]);

// Filter value for prompts with no lifecycle status (tracked by Incomplete).
const STATUS_NOT_SET = '__not_set__';

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
  title: '', purpose: '', owner: '', status: '', riskLevel: '', compatibility: '', collection: '', tags: '', artwork: { icon: '', image: '' },
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
    artwork: safeArtwork(entry.metadata?.artwork),
    tags: (entry.tags || []).join(', '),
  };
}

function smartViewCount(library, id) {
  if (id === 'frequent') return library.filter((entry) => Number(entry.useCount) > 0).length;
  return filterSmartView(library, id).length;
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

const GOLDEN_RESPONSE_HINT = 'Pin a golden response from a Create run, or promote one from Evaluate → Compare.';

function InspectorContent({ m, selected, smartView, inspectorTab, detailsDraft, setDetailsDraft, detailsDirty, saveDetails, discardDetails, lib, canUseCollections, openBilling, copy, testCasesByPrompt, testCaseControls }) {
  const content = entryText(selected);
  const variableNames = uniqueStrings([
    ...extractVars(selected.original || ''), ...extractVars(selected.enhanced || ''),
    ...(selected.inputs || []).map((input) => input.key),
  ]);
  const inputByKey = new Map((selected.inputs || []).map((input) => [input.key, input]));

  if (inspectorTab === 'details') {
    return <div className="pl-inspector-details-form">
      <ArtworkPicker label="Prompt artwork" value={detailsDraft.artwork} onChange={artwork => setDetailsDraft(current => ({ ...current, artwork }))} disabled={smartView === 'trash'} />
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
      {smartView !== 'trash' && detailsDirty && <button type="button" className="pl-secondary-button" onClick={discardDetails}>Discard changes</button>}
      <dl className="pl-inspector-audit-metadata">
        <div><dt>Created</dt><dd>{new Date(selected.createdAt).toLocaleString()}</dd></div>
        <div><dt>Updated</dt><dd>{new Date(selected.updatedAt || selected.updated_at || selected.createdAt).toLocaleString()}</dd></div>
        <div><dt>Uses</dt><dd>{selected.useCount || 0}</dd></div>
        <div><dt>Versions</dt><dd>{getVersionCount(selected)}</dd></div>
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
    // Runnable cases live in the experiment store (keyed by prompt id), separate
    // from the read-only `testCases` that packs and imports embed in the entry.
    // Test Enhancer in Create only runs the former.
    const embeddedCases = selected.testCases || [];
    const hasGolden = Boolean(selected.goldenResponse?.text);
    const savedCases = testCasesByPrompt?.[selected.id] || [];
    const canManageCases = Boolean(testCaseControls) && smartView !== 'trash';
    return <div className="pl-saved-tests">
      {selected.metadata?.suite && <div className={`pl-suite-summary is-${selected.metadata.suite.verdict || 'unknown'}`}><strong>Latest suite: {selected.metadata.suite.verdict || 'Unknown'}</strong><span>{selected.metadata.suite.passed || 0}/{selected.metadata.suite.total || 0} passed</span></div>}
      {canManageCases && <TestCasesPanel m={m} entry={selected} cases={savedCases} {...testCaseControls} />}
      {canManageCases && savedCases.length > 0 && <small>Run all cases from Create: choose Open in Editor, then Test Enhancer.</small>}
      {hasGolden && <section><h3>Golden response</h3><pre>{selected.goldenResponse.text}</pre><small>Similarity threshold: {Math.round((selected.goldenThreshold ?? DEFAULT_GOLDEN_THRESHOLD) * 100)}%</small></section>}
      {canManageCases && embeddedCases.length > 0 && <h3>Included with this prompt (read-only)</h3>}
      {embeddedCases.map((testCase, index) => <section key={testCase.id || index}><h3>{testCase.name || `Test ${index + 1}`}</h3><pre>{testCase.input}</pre>{testCase.expectedTraits?.length > 0 && <p><strong>Expected:</strong> {testCase.expectedTraits.join(', ')}</p>}{testCase.exclusions?.length > 0 && <p><strong>Exclude:</strong> {testCase.exclusions.join(', ')}</p>}{testCase.notes && <small>{testCase.notes}</small>}</section>)}
      {canManageCases && !hasGolden && <small>No golden response pinned. {GOLDEN_RESPONSE_HINT}</small>}
      {!canManageCases && !hasGolden && embeddedCases.length === 0 && <div className="pl-inspector-empty-state"><p>No tests saved.</p><small>{smartView === 'trash' ? 'Restore this prompt to add test cases.' : GOLDEN_RESPONSE_HINT}</small></div>}
    </div>;
  }

  return <VersionComparison entry={selected} onRestore={(version) => lib.restoreVersion(selected.id, version)} />;
}

export default function LibraryWorkspace({
  m, lib, loadEntry, copy, addToComposer, sendToABTest, compareLocked = false, openSavePanel,
  onOpenScratchSource, onExportEntries,
  canUseCollections = true, canExportLibrary = true,
  canImportLibrary = canExportLibrary, canUsePacks = true, openBilling,
  compact = false,
  // Optional. Runnable test cases by prompt id, plus the form state and handlers
  // TestCasesPanel needs (everything except `m`, `entry` and `cases`). Without
  // them the Tests tab stays read-only.
  testCasesByPrompt, testCaseControls,
}) {
  const [smartView, setSmartView] = useState('all');
  // Persisted like the other UI preferences (pl2-mode, pl2-density) so the
  // chosen layout survives navigating away and reloading. The validator keeps
  // a corrupted or removed value from rendering an unknown `is-<layout>` class.
  const [layout, setLayout] = usePersistedState('pl2-library-layout', 'list', {
    validate: (value) => (LIBRARY_LAYOUTS.includes(value) ? value : 'list'),
  });
  const [desktopDrawerOpen, setDesktopDrawerOpen] = usePersistedState('pl2-library-drawer', true, { validate: value => typeof value === 'boolean' ? value : true });
  const [mobileDrawerOpen, setMobileDrawerOpen] = usePersistedState('pl2-library-mobile-drawer', false, { validate: value => typeof value === 'boolean' ? value : false });
  const drawerOpen = compact ? mobileDrawerOpen : desktopDrawerOpen;
  const setDrawerOpen = compact ? setMobileDrawerOpen : setDesktopDrawerOpen;
  const [inspectorWidth, setInspectorWidth] = usePersistedState('pl2-inspector-width', INSPECTOR_WIDTH.default, { validate: value => Number.isFinite(value) ? clampWidth(value, INSPECTOR_WIDTH.min, INSPECTOR_WIDTH.max) : INSPECTOR_WIDTH.default });
  // Null keeps the drawer at the width the layout gives it at each breakpoint;
  // dragging stores a width, and double-click on the handle clears it again.
  const [drawerWidth, setDrawerWidth] = usePersistedState('pl2-library-drawer-width', null, { validate: value => Number.isFinite(value) ? clampWidth(value, LIBRARY_DRAWER_WIDTH.min, LIBRARY_DRAWER_WIDTH.max) : null });
  const [layoutSize, setLayoutSize] = useState({ drawer: LIBRARY_DRAWER_WIDTH.default, inspectorMax: INSPECTOR_WIDTH.max });
  const [collapsedFolders, setCollapsedFolders] = useState([]);
  const [collectionParent, setCollectionParent] = useState('');
  const [artworkCollection, setArtworkCollection] = useState('');
  const [artworkTarget, setArtworkTarget] = useState(null);
  const [folderSaving, setFolderSaving] = useState(false);
  const [folderError, setFolderError] = useState('');
  const workspaceRef = useRef(null);
  const folderRecords = useMemo(() => lib.folders || reconcileFolders([], lib.collections), [lib.folders, lib.collections]);
  const folderRows = useMemo(() => folderTree(folderRecords), [folderRecords]);
  const activeFolder = folderRecords.find(folder => folder.collection === lib.activeCollection);
  const activeFolderIds = activeFolder ? folderDescendants(folderRecords, activeFolder.id) : new Set();
  const folderMatches = collection => activeFolder ? folderRecords.some(folder => folder.collection === collection && activeFolderIds.has(folder.id)) : collection === lib.activeCollection;
  const drawerRef = useDialogA11y({ open: compact && drawerOpen, onClose: () => setDrawerOpen(false) });
  const drawerResizable = drawerOpen && !compact;
  // Measures the drawer and the room left for the inspector, so the inspector
  // handle reports and stops at the width the layout can actually give it.
  const measureLayout = useCallback(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const drawer = drawerOpen && drawerRef.current ? drawerRef.current.getBoundingClientRect().width : 0;
    // At 1100 px and below the inspector floats over the list (index.css), so
    // the list keeps its width whatever the inspector's.
    const floating = typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 1100px)').matches;
    const next = {
      drawer: drawer || LIBRARY_DRAWER_WIDTH.default,
      inspectorMax: floating ? INSPECTOR_WIDTH.max : inspectorMaxWidth(workspace.clientWidth, drawer),
    };
    setLayoutSize(current => (current.drawer === next.drawer && current.inspectorMax === next.inspectorMax ? current : next));
  }, [drawerOpen]);
  useLayoutEffect(() => { measureLayout(); }, [measureLayout, drawerWidth, compact]);
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measureLayout);
      return () => window.removeEventListener('resize', measureLayout);
    }
    const observer = new ResizeObserver(() => measureLayout());
    if (workspaceRef.current) observer.observe(workspaceRef.current);
    return () => observer.disconnect();
  }, [measureLayout]);
  const inspectorShown = Math.min(inspectorWidth, layoutSize.inspectorMax);
  const resizeInspector = width => setInspectorWidth(clampWidth(width, INSPECTOR_WIDTH.min, layoutSize.inspectorMax));
  const [selectedId, setSelectedId] = useState(null);
  const [checkedIds, setCheckedIds] = useState([]);
  const [searchDraft, setSearchDraft] = useState(lib.search || '');
  const [statusFilter, setStatusFilter] = useState('');
  const [bulkTag, setBulkTag] = useState('');
  const [bulkCollection, setBulkCollection] = useState('');
  const [inspectorTab, setInspectorTab] = useState('details');
  const [, setDetailsRevision] = useState(0);
  const [showPackStudio, setShowPackStudio] = useState(false);
  const [showCollectionManager, setShowCollectionManager] = useState(false);
  const [collectionDraft, setCollectionDraft] = useState('');
  const [renamingCollection, setRenamingCollection] = useState('');
  const [renameCollectionDraft, setRenameCollectionDraft] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const importInputRef = useRef(null);
  const inspectorDialogRef = useDialogA11y({
    open: compact && Boolean(selectedId),
    onClose: () => closeInspector(),
  });

  useEffect(() => setSearchDraft(lib.search || ''), [lib.search]);
  useEffect(() => {
    const invalidCollection = smartView === 'collection' && (!lib.activeCollection || !folderRows.some(folder => folder.collection === lib.activeCollection));
    const invalidTag = smartView === 'tag' && (!lib.activeTag || !lib.allLibTags.includes(lib.activeTag));
    if (invalidCollection || invalidTag) {
      if (invalidCollection) lib.setActiveCollection(null);
      if (invalidTag) lib.setActiveTag(null);
      setSmartView('all');
      setCheckedIds([]);
    }
  }, [smartView, lib.activeCollection, lib.activeTag, lib.collections, lib.allLibTags]);
  const selected = useMemo(() => (smartView === 'trash' ? lib.trash : lib.library).find((entry) => entry.id === selectedId) || null, [lib.library, lib.trash, selectedId, smartView]);
  // Unsaved Details edits are kept per prompt for this session, so switching
  // prompts or views, closing the inspector, or a background change to the
  // entry (Favorite, use count) never drops what the user typed. Save details
  // or Discard changes clears the kept draft.
  // The draft is derived during render (never copied in an effect), so the
  // inspector can't show one prompt's fields under another prompt's title.
  const pendingDetailsRef = useRef(new Map());
  const expectedDetails = useMemo(() => detailsForEntry(selected), [selected]);
  const detailsDraft = (selected && pendingDetailsRef.current.get(selected.id)) || expectedDetails;
  const detailsDirty = selected ? JSON.stringify(detailsDraft) !== JSON.stringify(expectedDetails) : false;
  const editDetails = (updater) => {
    if (!selected) return;
    const current = pendingDetailsRef.current.get(selected.id) || expectedDetails;
    const next = typeof updater === 'function' ? updater(current) : updater;
    if (JSON.stringify(next) === JSON.stringify(expectedDetails)) pendingDetailsRef.current.delete(selected.id);
    else pendingDetailsRef.current.set(selected.id, next);
    setDetailsRevision(revision => revision + 1);
  };
  const saveCardArtwork = async (id, artwork) => {
    if (smartView === 'trash' || !lib.library.some(entry => entry.id === id)) return false;
    const nextArtwork = safeArtwork(artwork);
    const saved = await lib.saveEntryDetails(id, entry => ({
      ...entry, metadata: { ...entry.metadata, artwork: nextArtwork }, updatedAt: new Date().toISOString(),
    }));
    if (saved !== true) return false;
    // Keep all other inspector edits, but rebase its artwork after this explicit save.
    const pending = pendingDetailsRef.current.get(id);
    if (pending) pendingDetailsRef.current.set(id, { ...pending, artwork: nextArtwork });
    setDetailsRevision(revision => revision + 1);
    setAnnouncement('Prompt artwork saved.');
    return true;
  };
  const discardDetails = () => {
    if (!selected) return;
    pendingDetailsRef.current.delete(selected.id);
    setDetailsRevision(revision => revision + 1);
  };

  const entries = useMemo(() => {
    let source = smartView === 'trash' ? [...lib.trash] : [...lib.library];
    source = source.filter((entry) => matchesLibrarySearch(entry, searchDraft));
    if (statusFilter === STATUS_NOT_SET) source = source.filter((entry) => !entry.metadata?.status?.trim());
    else if (statusFilter) source = source.filter((entry) => entry.metadata?.status === statusFilter);
    source = filterSmartView(source, smartView);
    if (smartView === 'collection') source = source.filter((entry) => folderMatches(entry.collection));
    if (smartView === 'tag') source = source.filter((entry) => (entry.tags || []).includes(lib.activeTag));
    if (smartView === 'trash') return source.sort((left, right) => timestamp(right.deletedAt) - timestamp(left.deletedAt));
    return orderSmartView(source, smartView, lib.sortBy);
  }, [lib.activeCollection, lib.activeTag, lib.library, lib.sortBy, lib.trash, searchDraft, smartView, statusFilter, folderRecords]);

  const checkedEntries = useMemo(() => {
    const ids = new Set(checkedIds);
    return entries.filter((entry) => ids.has(entry.id));
  }, [checkedIds, entries]);
  const allVisibleChecked = entries.length > 0 && entries.every((entry) => checkedIds.includes(entry.id));
  const hasFilters = smartView !== 'all' || Boolean(searchDraft.trim() || statusFilter || lib.activeCollection || lib.activeTag);

  const closeInspector = () => setSelectedId(null);
  const chooseView = (nextView) => {
    setSmartView(nextView); setCheckedIds([]); setSelectedId(null); setInspectorTab('details');
    if (nextView !== 'collection') lib.setActiveCollection(null);
    if (nextView !== 'tag') lib.setActiveTag(null);
    if (compact) setDrawerOpen(false);
  };
  const selectEntry = (entry) => { if (compact) setDrawerOpen(false); setSelectedId(entry.id); setInspectorTab('details'); lib.trackRecentAccess?.(entry.id); };
  const toggleChecked = (id) => setCheckedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  // Clearing filters only widens the visible set, so a Library selection stays
  // valid and is kept. A Recently Deleted selection does not exist in All
  // prompts and is dropped.
  const clearFilters = () => {
    setSmartView('all'); setSearchDraft(''); setStatusFilter(''); lib.setSearch('');
    lib.setActiveTag(null); lib.setActiveCollection(null);
    if (smartView === 'trash') setCheckedIds([]);
  };
  const saveDetails = async () => {
    if (!selected || smartView === 'trash' || !detailsDraft.title.trim()) return;
    const update = (entry) => ({
      ...entry,
      title: detailsDraft.title.trim(),
      tags: uniqueStrings(detailsDraft.tags),
      collection: canUseCollections ? detailsDraft.collection : entry.collection,
      metadata: {
        ...(entry.metadata || {}), artwork: safeArtwork(detailsDraft.artwork), purpose: detailsDraft.purpose.trim(), owner: detailsDraft.owner.trim(),
        status: detailsDraft.status, riskLevel: detailsDraft.riskLevel,
        compatibility: uniqueStrings(detailsDraft.compatibility),
      },
      updatedAt: new Date().toISOString(),
    });
    const savedId = selected.id;
    const result = lib.saveEntryDetails ? await lib.saveEntryDetails(savedId, update) : lib.updateEntries([savedId], update);
    if (result === false || result === 0 || result === null) {
      setAnnouncement('Details were not saved. Your edits remain in the inspector.');
      return;
    }
    // Saved: drop the kept draft so the inspector shows the stored entry.
    pendingDetailsRef.current.delete(savedId);
    setDetailsRevision(revision => revision + 1);
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
        version: APP_VERSION, schemaVersion: 1, exportedAt: new Date().toISOString(),
        count: checkedEntries.length, library: checkedEntries,
        collections: uniqueStrings(checkedEntries.map((entry) => entry.collection)),
        folders: folderRecords.filter(folder => checkedEntries.some(entry => {
          let current = folderRecords.find(item => item.collection === entry.collection);
          while (current) { if (current.id === folder.id) return true; current = folderRecords.find(item => item.id === current.parentId); }
          return false;
        })),
      };
      const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
      const anchor = Object.assign(document.createElement('a'), { href: url, download: 'prompt-library-selection.json' });
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    }
    setAnnouncement(`Exported ${checkedEntries.length} prompts with complete metadata.`);
  };
  const persistFolders = async (next) => {
    if (typeof lib.saveFolders !== 'function') { setFolderError('Folder storage is unavailable.'); return false; }
    setFolderSaving(true); setFolderError('');
    const changes = new Map(folderRecords.map(folder => [folder.collection, next.find(item => item.id === folder.id)?.collection ?? '']).filter(([before, after]) => before !== after));
    try {
      const saved = await lib.saveFolders(next, changes);
      if (!saved) { setFolderError('Folder changes were not saved. Please retry.'); return false; }
      if (changes.has(lib.activeCollection)) lib.setActiveCollection(changes.get(lib.activeCollection) || null);
      return true;
    } finally { setFolderSaving(false); }
  };
  const createCollection = async () => {
    if (!canUseCollections) { openBilling?.('collections'); return; }
    const name = collectionDraft.trim(); if (!name || folderSaving) return;
    try {
      const id = crypto.randomUUID();
      const parent = folderRecords.find(folder => folder.id === collectionParent);
      const draft = [...folderRecords, { id, name: '__new__', parentId: null, collection: `__new__${id}`, artwork: {} }];
      const next = changeFolder(draft, id, { name, parentId: parent?.id || null });
      if (await persistFolders(next)) { setCollectionDraft(''); setAnnouncement(`Created folder ${name}.`); }
    } catch (error) { setFolderError(error.message); }
  };
  const saveCollectionRename = async () => {
    if (folderSaving) return;
    try {
      const next = changeFolder(folderRecords, renamingCollection, { name: renameCollectionDraft, parentId: collectionParent || null });
      if (await persistFolders(next)) { setRenamingCollection(''); setAnnouncement('Folder and prompt assignments updated.'); }
    } catch (error) { setFolderError(error.message); }
  };
  const deleteFolder = async folder => {
    if (folderRecords.some(item => item.parentId === folder.id)) { setFolderError('Move this folder’s subfolders before removing it. Prompts will be kept.'); return; }
    if (await persistFolders(folderRecords.filter(item => item.id !== folder.id))) {
      if (lib.activeCollection === folder.collection) chooseView('all');
      setAnnouncement('Folder removed; its prompts remain in All prompts.');
    }
  };

  const workspaceStyle = { '--pl-inspector-width': `${inspectorShown}px` };
  if (drawerWidth !== null) workspaceStyle['--pl-library-drawer-width'] = `${drawerWidth}px`;

  return <div ref={workspaceRef} style={workspaceStyle} className={`pl-library-workspace${drawerOpen ? ' is-drawer-open' : ' is-drawer-collapsed'}${drawerResizable ? ' has-drawer-resizer' : ''}${selected ? ' has-inspector-selection' : ''}${smartView === 'trash' ? ' is-trash-view' : ''}`}>
    <p className="sr-only" aria-live="polite">{announcement}</p>
    {compact && drawerOpen && <button type="button" className="pl-drawer-backdrop" aria-label="Close Library drawer" onClick={() => setDrawerOpen(false)} />}
    <aside ref={drawerRef} role={compact && drawerOpen ? 'dialog' : undefined} aria-modal={compact && drawerOpen ? 'true' : undefined} tabIndex={compact && drawerOpen ? -1 : undefined} id="library-drawer" className="pl-library-rail" aria-label="Library views" hidden={!drawerOpen}>
      <button type="button" className="pl-drawer-close" aria-label="Close Library drawer" onClick={() => setDrawerOpen(false)}>Hide Library drawer <Ic n="X" size={14} /></button>
      <div className="pl-library-rail-title"><div><p className="pl-eyebrow">Prompt index</p><h2>Library</h2></div><span>{lib.library.length}</span></div>
      <nav aria-label="Smart views">
        {SMART_VIEWS.map(({ id, icon, label, reorderHint, counted }) => <button key={id} type="button" title={reorderHint} aria-current={smartView === id ? 'page' : undefined} onClick={() => chooseView(id)}><Ic n={icon} size={14} /><span>{label}</span>{reorderHint && !counted ? <small className="sr-only">{`, ${reorderHint.toLowerCase()}`}</small> : <small>{smartViewCount(lib.library, id)}</small>}</button>)}
      </nav>

      <section className="pl-library-collections">
        <div className="pl-library-section-heading"><p className="pl-eyebrow">Collections</p><button type="button" onClick={() => { if (!canUseCollections) openBilling?.('collections'); else setShowCollectionManager((value) => !value); }} aria-expanded={canUseCollections ? showCollectionManager : undefined} aria-label={canUseCollections ? 'Manage collections' : 'Unlock collections'}><Ic n="Plus" size={12} /></button></div>
        {canUseCollections ? folderRows.filter(folder => !collapsedFolders.some(id => folderDescendants(folderRecords, id).has(folder.id) && id !== folder.id)).map(folder => <div key={folder.id} className="pl-library-folder" style={{ paddingLeft: `${Math.min(folder.depth, 6) * 10}px` }}>
          {folder.hasChildren && <button type="button" aria-label={`${collapsedFolders.includes(folder.id) ? 'Expand' : 'Collapse'} folder ${folder.name}`} aria-expanded={!collapsedFolders.includes(folder.id)} onClick={() => setCollapsedFolders(current => current.includes(folder.id) ? current.filter(item => item !== folder.id) : [...current, folder.id])}><Ic n={collapsedFolders.includes(folder.id) ? 'ArrowRight' : 'ChevronDown'} size={12} /></button>}
          <button type="button" className="pl-folder-select" title={folder.collection} aria-current={smartView === 'collection' && lib.activeCollection === folder.collection ? 'page' : undefined} onClick={() => { setSmartView('collection'); setCheckedIds([]); setSelectedId(null); lib.setActiveTag(null); lib.setActiveCollection(folder.collection); if (compact) setDrawerOpen(false); }}><Artwork value={folder.artwork} fallback="Folder" /><span>{folder.name}</span><small>{lib.library.filter(entry => folderRecords.some(item => item.collection === entry.collection && folderDescendants(folderRecords, folder.id).has(item.id))).length}</small></button>
        </div>) : <button type="button" className="pl-library-locked-row" onClick={() => openBilling?.('collections')}>Collections<ProBadge /></button>}
        {showCollectionManager && canUseCollections && <div className="pl-collection-manager">
          <label>Parent folder<select aria-label="Parent folder" value={collectionParent} onChange={event => setCollectionParent(event.target.value)}><option value="">Library root</option>{folderRows.map(folder => <option key={folder.id} value={folder.id}>{folder.collection}</option>)}</select></label>
          <div className="pl-collection-create"><input value={collectionDraft} onChange={(event) => setCollectionDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') createCollection(); }} placeholder="New collection" aria-label="New collection name" /><button type="button" onClick={createCollection} disabled={!collectionDraft.trim() || folderSaving}>Add</button></div>
          {folderRows.map(folder => renamingCollection === folder.id
            ? <div key={folder.id} className="pl-collection-edit"><input value={renameCollectionDraft} onChange={event => setRenameCollectionDraft(event.target.value)} aria-label={`Rename ${folder.name}`} /><button type="button" disabled={folderSaving} onClick={saveCollectionRename}>Save</button><button type="button" onClick={() => setRenamingCollection('')}>Cancel</button></div>
            : <div key={folder.id} className="pl-collection-manage-row"><span>{folder.collection}</span><button type="button" onClick={() => setArtworkCollection(artworkCollection === folder.id ? '' : folder.id)}>Artwork</button><button type="button" onClick={() => { setRenamingCollection(folder.id); setRenameCollectionDraft(folder.name); setCollectionParent(folder.parentId || ''); }}>Rename / Move</button><button type="button" disabled={folderSaving} onClick={() => deleteFolder(folder)} aria-label={`Remove folder ${folder.name}, keep prompts`}>Remove</button></div>)}
          {artworkCollection && <ArtworkPicker key={artworkCollection} label="Collection artwork" disabled={folderSaving} value={folderRecords.find(folder => folder.id === artworkCollection)?.artwork} onChange={artwork => persistFolders(folderRecords.map(folder => folder.id === artworkCollection ? { ...folder, artwork } : folder))} />}
          {folderError && <p role="alert">{folderError}</p>}
          <small>Select a parent, then add a folder or save Rename / Move. Parent views include subfolders. Removing a folder keeps its prompts. Artwork travels with workspace exports.</small>
        </div>}
      </section>

      <section><p className="pl-eyebrow">Tags</p><div className="pl-library-tag-cloud">
        {lib.allLibTags.map((tag) => <button key={tag} type="button" aria-pressed={smartView === 'tag' && lib.activeTag === tag} onClick={() => { setSmartView('tag'); setCheckedIds([]); setSelectedId(null); lib.setActiveCollection(null); lib.setActiveTag(tag); if (compact) setDrawerOpen(false); }}>#{tag}</button>)}
      </div></section>
      <button type="button" className="pl-trash-link" aria-current={smartView === 'trash' ? 'page' : undefined} onClick={() => chooseView('trash')}><Ic n="Trash2" size={14} /><span>Recently Deleted</span><small>{lib.trash.length}</small></button>
      <small className="pl-trash-retention-note">Items are permanently removed after 30 days.</small>
    </aside>

    {drawerResizable && <PanelResizer
      label="Resize Library drawer"
      className="pl-library-drawer-resizer"
      width={drawerWidth ?? layoutSize.drawer}
      min={LIBRARY_DRAWER_WIDTH.min}
      max={LIBRARY_DRAWER_WIDTH.max}
      defaultWidth={LIBRARY_DRAWER_WIDTH.default}
      onResize={setDrawerWidth}
      onReset={() => setDrawerWidth(null)}
      side="start"
      getEdge={() => drawerRef.current?.getBoundingClientRect().left}
    />}

    <section className="pl-library-index" aria-label="Prompt index">
      <header className="pl-library-toolbar">
        <button type="button" className="pl-secondary-button" aria-label={drawerOpen ? 'Hide Library drawer' : 'Show Library drawer'} aria-expanded={drawerOpen} aria-controls="library-drawer" onClick={() => setDrawerOpen(value => !value)}><Ic n="FolderOpen" size={14} /> Views</button>
        <label className="pl-library-search"><span className="sr-only">Search prompts</span><Ic n="Search" size={14} /><input data-testid="library-search" value={searchDraft} onChange={(event) => { setSearchDraft(event.target.value); lib.setSearch(event.target.value); }} placeholder="Search title, text, tags, metadata…" /></label>
        <select aria-label="Filter by status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">All statuses</option><option value="draft">Draft</option><option value="active">Active</option><option value="deprecated">Deprecated</option><option value={STATUS_NOT_SET}>Not set</option></select>
        <select aria-label="Sort prompts" value={lib.sortBy} onChange={(event) => lib.setSortBy(event.target.value)}><option value="newest">Newest</option><option value="oldest">Oldest</option><option value="most-used">Most used</option><option value="a-z">A–Z</option><option value="z-a">Z–A</option><option value="group">Collection</option><option value="manual">Manual</option></select>
        <div className="pl-layout-toggle" aria-label="Library layout"><button type="button" aria-pressed={layout === 'list'} onClick={() => setLayout('list')} aria-label="List view"><Ic n="List" size={14} /> List</button><button type="button" aria-pressed={layout === 'tiles'} onClick={() => setLayout('tiles')} aria-label="Tile view"><Ic n="LayoutGrid" size={14} /> Cards</button><button type="button" aria-pressed={layout === 'compact'} onClick={() => setLayout('compact')} aria-label="Compact view"><Ic n="List" size={12} /> Compact</button><button type="button" aria-pressed={layout === 'gallery'} onClick={() => setLayout('gallery')} aria-label="Gallery view"><Ic n="Eye" size={14} /> Gallery</button></div>
        <button type="button" className="pl-secondary-button" onClick={canExportLibrary ? lib.exportLib : () => openBilling?.('export')}><Ic n="Download" size={13} /> {canExportLibrary ? 'Export' : 'Export Pro'}</button>
        <button type="button" aria-label={canUsePacks ? 'Open pack studio' : 'Unlock pack studio'} className="pl-secondary-button" onClick={() => canUsePacks ? setShowPackStudio((value) => !value) : openBilling?.('packs')} aria-expanded={canUsePacks ? showPackStudio : undefined}><Ic n="Layers" size={13} /> {canUsePacks ? 'Packs' : 'Packs Pro'}</button>
        {canImportLibrary ? <><button type="button" className="pl-secondary-button" onClick={() => importInputRef.current?.click()}><Ic n="Upload" size={13} /> Import</button><input ref={importInputRef} className="sr-only" type="file" accept="application/json" aria-label="Import Prompt Lab workspace" aria-hidden="true" tabIndex={-1} onChange={lib.importLib} /></> : <button type="button" className="pl-secondary-button" onClick={() => openBilling?.('import')}><Ic n="Upload" size={13} /> Import Pro</button>}
      </header>

      {showPackStudio && canUsePacks && <PackStudioPanel m={m} lib={lib} compact onClose={() => setShowPackStudio(false)} />}
      {lib.starterLibraries?.length > 0 && <details className="mt-3 rounded-lg border p-3">
        <summary className="pl-starter-summary cursor-pointer text-sm font-semibold">Starter Libraries</summary>
        <div className="mt-3 flex flex-col gap-2">
          {lib.starterLibraries.map(pack => <StarterPackCard key={pack.id} pack={pack} m={m} onLoad={lib.loadStarterPack} />)}
        </div>
      </details>}
      {hasFilters && <div className="pl-library-filter-bar" aria-label="Active filters">
        {smartView !== 'all' && smartView !== 'collection' && smartView !== 'tag' && <FilterChip label={SMART_VIEWS.find((view) => view.id === smartView)?.label || 'Recently Deleted'} onRemove={() => chooseView('all')} />}
        {searchDraft.trim() && <FilterChip label={`Search: ${searchDraft.trim()}`} onRemove={() => { setSearchDraft(''); lib.setSearch(''); }} />}
        {statusFilter && <FilterChip label={`Status: ${statusFilter === STATUS_NOT_SET ? 'not set' : statusFilter}`} onRemove={() => setStatusFilter('')} />}
        {lib.activeCollection && <FilterChip label={`Collection: ${lib.activeCollection}`} onRemove={() => { lib.setActiveCollection(null); setSmartView('all'); }} />}
        {lib.activeTag && <FilterChip label={`Tag: ${lib.activeTag}`} onRemove={() => { lib.setActiveTag(null); setSmartView('all'); }} />}
        <button type="button" className="pl-library-clear-filters" onClick={clearFilters}>Clear all</button>
      </div>}

      {checkedIds.length > 0 && <div className="pl-bulk-bar" role="toolbar" aria-label="Bulk actions">
        <strong>{checkedIds.length} selected</strong>
        {smartView === 'trash' ? <>
          <button type="button" onClick={() => runBulk(() => checkedEntries.forEach((entry) => lib.restoreDeleted(entry.id)), `Restored ${checkedEntries.length} prompts.`)}>Restore</button>
          <button type="button" onClick={() => runBulk(() => lib.permanentlyDeleteEntries?.(checkedIds) ?? 0, `Permanently deleted ${checkedEntries.length} ${checkedEntries.length === 1 ? 'prompt' : 'prompts'}.`)}><Ic n="Trash2" size={13} /> Delete forever</button>
        </> : <>
          {canUseCollections ? <label>Move to<select aria-label="Move selected prompts to collection" value={bulkCollection} onChange={(event) => { const value = event.target.value; setBulkCollection(value); if (value) runBulk(() => lib.moveEntriesToCollection(checkedIds, value), `Moved ${checkedIds.length} prompts to ${value}.`); }}><option value="">Choose…</option>{lib.collections.map((item) => <option key={item}>{item}</option>)}</select></label> : <button type="button" onClick={() => openBilling?.('collections')}>Collections<ProBadge /></button>}
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

      {artworkTarget && smartView !== 'trash' && lib.library.some(entry => entry.id === artworkTarget.id) && <ArtworkPopover key={artworkTarget.id} entry={lib.library.find(entry => entry.id === artworkTarget.id)} trigger={artworkTarget.trigger} onSave={saveCardArtwork} onClose={() => setArtworkTarget(null)} />}
      <div className="pl-library-index-heading">
        <div><p className="pl-eyebrow">{smartView === 'collection' ? lib.activeCollection : smartView === 'tag' ? `#${lib.activeTag}` : smartView === 'trash' ? 'Recently Deleted' : SMART_VIEWS.find((view) => view.id === smartView)?.label || 'All prompts'}</p><h2>{entries.length} {entries.length === 1 ? 'prompt' : 'prompts'}</h2></div>
        <div className="pl-library-index-actions">{entries.length > 0 && <label className="pl-library-select-all"><input type="checkbox" checked={allVisibleChecked} onChange={() => setCheckedIds(allVisibleChecked ? [] : entries.map((entry) => entry.id))} /> Select all</label>}</div>
      </div>

      {entries.length === 0
        ? <div className="pl-library-empty"><Ic n={smartView === 'trash' ? 'Trash2' : 'Search'} size={22} /><h3>Nothing here yet</h3><p>{hasFilters ? 'Change or clear the active filters.' : 'Save a prompt from the Editor to start your reusable library.'}</p>{hasFilters ? <button type="button" onClick={clearFilters}>Clear filters</button> : <p>Use New Prompt in the app header to start one.</p>}</div>
        : <div className={`pl-library-results is-${layout}`} role="list" aria-label="Saved prompts">
          {entries.map((entry, index) => <article key={entry.id} className={`pl-library-card${selectedId === entry.id ? ' is-selected' : ''}`} role="listitem">
            <label className="pl-library-card-select"><input type="checkbox" aria-label={`Select ${entry.title}`} checked={checkedIds.includes(entry.id)} onChange={() => toggleChecked(entry.id)} /></label>
            <div className={`pl-library-card-artwork${Object.values(safeArtwork(entry.metadata?.artwork)).some(Boolean) ? '' : ' is-empty'}`}>
              <button type="button" disabled={smartView === 'trash'} aria-label={`Change artwork for ${entry.title}`} aria-haspopup="dialog" aria-expanded={artworkTarget?.id === entry.id} onClick={event => setArtworkTarget({ id: entry.id, trigger: event.currentTarget })}><Artwork value={entry.metadata?.artwork} /></button>
              {layout === 'gallery' && !Object.values(safeArtwork(entry.metadata?.artwork)).some(Boolean) && smartView !== 'trash' && <button type="button" className="pl-artwork-add" aria-label={`Add image for ${entry.title}`} onClick={event => setArtworkTarget({ id: entry.id, trigger: event.currentTarget })}>Add image</button>}
            </div>
            <button type="button" className="pl-library-card-open" aria-pressed={selectedId === entry.id} aria-label={`Inspect ${entry.title}`} onClick={() => selectEntry(entry)}>
              <span className="pl-library-card-copy"><span className="pl-library-card-title"><strong>{entry.title}</strong>{entry.favorite && <Ic n="Star" size={12} className="text-amber-400" />}{entry.metadata?.suite?.verdict && <span className={entry.metadata.suite.verdict === 'pass' ? 'pl-suite-pass' : 'pl-suite-fail'}>{entry.metadata.suite.verdict === 'pass' ? '✓ suite' : '✗ suite'}</span>}</span><span className="pl-library-card-excerpt">{entryText(entry).slice(0, layout === 'tiles' ? 180 : 260)}</span><span className="pl-library-card-labels">{entry.collection && <span>{entry.collection}</span>}{(entry.tags || []).slice(0, 4).map((tag) => <span key={tag}>#{tag}</span>)}</span></span>
              <span className="pl-library-card-meta"><span title={`${getVersionCount(entry)} version${getVersionCount(entry) === 1 ? '' : 's'}, including the current one`}>{getVersionCount(entry)} ver</span><span>{entry.useCount || 0} uses</span><time>{smartView === 'trash' ? trashExpiryLabel(entry) : formatEntryDate(entry)}</time></span>
            </button>
            <div className="pl-library-card-actions">
              {lib.sortBy === 'manual' && !['trash', 'recent', 'frequent'].includes(smartView) && <>
                <button type="button" aria-label={`Move ${entry.title} up`} title="Move up" disabled={index === 0} onClick={() => lib.moveLibraryEntryByOffset(entry.id, -1, entries)}><Ic n="ChevronUp" size={13} /></button>
                <button type="button" aria-label={`Move ${entry.title} down`} title="Move down" disabled={index === entries.length - 1} onClick={() => lib.moveLibraryEntryByOffset(entry.id, 1, entries)}><Ic n="ChevronDown" size={13} /></button>
              </>}
              {smartView === 'trash' ? <><button type="button" onClick={() => lib.restoreDeleted(entry.id)}>Restore</button><button type="button" onClick={() => lib.permanentlyDelete(entry.id)} aria-label={`Permanently delete ${entry.title}`} title="Delete forever"><Ic n="Trash2" size={13} /></button></> : <><button type="button" onClick={() => loadEntry(entry)}>Editor</button><button type="button" onClick={() => copy(entryText(entry))} aria-label={`Copy ${entry.title}`} title="Copy prompt"><Ic n="Copy" size={13} /></button><button type="button" onClick={() => lib.setFavorite(entry.id)} aria-label={`${entry.favorite ? 'Unfavorite' : 'Favorite'} ${entry.title}`} aria-pressed={Boolean(entry.favorite)} title={entry.favorite ? 'Remove from favorites' : 'Add to favorites'}><Ic n="Star" size={13} /></button></>}
            </div>
          </article>)}
        </div>}
    </section>

    <PanelResizer
      label="Resize prompt inspector"
      className="pl-inspector-resizer"
      width={inspectorShown}
      min={INSPECTOR_WIDTH.min}
      max={layoutSize.inspectorMax}
      defaultWidth={INSPECTOR_WIDTH.default}
      onResize={resizeInspector}
      side="end"
      getEdge={() => workspaceRef.current?.getBoundingClientRect().right}
    />
    {/* At 1100 px and below the inspector floats over the list. The scrim makes
        that a real drawer: the list underneath is dimmed and a tap on it closes
        the inspector instead of acting on a half-covered card (V-06). */}
    {selected && <button type="button" className="pl-inspector-scrim" data-dialog-scrim aria-hidden="true" tabIndex={-1} onClick={closeInspector} />}
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
          <button type="button" className="pl-library-mobile-back" onClick={closeInspector}><Ic n="ArrowRight" size={13} /> Back to prompts</button>
          <div className="pl-library-inspector-heading"><div><p className="pl-eyebrow">{smartView === 'trash' ? 'Recently Deleted' : 'Inspector'}</p><h2 id="prompt-inspector-title">{selected.title}</h2></div><button type="button" className="pl-icon-button" onClick={closeInspector} aria-label="Close prompt inspector" title="Close inspector"><Ic n="X" size={14} /></button></div>
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
          <InspectorContent m={m} selected={selected} smartView={smartView} inspectorTab={inspectorTab} detailsDraft={detailsDraft} setDetailsDraft={editDetails} detailsDirty={detailsDirty} saveDetails={saveDetails} discardDetails={discardDetails} lib={lib} canUseCollections={canUseCollections} openBilling={openBilling} copy={copy} testCasesByPrompt={testCasesByPrompt} testCaseControls={testCaseControls} />
        </div>
        <footer>
          {smartView === 'trash' ? <><button type="button" className="pl-primary-button" onClick={() => { lib.restoreDeleted(selected.id); setSelectedId(null); }}>Restore prompt</button><button type="button" className="pl-secondary-button" onClick={() => { lib.permanentlyDelete(selected.id); setSelectedId(null); }}>Delete forever</button></> : <>
            <button type="button" className="pl-primary-button" onClick={() => loadEntry(selected)}>Open in Editor</button>
            <button type="button" className="pl-secondary-button" onClick={() => addToComposer?.(selected)}>Composer</button>
            <button type="button" className="pl-secondary-button" onClick={() => sendToABTest?.(selected)}>Compare{compareLocked && <ProBadge />}</button>
            <button type="button" className="pl-secondary-button" onClick={() => copy(entryText(selected))}>Copy</button>
            <button type="button" className="pl-icon-button" onClick={() => lib.setFavorite(selected.id)} aria-label={`${selected.favorite ? 'Unfavorite' : 'Favorite'} prompt`} aria-pressed={Boolean(selected.favorite)} title={selected.favorite ? 'Remove from favorites' : 'Add to favorites'}><Ic n="Star" size={14} /></button>
            <button type="button" className="pl-icon-button" onClick={() => lib.duplicateEntry(selected.id)} aria-label="Duplicate prompt" title="Duplicate prompt"><Ic n="CopyPlus" size={14} /></button>
            <button type="button" className="pl-icon-button" onClick={() => { const deleted = lib.del(selected.id); if (deleted !== false) setSelectedId(null); }} aria-label="Move prompt to Recently Deleted" title="Move to Recently Deleted"><Ic n="Trash2" size={14} /></button>
          </>}
        </footer>
      </>}
    </aside>
  </div>;
}
