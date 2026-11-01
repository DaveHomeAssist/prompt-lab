import { reconcileFolders, mergeFolders } from '../lib/collectionFolders.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { APP_VERSION, DEFAULT_LIBRARY_SEEDS } from '../constants.js';
import { encodeShare, looksSensitive } from '../promptUtils.js';
import {
  createPromptEntry,
  getVersionCount,
  normalizeEntry,
  normalizeLibrary,
  restorePromptVersion,
  suggestTitleFromText,
  updatePromptEntry,
} from '../lib/promptSchema.js';
import { loadJson, saveJson, removeKey, storageKeys, getAnticipation, setAnticipation } from '../lib/storage.js';
import { commitLibrarySave } from '../lib/libraryJournal.js';
import { assertScratchJournalReady, commitScratchSave } from '../lib/scratchJournal.js';
import { ensureString } from '../lib/utils.js';
import { normalizeTagList } from '../lib/tagSchema.js';
import {
  getLoadedPacks,
  getStarterLibraries,
  loadStarterPack as loadPack,
} from '../lib/seedTransform.js';
import {
  LEGACY_LIBRARY_CHECK_KEY,
  isSeedOnlyLibrary,
  mergeCollections,
  requestLegacyLibraryPayload,
  shouldAttemptLegacyWebMigration,
} from '../lib/legacyLibraryMigration.js';
import {
  matchesLibrarySearch,
  mergeLibraryEntries,
} from '../lib/libraryMatching.js';
import { filterDeletedLibraryRecords, isLibraryDeletionKey, markLibraryCleared, markLibraryDeleted, readLibraryDeletionState, stampLibraryGeneration } from '../lib/libraryDeletion.js';
import { buildWorkspaceImportPreview, normalizeWorkspaceImportSource, workspaceImportRevision } from '../lib/workspaceImportPreview.js';
import { loadPackRegistry, stampPackMembership } from '../lib/packStore.js';
import { listEvalRuns, listTestCases, saveEvalRun, saveTestCase } from '../experimentStore.js';
import { getNewestSortTimestamp, sortLibraryEntries } from '../lib/librarySort.js';

const VALID_SORTS = ['newest', 'oldest', 'most-used', 'a-z', 'z-a', 'group', 'manual'];
const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const LIBRARY_CONFLICT_MESSAGE = 'Library changed in another tab. Latest changes loaded. Review and retry, or save your editor draft as a new prompt.';

