import { APP_RECORD_VERSION } from './appRecordVersion.js';
import { normalizeEntry, suggestTitleFromText } from './promptSchema.js';
import { normalizeTagList } from './tagSchema.js';
import { ensureString } from './utils.js';
import { canonical } from '../../../library-storage/contract.mjs';

// An explicit dependency for the editor. Construction never selects storage.
export function createPromptLibraryStore(repository, { notify = () => {}, newId = () => crypto.randomUUID() } = {}) {
  if (!repository || ['readPromptLibrary', 'createPrompt', 'editPrompt', 'changePromptLifecycle', 'readRecord', 'saveRecord']
    .some(key => typeof repository[key] !== 'function')) throw new TypeError('A shared prompt repository is required.');
  let view = { library: [], trash: [] }, ready = false, attempt = null, actionAttempt = null, saveError = '';
  const listeners = new Set();
  const emit = () => { for (const listener of listeners) listener(); };
  const presentation = entry => normalizeEntry({ ...entry,
    // Old exports may omit a version ID. The service uses this exact fallback
    // when preserving the previous version; never invent a new UI identity.
    currentVersionId: entry.currentVersionId || `v-${entry[APP_RECORD_VERSION].valueHash.slice(7)}` });
  const readback = async () => { view = await repository.readPromptLibrary(); ready = true; emit(); return view; };
  const report = error => { saveError = `${error.message || 'Save was not confirmed.'} Your draft is still available.`; notify(saveError); emit(); };
  const owned = new Set(['id', 'versions', 'currentVersionId', 'createdAt', 'schema_version', 'schemaVersion', 'version', 'deletedAt', 'tombstoneVersion']);
  function observed(id, domain = 'library') {
    if (!ready) throw new Error('Open the selected Library before making changes.');
    const rows = view[domain].filter(row => row.id === id);
    if (rows.length !== 1) throw new Error('Review the current prompt before changing it.');
    return rows[0];
  }
  function updates(record, updater) {
    const shown = presentation(record), next = updater(structuredClone(shown));
    if (!next || typeof next !== 'object' || Array.isArray(next)) throw new Error('Prompt changes must contain explicit fields.');
    const changes = {};
    for (const [key, value] of Object.entries(next)) {
      if (['updatedAt', 'updated_at'].includes(key)) continue;
      if (Object.hasOwn(shown, key) && canonical(shown[key]) === canonical(value)) continue;
      if (owned.has(key)) throw new Error('Prompt identity and history are owned by the Library.');
      changes[key] = value;
    }
    return changes;
  }
  async function batchObserved(ids, domain, action) {
    const selected = [...new Set(ids)], bases = new Map(); let completed = 0;
    try {
      for (const id of selected) bases.set(id, observed(id, domain)[APP_RECORD_VERSION]);
      for (const id of selected) {
        const before = bases.get(id), current = observed(id, domain)[APP_RECORD_VERSION];
        if (before.valueHash !== current.valueHash || before.groupId !== current.groupId) {
          throw new Error('A selected prompt changed during the batch. Review before retrying.');
        }
        if (!await action(id)) break;
        completed++;
      }
    } catch (error) { report(error); }
    return { completed, requested: selected.length };
  }
  function runAction(signature, prepare, execute, message) {
    if (attempt) { report(new Error('Resolve the retained editor save before changing the Library.')); return Promise.resolve(false); }
    if (actionAttempt?.pending) return actionAttempt.signature === signature ? actionAttempt.pending : Promise.resolve(false);
    try {
      if (actionAttempt && actionAttempt.signature !== signature) throw new Error('Retry the retained Library change before starting another.');
      actionAttempt ??= { signature, prepared: prepare(), execute, message, completed: null, pending: null };
    } catch (error) { report(error); return Promise.resolve(false); }
    const current = actionAttempt;
    current.pending = (async () => {
      try {
        current.completed ??= await current.execute(current.prepared);
        await readback();
        const saved = current.completed.record;
        if (saved) {
          const rows = [...view.library, ...view.trash].filter(row => row.id === saved.id);
          if (rows.length !== 1 || rows[0][APP_RECORD_VERSION].valueHash !== saved[APP_RECORD_VERSION].valueHash) {
            throw new Error('Another change followed this save. Review the retained operation and current prompt.');
          }
        }
        saveError = ''; actionAttempt = null; notify(current.message); return current.completed;
      } catch (error) { report(error); return false; }
      finally { current.pending = null; emit(); }
    })();
    emit(); return current.pending;
  }
  const receipt = ({ record, receipt: committed, identity, unchanged }, savedAsNew = false) => ({
    id: record.id, title: record.title || suggestTitleFromText(record.enhanced || record.original),
    versionId: presentation(record).currentVersionId, versionNumber: (record.versions?.length ?? 0) + 1,
    libraryId: (committed || identity).libraryId, revision: (committed || identity).revision, operationId: committed?.operationId ?? null,
    ...(unchanged ? { unchanged: true } : {}),
    ...(savedAsNew ? { savedAsNew: true } : {}),
  });
  function prepare(args) {
    if (!ready) throw new Error('Open the selected Library before saving.');
    const original = ensureString(args.raw), enhanced = ensureString(args.enhanced).trim() ? ensureString(args.enhanced) : original;
    const fields = { title: ensureString(args.title).trim() || suggestTitleFromText(enhanced), original, enhanced,
      variants: Array.isArray(args.variants) ? args.variants : [], notes: ensureString(args.notes),
      tags: normalizeTagList(args.tags), collection: ensureString(args.collection),
      ...(args.resultMeta !== undefined ? { resultMeta: args.resultMeta } : {}),
      ...(args.metadata && typeof args.metadata === 'object' ? { metadata: args.metadata } : {}),
      ...(ensureString(args.kind).trim() ? { kind: ensureString(args.kind).trim() } : {}),
      ...(ensureString(args.sourceNoteId).trim() ? { sourceNoteId: ensureString(args.sourceNoteId).trim() } : {}),
      ...(ensureString(args.changeNote).trim() ? { changeNote: ensureString(args.changeNote).trim() } : {}),
    };
    if (args.editingId && !args.copyAsNew) {
      const matches = view.library.filter(row => row.id === args.editingId);
      if (matches.length !== 1) throw new Error('The edited prompt is missing or ambiguous. Review it, or explicitly save a new prompt.');
      const record = matches[0], displayed = presentation(record), versionId = displayed?.currentVersionId;
      if (!args.expectedVersionId || args.expectedVersionId !== versionId) throw new Error('This editor has no current saved version. Reload the prompt or save a new prompt.');
      // Rendering may normalize legacy content. A field left as displayed is
      // not an edit and must retain its original stored representation.
      const changed = Object.fromEntries(Object.entries(fields).filter(([key, value]) =>
        !Object.hasOwn(displayed, key) || canonical(displayed[key]) !== canonical(value)));
      return { mode: 'edit', record, fields: changed };
    }
    return { mode: 'create', creationId: newId(), fields: { ...fields, useCount: 0 }, savedAsNew: args.copyAsNew === true };
  }
  const store = {
    repository,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    get library() { return view.library.map(presentation).filter(Boolean); },
    get trash() { return view.trash.map(presentation).filter(Boolean); },
    get collections() { return structuredClone(view.collections ?? []); },
    get folders() { return structuredClone(view.folders ?? []); },
    get libReady() { return ready; },
    get saving() { return Boolean(attempt?.pending || actionAttempt?.pending); },
    get saveError() { return saveError; },
    refresh: readback,
    async open() { try { await repository.open(); return await readback(); } catch (error) { report(error); throw error; } },
    doSave(args) {
      if (actionAttempt) { report(new Error('Retry the retained Library change before saving the editor.')); return Promise.resolve(null); }
      const signature = JSON.stringify(args);
      if (attempt?.pending) return attempt.signature === signature ? attempt.pending : Promise.resolve(null);
      try {
        if (attempt && attempt.signature !== signature) throw new Error('Resolve the retained save before saving a different draft.');
        attempt ??= { signature, prepared: prepare(args), pending: null, completed: null };
      } catch (error) { report(error); return Promise.resolve(null); }
      const current = attempt;
      current.pending = (async () => {
        try {
          const p = current.prepared;
          current.completed ??= p.mode === 'create'
            ? await repository.createPrompt({ creationId: p.creationId, record: p.fields })
            : await repository.editPrompt(p.record, p.fields);
          await readback();
          const confirmed = current.completed.record;
          const rows = view.library.filter(row => row.id === confirmed.id);
          if (rows.length !== 1 || rows[0][APP_RECORD_VERSION].valueHash !== confirmed[APP_RECORD_VERSION].valueHash) {
            throw new Error('Another change followed this save. Review the retained operation and current prompt.');
          }
          const saved = receipt(current.completed, p.savedAsNew);
          saveError = ''; attempt = null;
          notify(saved.unchanged ? 'No changes to save.' : `Saved ${saved.title} as version ${saved.versionNumber}.`);
          return saved;
        } catch (error) { report(error); return null; }
        finally { current.pending = null; emit(); }
      })();
      emit();
      return current.pending;
    },
    saveEntryDetails(id, updater) {
      try {
        const record = observed(id), changes = updates(record, updater);
        return runAction(canonical(['edit', id, changes]), () => ({ record, changes }),
          p => repository.editPrompt(p.record, p.changes), 'Prompt changes saved.').then(Boolean);
      } catch (error) { report(error); return Promise.resolve(false); }
    },
    setFavorite(id, favorite) {
      return store.saveEntryDetails(id, entry => ({ ...entry, favorite: typeof favorite === 'boolean' ? favorite : !entry.favorite }));
    },
    changeLifecycle(action, id, confirmation = {}) {
      return runAction(canonical(['lifecycle', action, id, confirmation]), () => observed(id, action === 'trash' ? 'library' : 'trash'),
        record => repository.changePromptLifecycle(action, record, confirmation), action === 'trash' ? 'Prompt moved to Recently Deleted.'
          : action === 'restore' ? 'Prompt restored.' : 'Deletion recorded. Retained history and backups remain available.');
    },
    updateEntries(ids, updater) {
      return batchObserved(ids, 'library', id => store.saveEntryDetails(id, updater));
    },
    changeLifecycles(action, ids, confirmation = {}) {
      return batchObserved(ids, action === 'trash' ? 'library' : 'trash', id => store.changeLifecycle(action, id, confirmation));
    },
    async retryPending() {
      if (store.saving) return false;
      if (attempt) return store.doSave(JSON.parse(attempt.signature));
      if (actionAttempt) {
        const current = actionAttempt;
        return runAction(current.signature, () => current.prepared, current.execute, current.message);
      }
      try { await repository.resume(); await readback(); saveError = ''; emit(); return true; }
      catch (error) { report(error); return false; }
    },
    async linkSavedPrompt(saved, { runId, sourceNoteId } = {}) {
      if (runId) {
        const run = await repository.readRecord('evaluations', runId);
        if (!run) throw new Error('The related run is unavailable in the selected Library.');
        await repository.saveRecord('evaluations', { ...run, promptId: saved.id, promptVersionId: saved.versionId });
      }
      if (sourceNoteId) {
        const note = await repository.readRecord('scratch-notes', sourceNoteId);
        if (!note) throw new Error('The source Scratch note is unavailable in the selected Library.');
        await repository.saveRecord('scratch-notes', { ...note, linkedPromptId: saved.id });
      }
      await readback();
    },
  };
  return Object.freeze(store);
}
