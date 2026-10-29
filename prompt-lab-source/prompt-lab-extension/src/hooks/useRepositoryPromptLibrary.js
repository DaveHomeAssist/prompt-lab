import { useEffect, useMemo, useRef, useState } from 'react';
import { createPromptLibraryStore } from '../lib/promptLibraryStore.js';
import { normalizeTagList } from '../lib/tagSchema.js';

// Selection belongs to the native migration owner. This hook only consumes an
// explicitly supplied dependency; it cannot activate or switch personal data.
export function useRepositoryPromptLibrary(repository, notify) {
  const original = useRef(repository), notifyRef = useRef(notify);
  notifyRef.current = notify;
  if (repository !== original.current) throw new Error('Remount the Library after reviewing a storage change.');
  const [, render] = useState(0);
  const store = useMemo(() => repository ? createPromptLibraryStore(repository, { notify: message => notifyRef.current?.(message) }) : null, [repository]);
  useEffect(() => {
    if (!store) return undefined;
    const unsubscribe = store.subscribe(() => render(value => value + 1));
    void store.open().catch(() => {}); // The store retains and reports its error.
    return unsubscribe;
  }, [store]);
  if (!store) return null;

  const unavailable = () => { notifyRef.current?.('This action is not available for the selected Library yet. Your data is unchanged.'); return false; };
  const unconnected = Object.fromEntries(['setLibrary', 'setTrash', 'setCollections', 'duplicateEntry',
    'moveLibraryEntry', 'moveLibraryEntryByOffset', 'clearLibrary',
    'restoreVersion', 'removeEntriesByPackId', 'assignEntriesToPack', 'exportLib', 'exportEntries', 'importLib',
    'retryImport', 'chooseImportResolution', 'cancelImportPreview', 'confirmImport', 'recoverLegacyWebLibrary',
    'loadStarterPack'].map(key => [key, unavailable]));
  const lifecycle = async (action, id, confirmation = {}) => {
    const result = await store.changeLifecycle(action, id, confirmation);
    return result ? result.record ?? true : false;
  };
  return {
    ...unconnected, repository, library: store.library, trash: store.trash,
    collections: store.collections, folders: store.folders, libReady: store.libReady,
    saving: store.saving, saveError: store.saveError, retryPending: store.retryPending,
    refresh: store.refresh, doSave: store.doSave, linkSavedPrompt: store.linkSavedPrompt,
    saveEntryDetails: store.saveEntryDetails, setFavorite: store.setFavorite, updateEntries: store.updateEntries,
    saveFolders: store.saveFolders, deleteCollection: store.deleteCollection, moveEntriesToCollection: store.moveEntriesToCollection,
    addTagToEntries: (ids, tag) => store.updateEntries(ids, entry => ({ ...entry, tags: normalizeTagList([...(entry.tags || []), tag]) })),
    del: (id, { skipConfirm = false } = {}) => !skipConfirm && !window.confirm('Move this prompt to Recently Deleted?') ? false : lifecycle('trash', id),
    restoreDeleted: id => lifecycle('restore', id),
    restoreDeletedEntries: ids => store.changeLifecycles('restore', ids),
    permanentlyDelete: id => window.confirm('Remove this prompt from the active Library? Its retained history and backups are preserved.')
      ? lifecycle('delete', id, { confirmPermanentDeletion: true }) : false,
    deleteEntries: ids => window.confirm(`Move ${ids.length} prompts to Recently Deleted?`) ? store.changeLifecycles('trash', ids) : false,
    permanentlyDeleteEntries: ids => window.confirm(`Remove ${ids.length} prompts from the active Library? Retained history and backups are preserved.`)
      ? store.changeLifecycles('delete', ids, { confirmPermanentDeletion: true }) : false,
    renameEntry: async (id, title, editingId, setTitle) => {
      if (!title.trim()) return false;
      const result = await store.saveEntryDetails(id, entry => ({ ...entry, title: title.trim() }));
      if (result && editingId === id) setTitle?.(title.trim());
      return result;
    },
    bumpUse: id => store.saveEntryDetails(id, entry => ({ ...entry, useCount: (entry.useCount || 0) + 1 })),
    trackRecentAccess: id => store.saveEntryDetails(id, entry => ({ ...entry, lastAccessedAt: new Date().toISOString() })),
    pinGoldenResponse: (id, { text, runId, provider, model } = {}) => typeof text === 'string' && text.trim()
      ? store.saveEntryDetails(id, entry => ({ ...entry, goldenResponse: { text, pinnedAt: new Date().toISOString(),
        pinnedFromRunId: runId || '', provider: provider || '', model: model || '' } })) : false,
    clearGoldenResponse: id => store.saveEntryDetails(id, entry => ({ ...entry, goldenResponse: null })),
    setGoldenThreshold: (id, threshold) => store.saveEntryDetails(id, entry => ({ ...entry, goldenThreshold: threshold })),
    recordSuiteResult: (id, suite) => store.saveEntryDetails(id, entry => ({ ...entry, metadata: { ...(entry.metadata || {}), suite } })),
    pendingImport: false, importPreview: null, importApplying: false, recoveringLegacyLibrary: false, starterLibraries: [],
  };
}
