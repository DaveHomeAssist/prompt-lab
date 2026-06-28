import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_LIBRARY_SEEDS } from '../constants.js';
import { encodeShare, looksSensitive } from '../promptUtils.js';
import {
  createPromptEntry,
  normalizeLibrary,
  restorePromptVersion,
  suggestTitleFromText,
  updatePromptEntry,
} from '../lib/promptSchema.js';
import { loadJson, loadJsonWithRecovery, saveJson, storageKeys, getAnticipation, setAnticipation } from '../lib/storage.js';
import { ensureString } from '../lib/utils.js';
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

const VALID_SORTS = ['newest', 'oldest', 'most-used', 'a-z', 'z-a', 'group', 'manual'];

function getNewestSortTimestamp(entry) {
  const sortValue = entry?.updatedAt || entry?.updated_at || entry?.metadata?.packLoadedAt || entry?.createdAt;
  const parsed = Date.parse(sortValue || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function deriveCollectionsFromLibrary(entries) {
  if (!Array.isArray(entries)) return [];
  return [...new Set(
    entries
      .map((entry) => ensureString(entry?.collection).trim())
      .filter(Boolean),
  )];
}

function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function getImportPayload(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.library)) return parsed.library;
  return null;
}

function getImportSummary({ importedCount, skippedCount, rejectedCount }) {
  if (importedCount === 0) {
    const details = [];
    if (skippedCount > 0) details.push(`skipped ${pluralize(skippedCount, 'duplicate')}`);
    if (rejectedCount > 0) details.push(`rejected ${pluralize(rejectedCount, 'invalid record')}`);
    return details.length
      ? `No new prompts imported. ${details.join(', ')}.`
      : 'No new prompts imported.';
  }

  const details = [`Imported ${pluralize(importedCount, 'prompt')}`];
  if (skippedCount > 0) details.push(`skipped ${pluralize(skippedCount, 'duplicate')}`);
  if (rejectedCount > 0) details.push(`rejected ${pluralize(rejectedCount, 'invalid record')}`);
  return `${details.join(', ')}.`;
}