function recordClock(entry) {
  const value = entry?.deletedAt || entry?.updatedAt || entry?.updated_at || entry?.createdAt;
  const parsed = value ? new Date(value).getTime() : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function stampRecordMutation(previous, next) {
  const nextClock = Math.max(Date.now(), recordClock(previous) + 1, recordClock(next));
  const updatedAt = new Date(nextClock).toISOString();
  const stamped = { ...next, updatedAt };
  return normalizeEntry({ ...stamped, completeness: null }, updatedAt) || stamped;
}

export function isTrashEntryRestorable(entry, now = Date.now()) {
  const deletedAt = new Date(entry?.deletedAt || 0).getTime();
  return Number.isFinite(deletedAt) && deletedAt >= now - TRASH_RETENTION_MS;
}

function reconcileLibraryRecords(localLibrary, localTrash, storedLibrary, storedTrash) {
  const candidates = new Map();
  const add = (entry, deleted) => {
    if (!entry?.id) return;
    const candidate = { ...entry, deletedAt: deleted ? (entry.deletedAt || new Date().toISOString()) : null };
    const current = candidates.get(entry.id);
    const currentTombstone = current?.tombstoneVersion || 0;
    const nextTombstone = candidate.tombstoneVersion || 0;
    if (!current
      || nextTombstone > currentTombstone
      || (nextTombstone === currentTombstone && recordClock(candidate) > recordClock(current))) {
      candidates.set(entry.id, candidate);
    }
  };
  normalizeLibrary(localLibrary).forEach((entry) => add(entry, false));
  normalizeLibrary(localTrash).forEach((entry) => add(entry, true));
  normalizeLibrary(storedLibrary).forEach((entry) => add(entry, false));
  normalizeLibrary(storedTrash).forEach((entry) => add(entry, true));
  const all = [...candidates.values()];
  return {
    library: all.filter((entry) => !entry.deletedAt),
    trash: all.filter((entry) => entry.deletedAt),
  };
}

// Sorting lives in lib/librarySort.js so the Library and the Prompts view
// beside Write share it; re-exported here for existing callers.
export { getNewestSortTimestamp, sortLibraryEntries };

function deriveCollectionsFromLibrary(entries) {
  if (!Array.isArray(entries)) return [];
  return [...new Set(
    entries
      .map((entry) => ensureString(entry?.collection).trim())
      .filter(Boolean),
  )];
}

export default function usePromptLibrary(notify) {
  const [library, setLibraryState] = useState([]);
  const [trash, setTrash] = useState([]);
  const [libReady, setLibReady] = useState(false);
  const [collections, setCollections] = useState([]);
  const [folderRecords, setFolderRecords] = useState([]);
  const foldersRef = useRef([]);
  const folders = useMemo(() => reconcileFolders(folderRecords, collections), [folderRecords, collections]);
  const [smartView, setSmartView] = useState('all');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [activeTag, setActiveTag] = useState(null);
  const [activeCollection, setActiveCollection] = useState(null);
  const [sortBy, _setSortBy] = useState(() => {
    const stored = loadJson(storageKeys.sortBy, 'newest');
    return VALID_SORTS.includes(stored) ? stored : 'newest';
  });
  const setSortBy = useCallback((value) => {
    const nextSort = VALID_SORTS.includes(value) ? value : 'newest';
    _setSortBy(nextSort);
    saveJson(storageKeys.sortBy, nextSort);
  }, []);
  const [expandedId, setExpandedId] = useState(null);
  const [expandedVersionId, setExpandedVersionId] = useState(null);
  const [diffVersionIdx, setDiffVersionIdx] = useState(null);
  const [shareId, setShareId] = useState(null);
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [draggingLibraryId, setDraggingLibraryId] = useState(null);
  const [dragOverLibraryId, setDragOverLibraryId] = useState(null);
  const [recoveringLegacyLibrary, setRecoveringLegacyLibrary] = useState(false);
  const [pendingImport, setPendingImport] = useState(null);
  const importBusyRef = useRef(false);
  const importReadRef = useRef(0);
  useEffect(() => () => { importReadRef.current += 1; }, []);
  const pendingImportRef = useRef(null);
  const [importPreview, setImportPreview] = useState(null);
  const importPreviewRef = useRef(null);
  const [importApplying, setImportApplying] = useState(false);
  const [loadedStarterPackIds, setLoadedStarterPackIds] = useState(() => getLoadedPacks());
  const libraryRef = useRef(library);
  const trashRef = useRef(trash);
  const generationRef = useRef('0');
  const collectionsRef = useRef(collections);
  const notifyRef = useRef(notify);
  const legacyRecoveryAttemptedRef = useRef(false);
  const libraryPersistFailedRef = useRef(false);
  const librarySnapshotRef = useRef({ raw: undefined, library: [] });
  const libraryConflictRef = useRef('');
  const saveAttemptRef = useRef(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const setLibrary = useCallback((update) => {
    const proposed = typeof update === 'function' ? update(libraryRef.current) : update;
    const next = filterDeletedLibraryRecords(stampLibraryGeneration(proposed, generationRef.current));
    libraryRef.current = next;
    setLibraryState(next);
  }, []);

  const adoptStoredLibrary = (raw) => {
    generationRef.current = readLibraryDeletionState().generation;
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) throw new Error('Library storage is not a prompt list.');
    const incoming = filterDeletedLibraryRecords(normalizeLibrary(parsed));
    const presentIds = new Set(incoming.map(entry => entry.id));
    // Keep independently saved records omitted by a stale whole-library write,
    // but never carry their old content over a newer record with the same ID.
    const retained = librarySnapshotRef.current.library.filter(entry => !presentIds.has(entry.id));
    const reconciled = reconcileLibraryRecords(retained, [], incoming, loadJson(storageKeys.trash, []));
    const next = stampLibraryGeneration(filterDeletedLibraryRecords(reconciled.library), generationRef.current);
    librarySnapshotRef.current = { raw, library: next };
    setLibrary(next);
  };
  const rejectStaleLibrary = (raw) => {
    adoptStoredLibrary(raw);
    const message = LIBRARY_CONFLICT_MESSAGE;
    libraryConflictRef.current = message;
    setSaveError(message);
    notifyRef.current?.(message);
    return false;
  };
  const notifyWriteFailure = (message) => notify(libraryConflictRef.current || message);
  const checkLibrarySnapshot = (expectedRaw = librarySnapshotRef.current.raw) => {
    libraryConflictRef.current = '';
    try {
      const stored = localStorage.getItem(storageKeys.library);
      if (expectedRaw === undefined) return false;
      if (stored !== expectedRaw) {
        const parsed = stored ? JSON.parse(stored) : [];
        if (!Array.isArray(parsed)) return false;
        const currentRecords = filterDeletedLibraryRecords(normalizeLibrary(parsed));
        const observedRecords = filterDeletedLibraryRecords(librarySnapshotRef.current.library);
        // Removing records already invalidated by a clear/deletion marker is
        // not a concurrent edit. An intentional new save may follow cleanup.
        if (expectedRaw === librarySnapshotRef.current.raw && JSON.stringify(currentRecords) === JSON.stringify(observedRecords)) {
          librarySnapshotRef.current.raw = stored;
          return true;
        }
        return rejectStaleLibrary(stored);
      }
      return true;
    } catch { return false; }
  };
  const persistRecords = (key, records, expectedRaw = librarySnapshotRef.current.raw) => {
    if (key === storageKeys.library && !checkLibrarySnapshot(expectedRaw)) return false;
    const next = filterDeletedLibraryRecords(stampLibraryGeneration(records, generationRef.current));
    const ok = saveJson(key, next) && next.length === records.length;
    if (ok && key === storageKeys.library) {
      librarySnapshotRef.current = { raw: JSON.stringify(next), library: next };
      setSaveError(error => error === LIBRARY_CONFLICT_MESSAGE ? '' : error);
    }
    return ok;
  };

  useEffect(() => { libraryRef.current = library; }, [library]);
  useEffect(() => { trashRef.current = trash; }, [trash]);
  useEffect(() => { collectionsRef.current = collections; }, [collections]);
  useEffect(() => { notifyRef.current = notify; }, [notify]);

  const markLegacyLibraryChecked = useCallback(() => {
    saveJson(LEGACY_LIBRARY_CHECK_KEY, true);
  }, []);

  const applyLegacyPayload = useCallback((payload) => {
    if (!payload || !Array.isArray(payload.library)) {
      return { importedCount: 0, reachable: false, hasLegacyLibrary: false };
    }

    const previousCollections = collectionsRef.current;
    const libraryResult = mergeLibraryEntries(libraryRef.current, payload.library);
    const nextCollections = Array.isArray(payload.collections) && payload.collections.length > 0
      ? mergeCollections(previousCollections, payload.collections)
      : previousCollections;

    libraryRef.current = libraryResult.library;
    collectionsRef.current = nextCollections;
    setLibrary(libraryResult.library);
    if (nextCollections !== previousCollections) {
      setCollections(nextCollections);
    }

    return {
      importedCount: libraryResult.importedCount,
      reachable: true,
      hasLegacyLibrary: payload.library.length > 0,
    };
  }, []);

  useEffect(() => {
    try { librarySnapshotRef.current.raw = localStorage.getItem(storageKeys.library); } catch { /* Writes remain unavailable. */ }
    const storedLibrary = loadJson(storageKeys.library, null);
    const hasStoredLibrary = Array.isArray(storedLibrary);
    const deletionState = readLibraryDeletionState();
    generationRef.current = deletionState.generation;
    const initialLibrary = stampLibraryGeneration(filterDeletedLibraryRecords(
      normalizeLibrary(hasStoredLibrary ? storedLibrary : DEFAULT_LIBRARY_SEEDS), deletionState,
    ), deletionState.generation);
    librarySnapshotRef.current.library = initialLibrary;
    const storedTrash = normalizeLibrary(loadJson(storageKeys.trash, []));
    const expiredIds = storedTrash.filter((entry) => !isTrashEntryRestorable(entry)).map((entry) => entry.id);
    try { markLibraryDeleted(expiredIds); } catch { notifyRef.current?.('Expired prompt cleanup could not be saved.'); }
    const initialTrash = stampLibraryGeneration(filterDeletedLibraryRecords(storedTrash)
      .filter((entry) => isTrashEntryRestorable(entry)), deletionState.generation);
    const storedCollections = loadJson(storageKeys.collections, null);
    const derivedCollections = deriveCollectionsFromLibrary(initialLibrary);
    const initialCollections = Array.isArray(storedCollections)
      ? mergeCollections(storedCollections, derivedCollections)
      : (!hasStoredLibrary ? ['Handoff Templates'] : derivedCollections);

    libraryRef.current = initialLibrary;
    collectionsRef.current = initialCollections;
    setLibrary(initialLibrary);
    trashRef.current = initialTrash;
    setTrash(initialTrash);
    setCollections(initialCollections);
    try { foldersRef.current = reconcileFolders(loadJson(storageKeys.folders, []), initialCollections); }
    catch { foldersRef.current = reconcileFolders([], initialCollections); notify('Folder metadata could not be read. Existing collections are preserved.'); }
    setFolderRecords(foldersRef.current);
    setLoadedStarterPackIds(getLoadedPacks());
    setLibReady(true);

    const alreadyCheckedLegacy = loadJson(LEGACY_LIBRARY_CHECK_KEY, false) === true;
    const shouldAttemptLegacyRecovery = shouldAttemptLegacyWebMigration(window.location.origin, window.location.protocol)
      && !alreadyCheckedLegacy
      && !legacyRecoveryAttemptedRef.current
      && (!hasStoredLibrary || storedLibrary.length === 0 || isSeedOnlyLibrary(initialLibrary));

    if (!shouldAttemptLegacyRecovery) return undefined;

    let cancelled = false;
    legacyRecoveryAttemptedRef.current = true;
    setRecoveringLegacyLibrary(true);
    requestLegacyLibraryPayload({ currentOrigin: window.location.origin })
      .then((payload) => {
        if (cancelled) return;
        const result = applyLegacyPayload(payload);
        markLegacyLibraryChecked();
        if (!result.reachable) return;
        if (result.importedCount > 0) {
          notifyRef.current?.(`Recovered ${result.importedCount} prompts from your legacy web library.`);
        }
      })
      .finally(() => {
        if (!cancelled) setRecoveringLegacyLibrary(false);
      });

    return () => {
      cancelled = true;
    };
  }, [applyLegacyPayload, markLegacyLibraryChecked]);

  useEffect(() => {
    if (!libReady) return undefined;
    const expectedRaw = librarySnapshotRef.current.raw;
    const timeoutId = window.setTimeout(() => {
      const ok = persistRecords(storageKeys.library, library, expectedRaw);
      // Surface the first rejected background write instead of failing silently;
      // reset once a write lands so a later failure notifies again.
      if (!ok && !libraryPersistFailedRef.current) {
        libraryPersistFailedRef.current = true;
        if (!libraryConflictRef.current) notifyRef.current?.('Library changes could not be saved. Browser storage may be full.');
      } else if (ok) {
        libraryPersistFailedRef.current = false;
      }
    }, 120);
    return () => window.clearTimeout(timeoutId);
  }, [library, libReady]);

  useEffect(() => {
    if (!libReady) return undefined;
    const timeoutId = window.setTimeout(() => persistRecords(storageKeys.trash, trash), 120);
    return () => window.clearTimeout(timeoutId);
  }, [trash, libReady]);

  useEffect(() => {
    if (!libReady) return undefined;
    const purgeExpiredTrash = () => {
      const expiredIds = trashRef.current.filter((entry) => !isTrashEntryRestorable(entry)).map((entry) => entry.id);
      if (!expiredIds.length) return;
      try { markLibraryDeleted(expiredIds); } catch {
        notifyRef.current?.('Expired prompt cleanup could not be saved.');
        return;
      }
      const nextTrash = filterDeletedLibraryRecords(trashRef.current);
      trashRef.current = nextTrash;
      setTrash(nextTrash);
    };
    const intervalId = window.setInterval(purgeExpiredTrash, 60 * 60 * 1000);
    return () => window.clearInterval(intervalId);
  }, [libReady]);

  useEffect(() => {
    if (!libReady) return undefined;
    const timeoutId = window.setTimeout(() => {
      saveJson(storageKeys.collections, collections);
    }, 120);
    return () => window.clearTimeout(timeoutId);
  }, [collections, libReady]);

  useEffect(() => {
    if (!libReady) return undefined;
    const handleStorage = (event) => {
      if (![storageKeys.library, storageKeys.trash, storageKeys.collections, storageKeys.folders].includes(event.key) && !isLibraryDeletionKey(event.key)) return;
      const deletionState = readLibraryDeletionState();
      const generationChanged = generationRef.current !== deletionState.generation;
      generationRef.current = deletionState.generation;
      let storedRaw;
      try { storedRaw = localStorage.getItem(storageKeys.library); }
      catch { notifyRef.current?.('Library changes from another tab could not be read. Your editor draft is unchanged.'); return; }
      const externalLibraryChange = storedRaw !== librarySnapshotRef.current.raw;
      if (externalLibraryChange) {
        const pendingChanges = JSON.stringify(libraryRef.current) !== JSON.stringify(librarySnapshotRef.current.library);
        if (pendingChanges) notifyRef.current?.('Library changed in another tab before your Library changes were saved. Latest changes loaded; review and retry. Your editor draft is unchanged.');
        try { adoptStoredLibrary(storedRaw); }
        catch { notifyRef.current?.('Library changes from another tab could not be read. Your editor draft is unchanged.'); return; }
      }
      const reconciled = reconcileLibraryRecords(
        libraryRef.current,
        trashRef.current,
        loadJson(storageKeys.library, []),
        loadJson(storageKeys.trash, []),
      );
      reconciled.library = filterDeletedLibraryRecords(reconciled.library, deletionState);
      libraryRef.current = reconciled.library;
      const retainedTrash = filterDeletedLibraryRecords(reconciled.trash, deletionState).filter((entry) => isTrashEntryRestorable(entry));
      trashRef.current = retainedTrash;
      setLibrary(reconciled.library);
      setTrash(retainedTrash);
      const mergedCollections = mergeCollections(
        generationChanged ? [] : collectionsRef.current,
        generationChanged ? [] : loadJson(storageKeys.collections, []),
      );
      collectionsRef.current = mergedCollections;
      setCollections(mergedCollections);
      try { foldersRef.current = reconcileFolders(loadJson(storageKeys.folders, []), mergedCollections); setFolderRecords(foldersRef.current); }
      catch { notifyRef.current?.('Folder changes from another tab could not be read.'); }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [libReady]);

  // `stamp: false` is for bookkeeping that is not an edit (opening a prompt).
  // Those writes keep updatedAt, so the Updated date and Newest order stay true.
  const updateLibraryEntry = (entryId, updater, { stamp = true } = {}) => {
    let changed = false;
    const nextLibrary = libraryRef.current.map(entry => {
      if (entry.id !== entryId) return entry;
      const next = updater(entry);
      if (!next || next === entry) return entry;
      changed = true;
      return stamp ? stampRecordMutation(entry, next) : next;
    });
    if (changed) {
      libraryRef.current = nextLibrary;
      setLibrary(nextLibrary);
    }
    return changed;
  };

  const persistNewEntry = (payload, {
    sourceEntry = null,
    savedFromDeletedTarget = false,
    copyAsNew = false,
  } = {}) => {
    const source = normalizeEntry(sourceEntry);
    const sourceMetadata = source?.metadata && savedFromDeletedTarget
      ? Object.fromEntries(
        Object.entries(source.metadata).filter(([key]) => (
          key !== 'packId' && key !== 'packName' && key !== 'packSource'
        )),
      )
      : source?.metadata;
    const entry = createPromptEntry({
      ...(source && !copyAsNew ? {
        versions: source.versions,
        testCases: source.testCases,
        goldenResponse: source.goldenResponse,
        goldenThreshold: source.goldenThreshold,
        inputs: source.inputs,
        metadata: sourceMetadata,
      } : {}),
      ...(source && copyAsNew ? {
        inputs: source.inputs,
        kind: source.kind,
        metadata: {
          ...(sourceMetadata || {}),
          lineagePromptId: source.id || '',
        },
      } : {}),
      ...payload,
      useCount: 0,
    });
    const nextLibrary = [entry, ...libraryRef.current];
    if (!persistRecords(storageKeys.library, nextLibrary)) {
      notifyWriteFailure('Save failed. Browser storage may be full. Your draft is still in the editor.');
      return null;
    }
    libraryRef.current = nextLibrary;
    setLibrary(nextLibrary);
    const message = savedFromDeletedTarget
      ? 'The original prompt was deleted. Saved this draft as a new prompt.'
      : `Saved ${entry.title} as version 1.`;
    const result = {
      id: entry.id,
      title: entry.title,
      versionId: entry.currentVersionId,
      versionNumber: 1,
    };
    return { result: savedFromDeletedTarget || copyAsNew ? { ...result, savedAsNew: true } : result, message };
  };

  const saveToLocalLibrary = ({
    raw,
    enhanced,
    variants,
    notes,
    resultMeta,
    tags,
    title,
    collection,
    editingId,
    changeNote,
    sourceEntry,
    metadata,
    kind,
    sourceNoteId,
    savedFromDeletedTarget = false,
    copyAsNew = false,
  }) => {
    const cleanTitle = ensureString(title).trim() || suggestTitleFromText(enhanced || raw);
    const payload = {
      title: cleanTitle,
      original: ensureString(raw),
      enhanced: ensureString(enhanced).trim() ? ensureString(enhanced) : ensureString(raw),
      variants: Array.isArray(variants) ? variants : [],
      notes: ensureString(notes),
      resultMeta,
      tags: normalizeTagList(tags),
      collection: ensureString(collection),
      ...(metadata && typeof metadata === 'object' ? { metadata } : {}),
      ...(ensureString(kind).trim() ? { kind: ensureString(kind).trim() } : {}),
      ...(ensureString(sourceNoteId).trim() ? { sourceNoteId: ensureString(sourceNoteId).trim() } : {}),
    };

    // The write is attempted before any success feedback: a rejected write
    // (e.g. QuotaExceededError) must fail visibly and leave the draft intact.
    if (editingId) {
      let savedTitle = cleanTitle;
      let found = false;
      const nextLibrary = libraryRef.current.map(entry => {
        if (entry.id !== editingId) return entry;
        found = true;
        const next = updatePromptEntry(entry, payload, { source: 'manual_save', changeNote: ensureString(changeNote) });
        savedTitle = next?.title || savedTitle;
        return next || entry;
      });
      if (!found) {
        return persistNewEntry(payload, {
          sourceEntry,
          savedFromDeletedTarget: true,
        });
      }
      if (!persistRecords(storageKeys.library, nextLibrary)) {
        notifyWriteFailure('Save failed. Browser storage may be full. Your changes are still in the editor.');
        return null;
      }
      libraryRef.current = nextLibrary;
      setLibrary(nextLibrary);
      const savedEntry = nextLibrary.find((entry) => entry.id === editingId);
      const versionNumber = getVersionCount(savedEntry);
      return {
        result: {
          id: editingId,
          title: savedTitle,
          versionId: savedEntry?.currentVersionId || null,
          versionNumber,
        },
        message: `Saved ${savedTitle} as version ${versionNumber}.`,
      };
    }

    return persistNewEntry(payload, {
      sourceEntry,
      savedFromDeletedTarget,
      copyAsNew,
    });
  };

  const doSave = (args) => {
    const signature = JSON.stringify(args);
    const previous = saveAttemptRef.current;
    if (!checkLibrarySnapshot()) {
      notifyWriteFailure('Save failed. Browser storage could not be read. Your draft is still available.');
      return null;
    }
    const currentEntry = libraryRef.current.find(entry => entry.id === args.editingId);
    const retryOwnVersion = previous?.signature === signature && previous.prepared?.result.versionId === currentEntry?.currentVersionId;
    if (currentEntry && args.expectedVersionId && currentEntry.currentVersionId !== args.expectedVersionId && !retryOwnVersion) {
      const message = args.expectedVersionId === 'unverified'
        ? 'This older editor session has no saved version information. Your draft is unchanged. Reload the prompt from Library, or save this draft as a new prompt.'
        : 'This prompt has a newer version in another tab. Your draft is unchanged. Reload the prompt from Library, or save this draft as a new prompt.';
      setSaveError(message);
      notify(message);
      return null;
    }
    // Double-clicks share the same save; another draft must not be reported as
    // saved while this one is pending. A failed identical retry reuses its ID
    // and version rather than creating a second Library record.
    if (previous?.pending) return previous.signature === signature ? previous.pending : null;
    const prepared = previous?.signature === signature ? previous.prepared : saveToLocalLibrary(args);
    if (!prepared) return null;
    const attempt = { signature, prepared, pending: null };
    saveAttemptRef.current = attempt;
    const succeed = () => {
      if (!libraryRef.current.some(entry => entry.id === prepared.result.id)) {
        setSaveError('Save interrupted — this prompt was deleted. Your draft is still available.');
        saveAttemptRef.current = null;
        return null;
      }
      const storedEntry = loadJson(storageKeys.library, []).find(entry => entry.id === prepared.result.id);
      if (storedEntry?.currentVersionId !== prepared.result.versionId) {
        const message = 'Another tab changed this prompt while saving. Your editor draft is unchanged. Review Library before saving again.';
        setSaveError(message);
        notify(message);
        saveAttemptRef.current = null;
        return null;
      }
      saveAttemptRef.current = null;
      setSaveError('');
      notify(prepared.message);
      return prepared.result;
    };
    const durable = commitLibrarySave();
    if (!durable) return succeed();
    setSaving(true);
    attempt.pending = durable.then(succeed, () => {
      const message = 'Save failed — durable storage could not confirm the write. Keep this window open and retry. Your draft is still available.';
      setSaveError(message);
      notify(message);
      return null;
    }).finally(() => {
      attempt.pending = null;
      setSaving(false);
    });
    return attempt.pending;
  };

  const del = (id, options = {}) => {
    if (!options.skipConfirm && !window.confirm('Delete this prompt?')) return false;
    const deletedEntry = libraryRef.current.find((entry) => entry.id === id);
    if (!deletedEntry) return false;
    const nextLibrary = libraryRef.current.filter(entry => entry.id !== id);
    if (nextLibrary.length === libraryRef.current.length) return false;
    const deletedAt = new Date().toISOString();
    const nextTrash = [{
      ...deletedEntry,
      deletedAt,
      updatedAt: deletedAt,
      tombstoneVersion: (deletedEntry.tombstoneVersion || 0) + 1,
    }, ...trashRef.current.filter((entry) => entry.id !== id)];
    if (!persistRecords(storageKeys.trash, nextTrash)) {
      notifyWriteFailure('Delete failed. Browser storage may be full. The prompt is still in your Library.');
      return false;
    }
    if (!persistRecords(storageKeys.library, nextLibrary)) {
      persistRecords(storageKeys.trash, trashRef.current);
      notifyWriteFailure('Delete failed. Browser storage may be full. The prompt is still in your Library.');
      return false;
    }
    libraryRef.current = nextLibrary;
    trashRef.current = nextTrash;
    setLibrary(nextLibrary);
    setTrash(nextTrash);
    setExpandedId(prev => prev === id ? null : prev);
    if (expandedVersionId === id) {
      setExpandedVersionId(null);
      setDiffVersionIdx(null);
    }
    setShareId(prev => prev === id ? null : prev);
    setRenamingId(prev => prev === id ? null : prev);
    notify('Prompt deleted.');
    return true;
  };

  const restoreDeleted = (id) => {
    const entry = trashRef.current.find((item) => item.id === id);
    if (!entry) return null;
    if (!isTrashEntryRestorable(entry)) {
      try { markLibraryDeleted([id]); } catch {
        notify('Expired prompt cleanup could not be saved.');
        return null;
      }
      const nextTrash = trashRef.current.filter((item) => item.id !== id);
      trashRef.current = nextTrash;
      setTrash(nextTrash);
      notify('This prompt has passed the 30-day recovery window and cannot be restored.');
      return null;
    }
    const restoredAt = new Date().toISOString();
    const restored = normalizeEntry({
      ...entry,
      deletedAt: null,
      updatedAt: restoredAt,
      tombstoneVersion: (entry.tombstoneVersion || 0) + 1,
    });
    if (!restored) return null;
    const nextLibrary = [restored, ...libraryRef.current.filter((item) => item.id !== id)];
    const nextTrash = trashRef.current.filter((item) => item.id !== id);
    if (!persistRecords(storageKeys.library, nextLibrary) || !persistRecords(storageKeys.trash, nextTrash)) {
      notifyWriteFailure('Restore failed. Browser storage may be full.');
      return null;
    }
    libraryRef.current = nextLibrary;
    trashRef.current = nextTrash;
    setLibrary(nextLibrary);
    setTrash(nextTrash);
    notify(`Restored ${restored.title}.`);
    return restored;
  };

  const permanentlyDelete = (id) => {
    if (!window.confirm('Permanently delete this prompt? This cannot be undone.')) return false;
    const nextTrash = trashRef.current.filter((item) => item.id !== id);
    if (nextTrash.length === trashRef.current.length) return false;
    try { markLibraryDeleted([id]); } catch {
      notify('Permanent deletion failed. The prompt remains recoverable.');
      return false;
    }
    const nextLibrary = filterDeletedLibraryRecords(libraryRef.current);
    const cleaned = persistRecords(storageKeys.trash, nextTrash) && persistRecords(storageKeys.library, nextLibrary);
    trashRef.current = nextTrash;
    setTrash(nextTrash);
    setLibrary(nextLibrary);
    notify(cleaned ? 'Prompt permanently deleted.' : 'Prompt deletion recorded, but stored content cleanup failed. Free browser storage and retry.');
    return true;
  };

  // Bulk counterpart of permanentlyDelete: one confirmation that names the
  // count, instead of one browser dialog per selected prompt. Returns the
  // number of prompts removed (0 when cancelled or nothing matched).
  const permanentlyDeleteEntries = (ids) => {
    const selected = new Set((Array.isArray(ids) ? ids : []).filter((id) => trashRef.current.some((item) => item.id === id)));
    if (selected.size === 0) return 0;
    const noun = selected.size === 1 ? 'prompt' : 'prompts';
    if (!window.confirm(`Permanently delete ${selected.size} ${noun}? This cannot be undone.`)) return 0;
    try { markLibraryDeleted([...selected]); } catch {
      notify('Permanent deletion failed. The prompts remain recoverable.');
      return 0;
    }
    const nextTrash = trashRef.current.filter((item) => !selected.has(item.id));
    const nextLibrary = filterDeletedLibraryRecords(libraryRef.current);
    const cleaned = persistRecords(storageKeys.trash, nextTrash) && persistRecords(storageKeys.library, nextLibrary);
    trashRef.current = nextTrash;
    setTrash(nextTrash);
    setLibrary(nextLibrary);
    notify(cleaned
      ? `${selected.size} ${noun} permanently deleted.`
      : 'Deletion recorded, but stored content cleanup failed. Free browser storage and retry.');
    return selected.size;
  };

  const setFavorite = (id, favorite) => updateLibraryEntry(id, (entry) => ({
    ...entry,
    favorite: typeof favorite === 'boolean' ? favorite : !entry.favorite,
  }));

  const duplicateEntry = (id) => {
    const source = libraryRef.current.find((entry) => entry.id === id);
    if (!source) return null;
    const duplicate = createPromptEntry({
      ...source,
      id: undefined,
      title: `${source.title} copy`,
      favorite: false,
      useCount: 0,
      createdAt: undefined,
      updatedAt: undefined,
      currentVersionId: undefined,
    });
    const nextLibrary = [duplicate, ...libraryRef.current];
    libraryRef.current = nextLibrary;
    setLibrary(nextLibrary);
    notify(`Duplicated ${source.title}.`);
    return duplicate;
  };

  const updateEntries = (ids, updater) => {
    const selected = new Set(Array.isArray(ids) ? ids : []);
    if (selected.size === 0) return 0;
    let changed = 0;
    const nextLibrary = libraryRef.current.map((entry) => {
      if (!selected.has(entry.id)) return entry;
      changed += 1;
      const next = updater(entry);
      return next && next !== entry ? stampRecordMutation(entry, next) : entry;
    });
    libraryRef.current = nextLibrary;
    setLibrary(nextLibrary);
    return changed;
  };

  const moveEntriesToCollection = (ids, collection) => updateEntries(ids, (entry) => ({
    ...entry,
    collection: ensureString(collection),
  }));

  const addTagToEntries = (ids, tag) => updateEntries(ids, (entry) => ({
    ...entry,
    tags: normalizeTagList([...(entry.tags || []), tag]),
  }));

  const deleteEntries = (ids) => {
    const selected = new Set(Array.isArray(ids) ? ids : []);
    if (selected.size === 0 || !window.confirm(`Move ${selected.size} prompts to Recently Deleted?`)) return 0;
    const deleted = libraryRef.current.filter((entry) => selected.has(entry.id));
    if (deleted.length === 0) return 0;
    const now = new Date().toISOString();
    const nextTrash = [
      ...deleted.map((entry) => ({
        ...entry,
        deletedAt: now,
        updatedAt: now,
        tombstoneVersion: (entry.tombstoneVersion || 0) + 1,
      })),
      ...trashRef.current.filter((entry) => !selected.has(entry.id)),
    ];
    const nextLibrary = libraryRef.current.filter((entry) => !selected.has(entry.id));
    if (!persistRecords(storageKeys.trash, nextTrash)) {
      notifyWriteFailure('Delete failed. Browser storage may be full. Your prompts are still in the Library.');
      return 0;
    }
    if (!persistRecords(storageKeys.library, nextLibrary)) {
      persistRecords(storageKeys.trash, trashRef.current);
      notifyWriteFailure('Delete failed. Browser storage may be full. Your prompts are still in the Library.');
      return 0;
    }
    libraryRef.current = nextLibrary;
    trashRef.current = nextTrash;
    setLibrary(nextLibrary);
    setTrash(nextTrash);
    notify(`Moved ${deleted.length} prompts to Recently Deleted.`);
    return deleted.length;
  };

  const bumpUse = id => updateLibraryEntry(id, entry => ({
    ...entry,
    useCount: entry.useCount + 1,
  }));

  const deleteCollection = useCallback((collectionName) => {
    const nextCollections = collectionsRef.current.filter((name) => name !== collectionName);
    const nextLibrary = libraryRef.current.map((entry) =>
      entry.collection === collectionName ? stampRecordMutation(entry, { ...entry, collection: '' }) : entry
    );
    if (!persistRecords(storageKeys.library, nextLibrary)) {
      notifyWriteFailure('Collection removal failed. Prompt assignments are unchanged; retry when storage is available.');
      return false;
    }
    libraryRef.current = nextLibrary;
    setLibrary(nextLibrary);
    if (!saveJson(storageKeys.collections, nextCollections)) {
      notify('Prompts were unassigned, but the collection could not be removed. Retry collection removal.');
      return false;
    }
    collectionsRef.current = nextCollections;
    setCollections(nextCollections);
    const removedFolder = foldersRef.current.find(folder => folder.collection === collectionName);
    const nextFolders = foldersRef.current.filter(folder => folder.collection !== collectionName).map(folder => folder.parentId === removedFolder?.id ? { ...folder, parentId: null, name: folder.collection } : folder);
    if (!saveJson(storageKeys.folders, nextFolders)) notify('Folder metadata cleanup failed. Retry collection removal.');
    foldersRef.current = nextFolders; setFolderRecords(nextFolders);
    setActiveCollection(prev => prev === collectionName ? null : prev);
    notify(`Removed collection: ${collectionName}`);
    return true;
  }, [notify]);

  const clearLibrary = useCallback(() => {
    try { generationRef.current = markLibraryCleared(); } catch {
      notify('Clear failed. The Library has not been removed.');
      return false;
    }
    const cleaned = persistRecords(storageKeys.library, []) && persistRecords(storageKeys.trash, []) && saveJson(storageKeys.collections, []) && saveJson(storageKeys.folders, []);
    libraryRef.current = [];
    collectionsRef.current = [];
    setLibrary([]);
    trashRef.current = [];
    setTrash([]);
    setCollections([]);
    foldersRef.current = []; setFolderRecords([]);
    setActiveCollection(null);
    setActiveTag(null);
    setExpandedId(null);
    setExpandedVersionId(null);
    setDiffVersionIdx(null);
    setShareId(null);
    setRenamingId(null);
    setRenameValue('');
    setDraggingLibraryId(null);
    setDragOverLibraryId(null);
    setLoadedStarterPackIds([]);
    saveJson('pl2-loaded-packs', []);
    notify(cleaned ? 'Library cleared.' : 'Library clear recorded, but stored content cleanup failed. Free browser storage and retry.');
    return cleaned;
  }, [notify]);

  const moveLibraryEntry = (sourceId, targetId, position = 'before') => {
    if (!sourceId || !targetId || sourceId === targetId) return;
    setLibrary(prev => {
      const from = prev.findIndex(entry => entry.id === sourceId);
      if (from < 0) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      let insertAt = next.findIndex(entry => entry.id === targetId);
      if (insertAt < 0) return prev;
      if (position === 'after') insertAt += 1;
      next.splice(insertAt, 0, moved);
      return next;
    });
  };

  const moveLibraryEntryByOffset = (entryId, offset, filteredList) => {
    if (!entryId || !Number.isFinite(offset) || offset === 0) return;
    if (filteredList && filteredList.length > 0) {
      const filteredIdx = filteredList.findIndex(entry => entry.id === entryId);
      if (filteredIdx < 0) return;
      const targetFilteredIdx = Math.max(0, Math.min(filteredList.length - 1, filteredIdx + offset));
      if (targetFilteredIdx === filteredIdx) return;
      const targetId = filteredList[targetFilteredIdx].id;
      moveLibraryEntry(entryId, targetId, offset > 0 ? 'after' : 'before');
      return;
    }
    setLibrary(prev => {
      const from = prev.findIndex(entry => entry.id === entryId);
      if (from < 0) return prev;
      const targetIndex = Math.max(0, Math.min(prev.length - 1, from + offset));
      if (targetIndex === from) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
  };

  const renameEntry = (id, nextTitle, editingId, setSaveTitle) => {
    const trimmed = nextTitle.trim();
    if (!trimmed) return;
    updateLibraryEntry(id, entry => ({
      ...entry,
      title: trimmed,
    }));
    if (editingId === id && setSaveTitle) setSaveTitle(trimmed);
    setRenamingId(null);
    setRenameValue('');
    notify('Renamed.');
  };

  const restoreVersion = (entryId, version) => {
    const currentEntry = libraryRef.current.find(entry => entry.id === entryId);
    if (!currentEntry || !version) {
      notify('Restore failed: this prompt or version is no longer available.');
      return null;
    }
    const restoredEntry = restorePromptVersion(currentEntry, version);
    if (!restoredEntry) {
      notify('Restore failed: this version could not be read.');
      return null;
    }
    const nextLibrary = libraryRef.current.map(entry => entry.id === entryId ? restoredEntry : entry);
    if (!persistRecords(storageKeys.library, nextLibrary)) {
      notifyWriteFailure('Restore failed. Browser storage may be full. The prompt and editor were not changed.');
      return null;
    }
    libraryRef.current = nextLibrary;
    setLibrary(nextLibrary);
    notify('Restored!');
    return restoredEntry;
  };

  const openVersionHistory = (entryId, initialIdx = 0) => {
    setExpandedVersionId(entryId);
    setDiffVersionIdx(initialIdx);
  };

  const closeVersionHistory = () => {
    setExpandedVersionId(null);
    setDiffVersionIdx(null);
  };

  const pinGoldenResponse = (entryId, { text, runId, provider, model } = {}) => {
    const pinnedText = ensureString(text);
    if (!pinnedText.trim()) return false;
    const changed = updateLibraryEntry(entryId, entry => updatePromptEntry(entry, {
      goldenResponse: {
        text: pinnedText,
        pinnedAt: new Date().toISOString(),
        pinnedFromRunId: ensureString(runId),
        provider: ensureString(provider),
        model: ensureString(model),
      },
    }));
    if (changed) notify('Golden response pinned.');
    return changed;
  };

  const clearGoldenResponse = (entryId) => {
    const changed = updateLibraryEntry(entryId, entry => {
      if (!entry.goldenResponse) return entry;
      return updatePromptEntry(entry, { goldenResponse: null });
    });
    if (changed) notify('Golden response cleared.');
    return changed;
  };

  const setGoldenThreshold = (entryId, threshold) => {
    updateLibraryEntry(entryId, entry => updatePromptEntry(entry, { goldenThreshold: threshold }));
  };

  // Suite summaries live in metadata so they round-trip export/import without touching version history.
  const recordSuiteResult = (entryId, suite) => updateLibraryEntry(entryId, entry => ({
    ...entry,
    metadata: { ...(entry.metadata || {}), suite },
  }));

  const removeEntriesByPackId = (packId) => {
    const id = ensureString(packId).trim();
    if (!id) return 0;
    let removed = 0;
    setLibrary(prev => {
      const removedEntries = [];
      const next = prev.filter(entry => {
        const isPackEntry = ensureString(entry?.metadata?.packId).trim() === id;
        if (isPackEntry) {
          removed += 1;
          removedEntries.push(entry);
        }
        return !isPackEntry;
      });
      libraryRef.current = next;
      if (removedEntries.length > 0) {
        const deletedAt = new Date().toISOString();
        const removedIds = new Set(removedEntries.map((entry) => entry.id));
        const nextTrash = [
          ...removedEntries.map((entry) => ({
            ...entry,
            deletedAt,
            updatedAt: deletedAt,
            tombstoneVersion: (entry.tombstoneVersion || 0) + 1,
          })),
          ...trashRef.current.filter((entry) => !removedIds.has(entry.id)),
        ];
        trashRef.current = nextTrash;
        setTrash(nextTrash);
      }
      return next;
    });
    return removed;
  };

  const assignEntriesToPack = (entryIds, packId, packName) => {
    const ids = new Set(Array.isArray(entryIds) ? entryIds : []);
    const id = ensureString(packId).trim();
    if (!id || ids.size === 0) return 0;
    let assigned = 0;
    setLibrary(prev => {
      assigned = prev.filter((entry) => ids.has(entry.id)).length;
      const stamped = stampPackMembership(prev, [...ids], { id, title: packName });
      const next = stamped.map((entry, index) => ids.has(entry.id)
        ? stampRecordMutation(prev[index], entry)
        : entry);
      libraryRef.current = next;
      return next;
    });
    return assigned;
  };

  const saveEntryDetails = async (id, updater) => {
    const before = libraryRef.current;
    const current = before.find(entry => entry.id === id);
    if (!current) return false;
    const next = before.map(entry => entry.id === id ? stampRecordMutation(entry, updater(entry)) : entry);
    try {
      if (!persistRecords(storageKeys.library, next)) throw new Error(libraryConflictRef.current || 'Library storage write failed.');
      const durable = commitLibrarySave(); if (durable) await durable;
      if (libraryRef.current !== before) throw new Error('The Library changed while saving. Review your edits and retry.');
      libraryRef.current = next; setLibrary(next); return true;
    } catch (error) { notify(error.message || 'Prompt details were not saved.'); return false; }
  };

  const saveFolders = async (nextFolders, pathChanges = new Map()) => {
    try {
      const next = reconcileFolders(nextFolders);
      const nextCollections = next.map(folder => folder.collection);
      const beforeLibrary = libraryRef.current;
      const nextLibrary = beforeLibrary.map(entry => pathChanges.has(entry.collection)
        ? stampRecordMutation(entry, { ...entry, collection: pathChanges.get(entry.collection) }) : entry);
      const before = [storageKeys.folders, storageKeys.collections, storageKeys.library].map(key => [key, loadJson(key, null)]);
      if (!saveJson(storageKeys.folders, next) || !saveJson(storageKeys.collections, nextCollections) || !persistRecords(storageKeys.library, nextLibrary)) {
        for (const [key, value] of before) { if (value === null) removeKey(key); else saveJson(key, value); }
        throw new Error('Folder changes were not saved. Your prompts remain available.');
      }
      const durable = commitLibrarySave();
      if (durable) await durable;
      if (libraryRef.current !== beforeLibrary) throw new Error('The Library changed while saving folders. Review and retry.');
      foldersRef.current = next; setFolderRecords(next);
      collectionsRef.current = nextCollections; setCollections(nextCollections);
      libraryRef.current = nextLibrary; setLibrary(nextLibrary);
      return true;
    } catch (error) { notify(error.message || 'Folder changes were not saved.'); return false; }
  };

  const exportLib = async () => {
    const scratch = loadJson('pl2-pads', null);
    const runs = await listEvalRuns({ limit: null });
    // M-4: saved experiment test cases are part of the promised experiments
    // export and must leave with the workspace file.
    const testCases = await listTestCases({ limit: null });
    if (library.length === 0 && trash.length === 0 && folders.length === 0 && !scratch && runs.length === 0 && testCases.length === 0) {
      notify('Prompt Lab has no saved workspace data to export.');
      return null;
    }
    const sensitiveEntries = [...library, ...trash];
    if (sensitiveEntries.some(entry => looksSensitive(entry.original) || looksSensitive(entry.enhanced) || looksSensitive(entry.notes))
      && !window.confirm('Export may include sensitive prompt content. Continue?')) return;
    const exportPayload = {
      product: 'Prompt Lab',
      version: APP_VERSION,
      schemaVersion: 2,
      exportedAt: new Date().toISOString(),
      count: library.length,
      library,
      trash,
      collections,
      folders,
      packs: loadPackRegistry(),
      scratch,
      runs,
      testCases,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(exportPayload, null, 2)], { type: 'application/json' }));
    const stamp = new Date().toISOString().slice(0, 10);
    const anchor = Object.assign(document.createElement('a'), { href: url, download: `prompt-lab-workspace-${stamp}.json` });
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    notify(`Exported ${library.length} prompts, ${runs.length} runs, ${testCases.length} test cases, and Scratch data.`);
    return exportPayload;
  };

  const showImportPreview = (preview) => {
    importPreviewRef.current = preview;
    setImportPreview(preview);
  };

  const readImportContext = async () => {
    const [runs, testCases] = await Promise.all([listEvalRuns({ limit: null }), listTestCases({ limit: null })]);
    const libraryRaw = localStorage.getItem(storageKeys.library);
    if (libraryRaw !== librarySnapshotRef.current.raw) adoptStoredLibrary(libraryRaw);
    const read = (key, fallback) => {
      const value = localStorage.getItem(key);
      return value == null ? fallback : JSON.parse(value);
    };
    const known = new Map([...(importPreviewRef.current?.context?.library || []),
      ...(importPreviewRef.current?.context?.trash || []), ...libraryRef.current, ...trashRef.current].map(entry => [entry.id, entry]));
    const stableLegacyRows = rows => rows.map(entry => ({
      ...entry,
      createdAt: entry.createdAt || known.get(entry.id)?.createdAt,
      currentVersionId: entry.currentVersionId || known.get(entry.id)?.currentVersionId,
    }));
    const reconciled = reconcileLibraryRecords(libraryRef.current, trashRef.current,
      stableLegacyRows(read(storageKeys.library, [])), stableLegacyRows(read(storageKeys.trash, [])));
    return {
      libraryRaw,
      library: filterDeletedLibraryRecords(reconciled.library),
      trash: filterDeletedLibraryRecords(reconciled.trash), runs, testCases,
      collections: read(storageKeys.collections, collectionsRef.current),
      folders: reconcileFolders(read(storageKeys.folders, foldersRef.current)),
      packs: read(storageKeys.packs, []), scratch: read('pl2-pads', null),
      ...readLibraryDeletionState(),
    };
  };

  const chooseImportResolution = (id, choice) => {
    const preview = importPreviewRef.current;
    if (!preview?.source || pendingImportRef.current || importBusyRef.current) return;
    showImportPreview({
      ...buildWorkspaceImportPreview(preview.source, preview.context, { ...preview.resolutions, [id]: choice }),
      fileName: preview.fileName,
    });
  };

  const cancelImportPreview = () => {
    if (importBusyRef.current) return;
    importReadRef.current += 1;
    showImportPreview(null);
    if (pendingImportRef.current?.completed.size === 0) {
      pendingImportRef.current = null;
      setPendingImport(null);
    }
    // After partial writes, closing the dialog keeps the operation available
    // for retry; it does not pretend to roll back acknowledged records.
  };

  const applyImport = async (retainedPlan = null) => {
    if (importBusyRef.current) return;
    const preview = importPreviewRef.current;
    if (!retainedPlan && (!preview?.plan || preview.unresolved || preview.error)) return;
    importBusyRef.current = true;
    setImportApplying(true);
    let plan = retainedPlan;
    try {
      const context = await readImportContext();
      if (plan && !plan.completed.size && workspaceImportRevision(context) !== plan.revision) {
        pendingImportRef.current = null;
        setPendingImport(null);
        showImportPreview({ ...buildWorkspaceImportPreview(plan.parsed, context), fileName: plan.fileName,
          notice: 'The workspace changed before any import write succeeded. Review the refreshed choices and apply again.' });
        return;
      }
      if (!plan) {
        if (workspaceImportRevision(context) !== preview.revision) {
          showImportPreview({ ...buildWorkspaceImportPreview(preview.source, context), fileName: preview.fileName,
            notice: 'The workspace changed after preview. Review the refreshed choices and apply again.' });
          return;
        }
        plan = { ...preview.plan, parsed: preview.source, fileName: preview.fileName, revision: preview.revision, completed: new Set() };
      }
      if (context.generation !== plan.generation || [...plan.promptIdMap.values()].some(id => context.deletedIds.has(id))) {
        pendingImportRef.current = null;
        setPendingImport(null);
        const message = 'The import destination was deleted or cleared. No remaining stages were applied. Close this preview and choose a file to review a new import.';
        showImportPreview({ ...(importPreviewRef.current || preview), error: message,
          partial: true, invalidated: true, completedStages: [...plan.completed] });
        notify(`Import stopped: ${message} Previously saved stages were not rolled back.`);
        return;
      }
      pendingImportRef.current = plan;
      setPendingImport(plan);
      const reportProgress = (error = '') => showImportPreview({
        ...(importPreviewRef.current || preview), fileName: plan.fileName, error,
        completedStages: [...plan.completed], partial: true,
      });
      const stage = async (name, write) => {
        if (plan.completed.has(name)) return;
        await write();
        plan.completed.add(name);
        reportProgress();
      };
      await stage('Library', () => {
        if (!persistRecords(storageKeys.library, plan.library, context.libraryRaw)) throw new Error(libraryConflictRef.current || 'Library storage write failed.');
        setLibrary(plan.library);
      });
      await stage('Trash', () => {
        const next = reconcileLibraryRecords([], context.trash, [], plan.trash).trash;
        if (!persistRecords(storageKeys.trash, next)) throw new Error('Trash storage write failed.');
        trashRef.current = next;
        setTrash(next);
      });
      await stage('Collections', () => {
        const next = mergeCollections(mergeCollections(context.collections, plan.parsed.collections || []), deriveCollectionsFromLibrary(plan.library));
        if (!saveJson(storageKeys.collections, next)) throw new Error('Collection storage write failed.');
        collectionsRef.current = next;
        setCollections(next);
      });
      if (plan.parsed.folders) await stage('Folders', async () => {
        const next = mergeFolders(context.folders, plan.parsed.folders, collectionsRef.current);
        if (!saveJson(storageKeys.folders, next)) throw new Error('Folder storage write failed.');
        const durable = commitLibrarySave(); if (durable) await durable;
        foldersRef.current = next; setFolderRecords(next);
      });
      if (plan.scratch) await stage('Scratch', async () => {
        assertScratchJournalReady();
        localStorage.setItem(storageKeys.scratch, JSON.stringify(plan.scratch));
        const durable = commitScratchSave(); if (durable) await durable;
      });
      if (plan.parsed.packs) await stage('Packs', () => {
        if (!saveJson(storageKeys.packs, plan.parsed.packs)) throw new Error('Pack storage write failed.');
      });
      for (const [label, records, save] of [['Test case', plan.testCases, saveTestCase], ['Run', plan.runs, saveEvalRun]]) {
        const writes = await Promise.allSettled(records.map(record => stage(`${label} ${record.id}`, () => save(record))));
        const failed = writes.find(write => write.status === 'rejected');
        if (failed) throw failed.reason;
      }
      pendingImportRef.current = null;
      setPendingImport(null);
      showImportPreview(null);
      const summary = `Imported ${plan.importedCount} prompts and workspace data; replaced ${plan.replacedCount || 0}, skipped ${plan.skippedCount}.`;
      notify(plan.warnings.length ? `${summary} ${plan.warnings.length} unresolved source references are retained in run notes or import metadata.` : summary);
    } catch (error) {
      const message = error.message || 'Storage write failed.';
      showImportPreview({ ...(importPreviewRef.current || preview), error: message,
        partial: Boolean(plan), completedStages: [...(plan?.completed || [])] });
      notify(`Import incomplete: ${message}. The file and completed stages are retained in this tab; retry the remaining stages.`);
    } finally {
      importBusyRef.current = false;
      setImportApplying(false);
    }
  };

  const retryImport = () => applyImport(pendingImportRef.current);

  const importLib = (event) => {
    const file = event.target.files?.[0];
    if (!file || importBusyRef.current) return;
    if (pendingImportRef.current) {
      notify('Finish the pending import with Retry import before choosing another file.');
      event.target.value = '';
      return;
    }
    const readId = ++importReadRef.current;
    const fail = message => {
      if (readId !== importReadRef.current) return;
      showImportPreview({ fileName: file.name || 'Selected JSON', error: message, rows: [], unresolved: 0 });
      notify(`Import failed: ${message}`);
    };
    if (file.size > 50 * 1024 * 1024) {
      fail('File is too large.');
      event.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = async (readEvent) => {
      try {
        const parsed = JSON.parse(readEvent.target.result);
        const retained = Array.isArray(parsed) ? parsed : {
          ...parsed, trash: Array.isArray(parsed?.trash) ? parsed.trash.filter(entry => isTrashEntryRestorable(entry)) : parsed?.trash,
        };
        const source = normalizeWorkspaceImportSource(retained);
        const context = await readImportContext();
        if (readId !== importReadRef.current) return;
        showImportPreview({ ...buildWorkspaceImportPreview(source, context), fileName: file.name || 'Selected JSON' });
      } catch (error) { fail(error.message || 'Invalid file.'); }
      finally { event.target.value = ''; }
    };
    reader.onerror = () => { fail('Unable to read the file.'); event.target.value = ''; };
    reader.readAsText(file);
  };

  const getShareUrl = entry => {
    if (!entry) return null;
    const code = encodeShare(entry);
    return code ? `${window.location.origin}${window.location.pathname}#share=${code}` : null;
  };

  const starterLibraries = useMemo(
    () => getStarterLibraries(loadedStarterPackIds),
    [loadedStarterPackIds],
  );

  const loadStarterPack = useCallback((packId) => {
    const result = loadPack(packId, libraryRef.current, collectionsRef.current);
    if (!result) {
      notify('Pack already loaded.');
      return null;
    }

    libraryRef.current = result.library;
    collectionsRef.current = result.collections;
    setLibrary(result.library);
    setCollections(result.collections);
    setLoadedStarterPackIds(getLoadedPacks());

    if (result.count > 0) {
      notify(`Loaded ${result.count} prompts into ${result.collection}`);
    } else {
      notify(`No new prompts loaded from ${result.collection}.`);
    }
    return result;
  }, [notify]);

  const recoverLegacyWebLibrary = useCallback(async ({ force = false } = {}) => {
    if (recoveringLegacyLibrary) return { importedCount: 0, reason: 'busy' };
    if (!shouldAttemptLegacyWebMigration(window.location.origin, window.location.protocol)) {
      return { importedCount: 0, reason: 'unsupported' };
    }

    if (!force && loadJson(LEGACY_LIBRARY_CHECK_KEY, false) === true) {
      return { importedCount: 0, reason: 'already-checked' };
    }

    setRecoveringLegacyLibrary(true);
    try {
      const payload = await requestLegacyLibraryPayload({ currentOrigin: window.location.origin });
      const result = applyLegacyPayload(payload);
      if (!result.reachable) {
        markLegacyLibraryChecked();
        notify('Legacy web library bridge is unavailable.');
        return { importedCount: 0, reason: 'unreachable' };
      }
      markLegacyLibraryChecked();

      if (!result.hasLegacyLibrary) {
        notify('No legacy web library found.');
        return { importedCount: 0, reason: 'empty' };
      }

      if (result.importedCount > 0) {
        notify(`Recovered ${result.importedCount} prompts from your legacy web library.`);
      } else {
        notify('Legacy web library is already merged.');
      }

      return {
        importedCount: result.importedCount,
        reason: result.importedCount > 0 ? 'recovered' : 'already-merged',
      };
    } catch {
      notify('Legacy web library recovery failed.');
      return { importedCount: 0, reason: 'error' };
    } finally {
      setRecoveringLegacyLibrary(false);
    }
  }, [applyLegacyPayload, markLegacyLibraryChecked, notify, recoveringLegacyLibrary]);

  const allLibTags = useMemo(
    () => normalizeTagList(library.flatMap(entry => entry.tags || [])),
    [library],
  );

  const filtered = useMemo(
    () => sortLibraryEntries(
      library.filter(entry =>
        matchesLibrarySearch(entry, search)
        && (!activeTag || (entry.tags || []).includes(activeTag))
        && (!activeCollection || entry.collection === activeCollection)
      ),
      sortBy,
    ),
    [activeCollection, activeTag, library, search, sortBy],
  );

  const quickInject = useMemo(
    () => [...library].sort((left, right) => right.useCount - left.useCount).slice(0, 5),
    [library],
  );

  const trackRecentAccess = (id) => {
    updateLibraryEntry(id, entry => ({
      ...entry,
      lastAccessedAt: new Date().toISOString(),
    }), { stamp: false });
    const ant = getAnticipation();
    const recent = (ant.lastAccessOrder || []).filter(rid => rid !== id);
    recent.unshift(id);
    ant.lastAccessOrder = recent.slice(0, 10);
    setAnticipation(ant);
  };

  const recentPrompts = useMemo(() => {
    const ant = getAnticipation();
    const order = ant.lastAccessOrder || [];
    const map = new Map(library.map(entry => [entry.id, entry]));
    return order.map(id => map.get(id)).filter(Boolean).slice(0, 5);
  }, [library]);

  return {
    library, setLibrary, trash, setTrash, libReady, collections, setCollections, folders, saveFolders, saveEntryDetails,
    smartView, setSmartView, statusFilter, setStatusFilter, search, setSearch, activeTag, setActiveTag, activeCollection, setActiveCollection,
    sortBy, setSortBy, expandedId, setExpandedId, expandedVersionId, setExpandedVersionId, diffVersionIdx, setDiffVersionIdx,
    shareId, setShareId, renamingId, setRenamingId, renameValue, setRenameValue,
    draggingLibraryId, setDraggingLibraryId, dragOverLibraryId, setDragOverLibraryId,
    doSave, saving, saveError, del, restoreDeleted, permanentlyDelete, permanentlyDeleteEntries, setFavorite, duplicateEntry, updateEntries, moveEntriesToCollection, addTagToEntries, deleteEntries,
    bumpUse, moveLibraryEntry, moveLibraryEntryByOffset, deleteCollection, clearLibrary, renameEntry, restoreVersion, openVersionHistory, closeVersionHistory,
    pinGoldenResponse, clearGoldenResponse, setGoldenThreshold, recordSuiteResult, removeEntriesByPackId, assignEntriesToPack,
    exportLib, importLib, pendingImport: Boolean(pendingImport), retryImport, getShareUrl,
    importPreview, importApplying, chooseImportResolution, cancelImportPreview, confirmImport: () => applyImport(),
    recoverLegacyWebLibrary, recoveringLegacyLibrary,
    starterLibraries, loadStarterPack,
    allLibTags, filtered, quickInject, recentPrompts, trackRecentAccess,
  };
}
