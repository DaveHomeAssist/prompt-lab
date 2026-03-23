import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_LIBRARY_SEEDS } from '../constants.js';
import { encodeShare, looksSensitive } from '../promptUtils.js';
import {
  createPromptEntry,
  normalizeLibrary,
  restorePromptVersion,
  suggestTitleFromText,
  updatePromptEntry,
} from '../lib/promptSchema.js';
import { loadJson, saveJson, storageKeys } from '../lib/storage.js';
import { ensureString } from '../lib/utils.js';
import { getLoadedPacks, getStarterLibraries, loadStarterPack as loadPack } from '../lib/seedTransform.js';
import {
  LEGACY_LIBRARY_CHECK_KEY,
  mergeCollections,
  mergeLibraryEntries,
  requestLegacyLibraryPayload,
  shouldAttemptLegacyWebMigration,
  isSeedOnlyLibrary,
} from '../lib/legacyLibraryMigration.js';
import { persistLoadedPacks } from '../lib/seedTransform.js';

function getNewestSortTimestamp(entry) {
  const sortValue = entry?.metadata?.packLoadedAt || entry?.updatedAt || entry?.updated_at || entry?.createdAt;
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

export default function usePromptLibrary(notify) {
  const [library, setLibrary] = useState([]);
  const [libReady, setLibReady] = useState(false);
  const [collections, setCollections] = useState([]);
  const [search, setSearch] = useState('');
  const [activeTag, setActiveTag] = useState(null);
  const [activeCollection, setActiveCollection] = useState(null);
  const [sortBy, setSortBy] = useState('newest');
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
  const [pendingLoadedStarterPackIds, setPendingLoadedStarterPackIds] = useState(null);
  const libraryRef = useRef(library);
  const collectionsRef = useRef(collections);

  useEffect(() => { libraryRef.current = library; }, [library]);
  useEffect(() => { collectionsRef.current = collections; }, [collections]);

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
    const storedLibrary = loadJson(storageKeys.library, null);
    const hasStoredLibrary = Array.isArray(storedLibrary);
    const initialLibrary = normalizeLibrary(hasStoredLibrary ? storedLibrary : DEFAULT_LIBRARY_SEEDS);
    const storedLoadedPackIds = getLoadedPacks();
    const reconciledLoadedPackIds = storedLoadedPackIds.filter((packId) =>
      initialLibrary.some((entry) => entry?.metadata?.packId === packId),
    );
    const storedCollections = loadJson(storageKeys.collections, null);
    const derivedCollections = deriveCollectionsFromLibrary(initialLibrary);
    const initialCollections = Array.isArray(storedCollections)
      ? [...new Set([
        ...storedCollections.filter(item => typeof item === 'string' && item.trim()),
        ...derivedCollections,
      ])]
      : (!hasStoredLibrary ? ['Handoff Templates'] : derivedCollections);

    libraryRef.current = initialLibrary;
    collectionsRef.current = initialCollections;
    setLibrary(initialLibrary);
    setCollections(initialCollections);
    setLoadedStarterPackIds(reconciledLoadedPackIds);
    setLibReady(true);

    if (JSON.stringify(reconciledLoadedPackIds) !== JSON.stringify(storedLoadedPackIds)) {
      persistLoadedPacks(reconciledLoadedPackIds);
    }

    const alreadyCheckedLegacy = loadJson(LEGACY_LIBRARY_CHECK_KEY, false) === true;
    const shouldAttemptLegacyRecovery = shouldAttemptLegacyWebMigration(window.location.origin, window.location.protocol)
      && !alreadyCheckedLegacy
      && (!hasStoredLibrary || storedLibrary.length === 0 || isSeedOnlyLibrary(initialLibrary));

    if (!shouldAttemptLegacyRecovery) return;

    let cancelled = false;
    setRecoveringLegacyLibrary(true);
    requestLegacyLibraryPayload({ currentOrigin: window.location.origin })
      .then((payload) => {
        if (cancelled) return;
        const result = applyLegacyPayload(payload);
        if (!result.reachable) return;
        saveJson(LEGACY_LIBRARY_CHECK_KEY, true);
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
      const librarySaved = saveJson(storageKeys.library, library);
      if (librarySaved && pendingLoadedStarterPackIds) {
        const loadedPackIdsSaved = persistLoadedPacks(pendingLoadedStarterPackIds);
        if (loadedPackIdsSaved) {
          setPendingLoadedStarterPackIds(null);
        }
      }
    }, 120);
    return () => window.clearTimeout(timeoutId);
  }, [library, libReady, pendingLoadedStarterPackIds]);

  useEffect(() => {
    if (!libReady) return undefined;
    const timeoutId = window.setTimeout(() => {
      saveJson(storageKeys.collections, collections);
    }, 120);
    return () => window.clearTimeout(timeoutId);
  }, [collections, libReady]);

  const updateLibraryEntry = (entryId, updater) => {
    let changed = false;
    setLibrary(prev => prev.map(entry => {
      if (entry.id !== entryId) return entry;
      const next = updater(entry);
      if (!next || next === entry) return entry;
      changed = true;
      return next;
    }));
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
      updateLibraryEntry(editingId, entry => {
        const next = updatePromptEntry(entry, payload, { source: 'manual_save', changeNote: ensureString(changeNote) });
        savedTitle = next?.title || savedTitle;
        return next;
      });
      notify('Prompt updated!');
      return { id: editingId, title: savedTitle };
    }

    const entry = createPromptEntry({
      ...payload,
      useCount: 0,
      versions: [],
      testCases: [],
    });
    setLibrary(prev => [entry, ...prev]);
    notify('Saved!');
    return { id: entry.id, title: entry.title };
  };

  const del = id => {
    if (!window.confirm('Delete this prompt?')) return;
    setLibrary(prev => prev.filter(entry => entry.id !== id));
    notify('Prompt deleted.');
  };

  const bumpUse = id => updateLibraryEntry(id, entry => ({
    ...entry,
    useCount: entry.useCount + 1,
  }));

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

  const moveLibraryEntryByOffset = (entryId, offset) => {
    if (!entryId || !Number.isFinite(offset) || offset === 0) return;
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
    const url = URL.createObjectURL(new Blob([JSON.stringify(library, null, 2)], { type: 'application/json' }));
    const anchor = Object.assign(document.createElement('a'), { href: url, download: 'prompt-library.json' });
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const importLib = event => {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      notify('Import failed: file is too large.');
      event.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = readEvent => {
      try {
        const parsed = JSON.parse(readEvent.target.result);
        const normalized = normalizeLibrary(parsed);
        if (!normalized.length) {
          notify('Import failed: no valid prompts found.');
          return;
        }
        setLibrary(prev => normalizeLibrary([...normalized, ...prev]));
        setCollections(prev => [...new Set([...prev, ...deriveCollectionsFromLibrary(normalized)])]);
        notify(`Imported ${normalized.length} prompts!`);
      } catch {
        notify('Import failed');
      } finally {
        event.target.value = '';
      }
    };
    reader.onerror = () => {
      notify('Import failed while reading the file.');
      event.target.value = '';
    };
    reader.onabort = () => {
      notify('Import was cancelled.');
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

    const commitStarterPack = () => {
      libraryRef.current = result.library;
      collectionsRef.current = result.collections;
      setLibrary(result.library);
      setCollections(result.collections);
      setLoadedStarterPackIds(result.loadedPackIds);
      setPendingLoadedStarterPackIds(result.loadedPackIds);
    };

    startTransition(commitStarterPack);

    if (result && result.count > 0) {
      notify(`Loaded ${result.count} prompts into ${result.collection}`);
    } else if (result.count === 0) {
      notify('Pack already loaded.');
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
        notify('Legacy web library bridge is unavailable.');
        return { importedCount: 0, reason: 'unreachable' };
      }
      saveJson(LEGACY_LIBRARY_CHECK_KEY, true);

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

  const filtered = useMemo(() => {
    const query = search.toLowerCase();
    return [...library]
      .filter(entry => {
        const title = ensureString(entry.title).toLowerCase();
        return (!query || title.includes(query) || (entry.tags || []).some(tag => tag.toLowerCase().includes(query)))
          && (!activeTag || (entry.tags || []).includes(activeTag))
          && (!activeCollection || entry.collection === activeCollection);
      })
      .sort((left, right) => {
        if (sortBy === 'manual') return 0;
        if (sortBy === 'oldest') return new Date(left.createdAt) - new Date(right.createdAt);
        if (sortBy === 'most-used') return right.useCount - left.useCount;
        if (sortBy === 'a-z') return (left.title || '').localeCompare(right.title || '');
        if (sortBy === 'z-a') return (right.title || '').localeCompare(left.title || '');
        if (sortBy === 'group') {
          const lc = left.collection || '';
          const rc = right.collection || '';
          if (lc && !rc) return -1;
          if (!lc && rc) return 1;
          const cmp = lc.localeCompare(rc);
          return cmp !== 0 ? cmp : (left.title || '').localeCompare(right.title || '');
        }
        const newestDelta = getNewestSortTimestamp(right) - getNewestSortTimestamp(left);
        if (newestDelta !== 0) return newestDelta;
        return new Date(right.createdAt) - new Date(left.createdAt);
      });
  }, [activeCollection, activeTag, library, search, sortBy]);

  const quickInject = useMemo(
    () => [...library].sort((left, right) => right.useCount - left.useCount).slice(0, 5),
    [library],
  );

  return {
    library, setLibrary, libReady, collections, setCollections,
    search, setSearch, activeTag, setActiveTag, activeCollection, setActiveCollection,
    sortBy, setSortBy, expandedId, setExpandedId, expandedVersionId, setExpandedVersionId, diffVersionIdx, setDiffVersionIdx,
    shareId, setShareId, renamingId, setRenamingId, renameValue, setRenameValue,
    draggingLibraryId, setDraggingLibraryId, dragOverLibraryId, setDragOverLibraryId,
    doSave, del, bumpUse, moveLibraryEntry, moveLibraryEntryByOffset, renameEntry, restoreVersion, openVersionHistory, closeVersionHistory,
    pinGoldenResponse, clearGoldenResponse, setGoldenThreshold,
    exportLib, importLib, getShareUrl,
    recoverLegacyWebLibrary, recoveringLegacyLibrary,
    starterLibraries, loadStarterPack,
    allLibTags, filtered, quickInject,
  };
}
