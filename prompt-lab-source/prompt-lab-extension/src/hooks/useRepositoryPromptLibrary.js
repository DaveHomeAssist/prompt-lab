import { useEffect, useMemo, useRef, useState } from 'react';
import { createPromptLibraryStore } from '../lib/promptLibraryStore.js';
import { normalizeTagList } from '../lib/tagSchema.js';
import { getStarterLibraries, getStarterPackSource } from '../lib/seedTransform.js';

// Selection belongs to the native migration owner. This hook only consumes an
// explicitly supplied dependency; it cannot activate or switch personal data.
export function useRepositoryPromptLibrary(repository, notify) {
  const original = useRef(repository), notifyRef = useRef(notify);
  const fileRead = useRef(0);
  const exportFlight = useRef(null);
  const [exportState, setExportState] = useState({ pending: false, error: '' });
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
    'restoreVersion', 'removeEntriesByPackId', 'assignEntriesToPack', 'importLib',
    'retryImport', 'chooseImportResolution', 'cancelImportPreview', 'confirmImport', 'recoverLegacyWebLibrary',
    'loadStarterPack'].map(key => [key, unavailable]));
  const lifecycle = async (action, id, confirmation = {}) => {
    const result = await store.changeLifecycle(action, id, confirmation);
    return result ? result.record ?? true : false;
  };
  const exportFile = (read, filename, message) => {
    if (exportFlight.current) return Promise.resolve(false);
    setExportState({ pending: true, error: '' });
    const task = (async () => {
      try {
        const payload = await read();
        const url = URL.createObjectURL(new Blob([JSON.stringify(payload)], { type: 'application/json' }));
        try { Object.assign(document.createElement('a'), { href: url, download: filename }).click(); }
        finally { window.setTimeout(() => URL.revokeObjectURL(url), 0); }
        setExportState({ pending: false, error: '' });
        notifyRef.current?.(message);
        return payload;
      } catch (error) {
        const reason = error.code === 'RATE_LIMIT' ? 'Too many Library requests. Wait a minute, then try again.'
          : ['SERVICE_UNAVAILABLE', 'DISCONNECTED'].includes(error.code) ? 'Library service is unavailable. Reconnect and try the export again.'
            : error.message || 'Please retry.';
        const message = `Export failed. ${reason}`;
        setExportState({ pending: false, error: message, needsRefresh: error.code === 'REVISION_CONFLICT' }); notifyRef.current?.(message);
        return false;
      } finally { exportFlight.current = null; }
    })();
    exportFlight.current = task;
    return task;
  };
  return {
    ...unconnected, repository, library: store.library, trash: store.trash,
    collections: store.collections, folders: store.folders, libReady: store.libReady,
    packRegistry: store.packRegistry, packEntries: store.packEntries, revision: store.revision,
    publishPack: store.publishPack, uninstallPack: store.uninstallPack,
    saving: store.saving, saveError: store.saveError, retryPending: store.retryPending,
    exporting: exportState.pending, exportError: exportState.error, exportNeedsRefresh: exportState.needsRefresh,
    refreshExport: async () => {
      try {
        await store.refresh(); setExportState({ pending: false, error: '' });
        notifyRef.current?.('Library refreshed. Review the selection and try the export again.'); return true;
      } catch (error) {
        setExportState({ pending: false, error: `Refresh failed. ${error.message || 'Please retry.'}`, needsRefresh: true }); return false;
      }
    },
    exportLib: () => {
      if (exportFlight.current) return Promise.resolve(false);
      if (!window.confirm('Download a complete saved Library backup? It includes retained history, deleted content and prior backups. Unsaved editor changes are not included.')) return Promise.resolve(false);
      return exportFile(() => store.exportLibrary(), `prompt-lab-backup-${new Date().toISOString().slice(0, 10)}.json`,
        'Library backup download started. Retained history and backups are included.');
    },
    exportEntries: entries => exportFile(() => store.exportEntries(entries.map(entry => entry.id)), 'prompt-lab-selection.json',
      'Selected prompt pack download started. Embedded histories are included; this is not a workspace backup.'),
    refresh: store.refresh, doSave: store.doSave, linkSavedPrompt: store.linkSavedPrompt,
    saveEntryDetails: store.saveEntryDetails, setFavorite: store.setFavorite, updateEntries: store.updateEntries,
    saveFolders: store.saveFolders, deleteCollection: store.deleteCollection, moveEntriesToCollection: store.moveEntriesToCollection,
    reviewPackImport: store.reviewPackImport,
    importLib: event => {
      const input = event.target, file = input.files?.[0], readId = ++fileRead.current;
      input.value = '';
      if (!file) return;
      if (store.pendingImport || store.saving) { notifyRef.current?.('Retry the retained Library change before selecting another file.'); return; }
      if (file.size > 20_000_000) { notifyRef.current?.('Choose a pack smaller than 20 MB.'); return; }
      const reader = new FileReader();
      reader.onload = () => { if (readId === fileRead.current) store.reviewPackImport(reader.result, file.name); };
      reader.onerror = () => { if (readId === fileRead.current) notifyRef.current?.('The import file could not be read. Your Library is unchanged.'); };
      reader.readAsText(file);
    },
    retryImport: store.retryImport, confirmImport: store.confirmImport,
    chooseImportResolution: store.chooseImportResolution, cancelImportPreview: store.cancelImportPreview,
    loadStarterPack: id => {
      try {
        if (store.loadedPackIds.includes(id)) { notifyRef.current?.('Pack already loaded.'); return false; }
        return store.reviewPackImport(getStarterPackSource(id), 'Starter Library');
      } catch (error) { notifyRef.current?.(error.message); return false; }
    },
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
    pendingImport: store.pendingImport, importPreview: store.importPreview, importApplying: store.importApplying,
    recoveringLegacyLibrary: false, starterLibraries: getStarterLibraries(store.loadedPackIds),
  };
}