export default function usePromptLibrary(notify) {
  const [library, setLibrary] = useState([]);
  const [libReady, setLibReady] = useState(false);
  const [collections, setCollections] = useState([]);
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
  const [loadedStarterPackIds, setLoadedStarterPackIds] = useState(() => getLoadedPacks());
  const libraryRef = useRef(library);
  const collectionsRef = useRef(collections);
  const corruptionNoticeShownRef = useRef(false);

  useEffect(() => { libraryRef.current = library; }, [library]);
  useEffect(() => { collectionsRef.current = collections; }, [collections]);

  const commitLibraryState = useCallback(({ nextLibrary, nextCollections, persist = false } = {}) => {
    const result = { libraryPersisted: true, collectionsPersisted: true };

    if (Array.isArray(nextLibrary)) {
      libraryRef.current = nextLibrary;
      setLibrary(nextLibrary);
      if (persist) result.libraryPersisted = saveJson(storageKeys.library, nextLibrary);
    }

    if (Array.isArray(nextCollections)) {
      collectionsRef.current = nextCollections;
      setCollections(nextCollections);
      if (persist) result.collectionsPersisted = saveJson(storageKeys.collections, nextCollections);
    }

    return result;
  }, []);

  const notifyPersistenceFailure = useCallback((result, message) => {
    if (!result?.libraryPersisted || !result?.collectionsPersisted) {
      notify(message);
    }
  }, [notify]);

  const applyLegacyPayload = useCallback((payload) => {
    if (!payload || !Array.isArray(payload.library)) {
      return { importedCount: 0, reachable: false, hasLegacyLibrary: false };
    }

    const previousCollections = collectionsRef.current;
    const libraryResult = mergeLibraryEntries(libraryRef.current, payload.library);
    const nextCollections = Array.isArray(payload.collections) && payload.collections.length > 0
      ? mergeCollections(previousCollections, payload.collections)
      : previousCollections;

    const commitResult = commitLibraryState({
      nextLibrary: libraryResult.library,
      nextCollections: nextCollections !== previousCollections ? nextCollections : undefined,
      persist: true,
    });

    return {
      importedCount: libraryResult.importedCount,
      reachable: true,
      hasLegacyLibrary: payload.library.length > 0,
      persisted: commitResult.libraryPersisted && commitResult.collectionsPersisted,
    };
  }, [commitLibraryState]);

  useEffect(() => {
    const storedLibraryResult = loadJsonWithRecovery(storageKeys.library, null, { backupCorrupt: true });
    const storedLibrary = storedLibraryResult.value;
    const hasStoredLibrary = Array.isArray(storedLibrary);
    const initialLibrary = normalizeLibrary(hasStoredLibrary ? storedLibrary : DEFAULT_LIBRARY_SEEDS);
    const storedCollectionsResult = loadJsonWithRecovery(storageKeys.collections, null, { backupCorrupt: true });
    const storedCollections = storedCollectionsResult.value;
    const derivedCollections = deriveCollectionsFromLibrary(initialLibrary);
    const initialCollections = Array.isArray(storedCollections)
      ? mergeCollections(storedCollections, derivedCollections)
      : (!hasStoredLibrary ? ['Handoff Templates'] : derivedCollections);
    const recoveredKeys = [
      storedLibraryResult.backupKey ? 'library' : null,
      storedCollectionsResult.backupKey ? 'collections' : null,
    ].filter(Boolean);

    libraryRef.current = initialLibrary;
    collectionsRef.current = initialCollections;
    setLibrary(initialLibrary);
    setCollections(initialCollections);
    setLoadedStarterPackIds(getLoadedPacks());
    setLibReady(true);

    if (recoveredKeys.length > 0 && !corruptionNoticeShownRef.current) {
      corruptionNoticeShownRef.current = true;
      notify(`Recovered from unreadable local ${recoveredKeys.join(' and ')} data. A backup was saved before defaults were loaded.`);
    }

    const alreadyCheckedLegacy = loadJson(LEGACY_LIBRARY_CHECK_KEY, false) === true;
    const shouldAttemptLegacyRecovery = shouldAttemptLegacyWebMigration(window.location.origin, window.location.protocol)
      && !alreadyCheckedLegacy
      && (!hasStoredLibrary || storedLibrary.length === 0 || isSeedOnlyLibrary(initialLibrary));

    if (!shouldAttemptLegacyRecovery) return undefined;

    let cancelled = false;
    setRecoveringLegacyLibrary(true);
    requestLegacyLibraryPayload({ currentOrigin: window.location.origin })
      .then((payload) => {
        if (cancelled) return;
        const result = applyLegacyPayload(payload);
        if (!result.reachable) return;
        saveJson(LEGACY_LIBRARY_CHECK_KEY, true);
        if (!result.persisted) {
          notify('Recovered legacy prompts in memory, but local storage failed. They may not persist after refresh.');
        }
        if (result.importedCount > 0) {
          notify(`Recovered ${result.importedCount} prompts from your legacy web library.`);
        }
      })
      .finally(() => {
        if (!cancelled) setRecoveringLegacyLibrary(false);
      });

    return () => {
      cancelled = true;
    };
  }, [applyLegacyPayload, notify]);

  useEffect(() => {
    if (!libReady) return undefined;
    const timeoutId = window.setTimeout(() => {
      saveJson(storageKeys.library, library);
    }, 120);
    return () => window.clearTimeout(timeoutId);
  }, [library, libReady]);

  useEffect(() => {
    if (!libReady) return undefined;
    const timeoutId = window.setTimeout(() => {
      saveJson(storageKeys.collections, collections);
    }, 120);
    return () => window.clearTimeout(timeoutId);
  }, [collections, libReady]);

  const updateLibraryEntry = (entryId, updater, options = {}) => {
    let changed = false;
    const nextLibrary = libraryRef.current.map((entry) => {
      if (entry.id !== entryId) return entry;
      const next = updater(entry);
      if (!next || next === entry) return entry;
      changed = true;
      return next;
    });
    if (changed) {
      const commitResult = commitLibraryState({
        nextLibrary,
        persist: options.persist === true,
      });
      if (options.persistenceFailureMessage) {
        notifyPersistenceFailure(commitResult, options.persistenceFailureMessage);
      }
    }
    return changed;
  };

  const doSave = ({ raw, enhanced, variants, notes, tags, title, collection, editingId, changeNote }) => {
    const cleanTitle = ensureString(title).trim() || suggestTitleFromText(enhanced || raw);
    const payload = {
      title: cleanTitle,
      original: ensureString(raw),
      enhanced: ensureString(enhanced).trim() ? ensureString(enhanced) : ensureString(raw),
      variants: Array.isArray(variants) ? variants : [],
      notes: ensureString(notes),
      tags: Array.isArray(tags) ? tags.filter(tag => typeof tag === 'string' && tag.trim()) : [],
      collection: ensureString(collection),
    };

    if (editingId) {
      let savedTitle = cleanTitle;
      const changed = updateLibraryEntry(
        editingId,
        entry => {
          const next = updatePromptEntry(entry, payload, { source: 'manual_save', changeNote: ensureString(changeNote) });
          savedTitle = next?.title || savedTitle;
          return next;
        },
        {
          persist: true,
          persistenceFailureMessage: 'Prompt updated in memory, but local storage failed. It may not persist after refresh.',
        },
      );
      if (!changed) {
        notify('Prompt update failed: the saved prompt no longer exists.');
        return null;
      }
      notify('Prompt updated!');
      return { id: editingId, title: savedTitle };
    }

    const entry = createPromptEntry({
      ...payload,
      useCount: 0,
      versions: [],
      testCases: [],
    });
    const nextLibrary = [entry, ...libraryRef.current];
    const commitResult = commitLibraryState({ nextLibrary, persist: true });
    notifyPersistenceFailure(commitResult, 'Saved in memory, but local storage failed. It may not persist after refresh.');
    notify('Saved!');
    return { id: entry.id, title: entry.title };
  };

  const del = (id) => {
    if (!window.confirm('Delete this prompt?')) return;
    const nextLibrary = libraryRef.current.filter(entry => entry.id !== id);
    const commitResult = commitLibraryState({ nextLibrary, persist: true });
    notifyPersistenceFailure(commitResult, 'Deleted in memory, but local storage failed. It may reappear after refresh.');
    notify('Prompt deleted.');
  };

  const bumpUse = id => updateLibraryEntry(id, entry => ({
    ...entry,
    useCount: entry.useCount + 1,
  }));

  const deleteCollection = useCallback((collectionName) => {
    const nextCollections = collectionsRef.current.filter((name) => name !== collectionName);
    const nextLibrary = libraryRef.current.map((entry) =>
      entry.collection === collectionName ? { ...entry, collection: '' } : entry
    );
    const commitResult = commitLibraryState({ nextLibrary, nextCollections, persist: true });
    setActiveCollection(prev => prev === collectionName ? null : prev);
    notifyPersistenceFailure(commitResult, 'Removed collection in memory, but local storage failed. It may return after refresh.');
    notify(`Removed collection: ${collectionName}`);
  }, [commitLibraryState, notify, notifyPersistenceFailure]);

  const clearLibrary = useCallback(() => {
    const commitResult = commitLibraryState({ nextLibrary: [], nextCollections: [], persist: true });
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
    const loadedPacksPersisted = saveJson('pl2-loaded-packs', []);
    notifyPersistenceFailure(
      {
        libraryPersisted: commitResult.libraryPersisted && loadedPacksPersisted,
        collectionsPersisted: commitResult.collectionsPersisted,
      },
      'Cleared in memory, but local storage failed. Prompts or starter-pack state may return after refresh.',
    );
    notify('Library cleared.');
  }, [commitLibraryState, notify, notifyPersistenceFailure]);

  const moveLibraryEntry = (sourceId, targetId, position = 'before') => {
    if (!sourceId || !targetId || sourceId === targetId) return;
    const from = libraryRef.current.findIndex(entry => entry.id === sourceId);
    if (from < 0) return;
    const next = [...libraryRef.current];
    const [moved] = next.splice(from, 1);
    let insertAt = next.findIndex(entry => entry.id === targetId);
    if (insertAt < 0) return;
    if (position === 'after') insertAt += 1;
    next.splice(insertAt, 0, moved);
    const commitResult = commitLibraryState({ nextLibrary: next, persist: true });
    notifyPersistenceFailure(commitResult, 'Reordered in memory, but local storage failed. The order may reset after refresh.');
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
    const from = libraryRef.current.findIndex(entry => entry.id === entryId);
    if (from < 0) return;
    const targetIndex = Math.max(0, Math.min(libraryRef.current.length - 1, from + offset));
    if (targetIndex === from) return;
    const next = [...libraryRef.current];
    const [moved] = next.splice(from, 1);
    next.splice(targetIndex, 0, moved);
    const commitResult = commitLibraryState({ nextLibrary: next, persist: true });
    notifyPersistenceFailure(commitResult, 'Reordered in memory, but local storage failed. The order may reset after refresh.');
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
    updateLibraryEntry(entryId, entry => restorePromptVersion(entry, version));
    notify('Restored!');
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

  const exportLib = () => {
    if (library.length === 0) {
      notify('Library is empty.');
      return;
    }
    if (library.some(entry => looksSensitive(entry.original) || looksSensitive(entry.enhanced) || looksSensitive(entry.notes))
      && !window.confirm('Export may include sensitive prompt content. Continue?')) return;
    const exportPayload = {
      version: '1.7.0',
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      count: library.length,
      library,
      collections,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(exportPayload, null, 2)], { type: 'application/json' }));
    const stamp = new Date().toISOString().slice(0, 10);
    const anchor = Object.assign(document.createElement('a'), { href: url, download: `prompt-library-${stamp}.json` });
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const importLib = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      notify('Import failed: file is too large.');
      event.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = (readEvent) => {
      try {
        const parsed = JSON.parse(readEvent.target.result);
        const payload = getImportPayload(parsed);
        if (!payload) {
          notify('Import failed: expected a Prompt Lab export or an array of prompts.');
          return;
        }
        const normalized = normalizeLibrary(payload);
        const rejectedCount = payload.length - normalized.length;
        if (!normalized.length) {
          notify(
            rejectedCount > 0
              ? `Import failed: ${pluralize(rejectedCount, 'record')} had no valid prompt content.`
              : 'Import failed: no prompts found.',
          );
          return;
        }
        const result = mergeLibraryEntries(libraryRef.current, normalized, { prepend: true });
        const nextCollections = mergeCollections(
          collectionsRef.current,
          deriveCollectionsFromLibrary(result.library),
        );
        const commitResult = commitLibraryState({
          nextLibrary: result.library,
          nextCollections,
          persist: true,
        });
        notifyPersistenceFailure(commitResult, 'Imported in memory, but local storage failed. Changes may not persist after refresh.');
        notify(getImportSummary({
          importedCount: result.importedCount,
          skippedCount: result.skippedCount,
          rejectedCount,
        }));
      } catch {
        notify('Import failed: file is not valid JSON.');
      } finally {
        event.target.value = '';
      }
    };
    reader.onerror = () => {
      notify('Import failed while reading the file.');
      event.target.value = '';
    };
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

    const commitResult = commitLibraryState({
      nextLibrary: result.library,
      nextCollections: result.collections,
      persist: true,
    });
    setLoadedStarterPackIds(getLoadedPacks());
    notifyPersistenceFailure(commitResult, 'Loaded starter pack in memory, but local storage failed. It may not persist after refresh.');

    if (result.count > 0) {
      notify(`Loaded ${result.count} prompts into ${result.collection}`);
    } else {
      notify(`No new prompts loaded from ${result.collection}.`);
    }
    return result;
  }, [commitLibraryState, notify, notifyPersistenceFailure]);

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
        notify('Legacy web library bridge is unavailable.');
        return { importedCount: 0, reason: 'unreachable' };
      }
      saveJson(LEGACY_LIBRARY_CHECK_KEY, true);
      if (!result.persisted) {
        notify('Recovered legacy prompts in memory, but local storage failed. They may not persist after refresh.');
      }

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
  }, [applyLegacyPayload, notify, recoveringLegacyLibrary]);

  const allLibTags = useMemo(
    () => [...new Set(library.flatMap(entry => entry.tags || []))],
    [library],
  );

  const filtered = useMemo(
    () => [...library]
      .filter(entry =>
        matchesLibrarySearch(entry, search)
        && (!activeTag || (entry.tags || []).includes(activeTag))
        && (!activeCollection || entry.collection === activeCollection)
      )
      .sort((left, right) => {
        if (sortBy === 'manual') return 0;
        if (sortBy === 'oldest') return new Date(left.createdAt) - new Date(right.createdAt);
        if (sortBy === 'most-used') return right.useCount - left.useCount;
        if (sortBy === 'a-z') return (left.title || '').localeCompare(right.title || '', undefined, { sensitivity: 'base' });
        if (sortBy === 'z-a') return (right.title || '').localeCompare(left.title || '', undefined, { sensitivity: 'base' });
        if (sortBy === 'group') {
          const leftCollection = left.collection || '';
          const rightCollection = right.collection || '';
          if (leftCollection && !rightCollection) return -1;
          if (!leftCollection && rightCollection) return 1;
          const cmp = leftCollection.localeCompare(rightCollection, undefined, { sensitivity: 'base' });
          return cmp !== 0 ? cmp : (left.title || '').localeCompare(right.title || '', undefined, { sensitivity: 'base' });
        }
        const newestDelta = getNewestSortTimestamp(right) - getNewestSortTimestamp(left);
        if (newestDelta !== 0) return newestDelta;
        return new Date(right.createdAt) - new Date(left.createdAt);
      }),
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
    }));
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
    library, setLibrary, libReady, collections, setCollections,
    search, setSearch, activeTag, setActiveTag, activeCollection, setActiveCollection,
    sortBy, setSortBy, expandedId, setExpandedId, expandedVersionId, setExpandedVersionId, diffVersionIdx, setDiffVersionIdx,
    shareId, setShareId, renamingId, setRenamingId, renameValue, setRenameValue,
    draggingLibraryId, setDraggingLibraryId, dragOverLibraryId, setDragOverLibraryId,
    doSave, del, bumpUse, moveLibraryEntry, moveLibraryEntryByOffset, deleteCollection, clearLibrary, renameEntry, restoreVersion, openVersionHistory, closeVersionHistory,
    pinGoldenResponse, clearGoldenResponse, setGoldenThreshold,
    exportLib, importLib, getShareUrl,
    recoverLegacyWebLibrary, recoveringLegacyLibrary,
    starterLibraries, loadStarterPack,
    allLibTags, filtered, quickInject, recentPrompts, trackRecentAccess,
  };
}
