import { useEffect, useState } from 'react';
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

  useEffect(() => {
    const storedLibrary = loadJson(storageKeys.library, null);
    const hasStoredLibrary = Array.isArray(storedLibrary);
    setLibrary(normalizeLibrary(hasStoredLibrary ? storedLibrary : DEFAULT_LIBRARY_SEEDS));
    const storedCollections = loadJson(storageKeys.collections, null);
    if (Array.isArray(storedCollections)) {
      setCollections(storedCollections.filter(item => typeof item === 'string' && item.trim()));
    } else if (!hasStoredLibrary) {
      setCollections(['Handoff Templates']);
    }
    setLibReady(true);
  }, []);

  useEffect(() => {
    if (libReady) saveJson(storageKeys.library, library);
  }, [library, libReady]);

  useEffect(() => {
    saveJson(storageKeys.collections, collections);
  }, [collections]);

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

  const moveLibraryEntry = (sourceId, targetId) => {
    if (!sourceId || !targetId || sourceId === targetId) return;
    setLibrary(prev => {
      const from = prev.findIndex(entry => entry.id === sourceId);
      const to = prev.findIndex(entry => entry.id === targetId);
      if (from < 0 || to < 0 || from === to) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
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
        notify(`Imported ${normalized.length} prompts!`);
      } catch {
        notify('Import failed');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  const getShareUrl = entry => {
    if (!entry) return null;
    const code = encodeShare(entry);
    return code ? `${window.location.origin}${window.location.pathname}#share=${code}` : null;
  };

  const allLibTags = [...new Set(library.flatMap(entry => entry.tags || []))];
  const filtered = [...library]
    .filter(entry => {
      const query = search.toLowerCase();
      const title = ensureString(entry.title).toLowerCase();
      return (!query || title.includes(query) || (entry.tags || []).some(tag => tag.toLowerCase().includes(query)))
        && (!activeTag || (entry.tags || []).includes(activeTag))
        && (!activeCollection || entry.collection === activeCollection);
    })
    .sort((left, right) => {
      if (sortBy === 'manual') return 0;
      if (sortBy === 'oldest') return new Date(left.createdAt) - new Date(right.createdAt);
      if (sortBy === 'most-used') return right.useCount - left.useCount;
      return new Date(right.createdAt) - new Date(left.createdAt);
    });
  const quickInject = [...library].sort((left, right) => right.useCount - left.useCount).slice(0, 5);

  return {
    library, setLibrary, libReady, collections, setCollections,
    search, setSearch, activeTag, setActiveTag, activeCollection, setActiveCollection,
    sortBy, setSortBy, expandedId, setExpandedId, expandedVersionId, setExpandedVersionId, diffVersionIdx, setDiffVersionIdx,
    shareId, setShareId, renamingId, setRenamingId, renameValue, setRenameValue,
    draggingLibraryId, setDraggingLibraryId, dragOverLibraryId, setDragOverLibraryId,
    doSave, del, bumpUse, moveLibraryEntry, renameEntry, restoreVersion, openVersionHistory, closeVersionHistory,
    pinGoldenResponse, clearGoldenResponse, setGoldenThreshold,
    exportLib, importLib, getShareUrl,
    allLibTags, filtered, quickInject,
  };
}
