import { canonical } from '../../../library-storage/contract.mjs';
import { validateRecordFields } from '../../../library-storage/record-plan.mjs';
import { APP_RECORD_VERSION } from './appLibraryRepository.js';
import { runLibraryWrite } from './libraryWriteCoordinator.js';
import { normalizeScratchPad } from './scratchSchema.js';

const BASE = Symbol('scratchPresentationBase');
const DOMAIN = 'scratch-notes';
const OMIT_UPDATE = new Set(['id', 'createdAt', 'updatedAt', 'timestamp']);

// Browser storage still returns synchronously. The selected repository returns
// only after its durable command and readback. Keep both callers explicit.
export function afterScratchResult(result, next) {
  return result && typeof result.then === 'function' ? result.then(next) : next(result);
}

function present(record) {
  const display = normalizeScratchPad(record, 0, 0);
  return { ...display, [BASE]: { record, display } };
}

function rawEdit(pad, previous) {
  const base = previous?.[BASE];
  if (!base) throw new Error('Reload this note before editing. Your text is still here.');
  const record = { ...base.record };
  for (const key of Object.keys(pad)) {
    if (OMIT_UPDATE.has(key)) continue;
    if (canonical(pad[key]) !== canonical(base.display[key] ?? null)) record[key] = pad[key];
  }
  return record;
}

export function createScratchRepositoryStore(repository) {
  let state = { pads: [], activePadId: '', revision: 0, tombstones: {} };
  let status = { status: 'loading', bootFailed: true };
  let kept = null;
  const listeners = new Set();
  const publish = next => { status = next; for (const listener of listeners) listener(); };
  const read = async activeId => {
    const records = await repository.readDomain(DOMAIN);
    const pads = records.map(present);
    state = { pads, activePadId: pads.some(pad => pad.id === activeId) ? activeId : pads[0]?.id || '',
      revision: 0, tombstones: {} };
    return state;
  };
  return {
    initial: () => state,
    getStatus: () => status,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    keepDraft(pad, text) {
      const changed = kept?.pad.id !== pad.id || kept?.text !== text;
      kept = { pad, text };
      return changed;
    },
    readDraft: () => kept,
    clearDraft(id, text) { if (kept?.pad.id === id && (text === undefined || kept.text === text)) kept = null; },
    async load() {
      try {
        const payload = await read(state.activePadId);
        publish({ status: 'idle', bootFailed: false });
        return { payload };
      } catch (error) {
        publish({ status: 'error', bootFailed: true });
        return { payload: state, error, errorStage: 'read' };
      }
    },
    async persist(next, { previousState, preferLocalIds = [], removedIds = [] } = {}) {
      const before = previousState || state;
      try {
        if (status.bootFailed) throw new Error('Reload the library before editing Scratch.');
        if (preferLocalIds.length + removedIds.length > 1) throw new Error('Save one reviewed note change at a time.');
        if (!preferLocalIds.length && !removedIds.length) {
          // Selection belongs to the view, never to a note revision.
          state = { ...before, activePadId: next.activePadId };
          return { ok: true, state };
        }
        const id = preferLocalIds[0] || removedIds[0];
        const previous = before.pads.find(pad => pad.id === id);
        const pad = next.pads.find(item => item.id === id);
        let record;
        if (!removedIds.length) {
          if (!pad) throw new Error('The edited note is missing. Keep your text and reload.');
          // A duplicate is a new identity even if its UI object copied symbols.
          record = previous ? rawEdit(pad, previous) : Object.fromEntries(Object.entries(
            pad[BASE] ? { ...rawEdit(pad, pad), id: pad.id } : pad,
          ).filter(([key]) => !['createdAt', 'updatedAt', 'timestamp'].includes(key)));
          // Reject unsupported copies before retaining an impossible command.
          if (!previous) validateRecordFields(record, Object.keys(record), DOMAIN);
        }
        publish({ status: 'saving', bootFailed: false });
        const payload = await runLibraryWrite(async () => {
          let saved;
          if (removedIds.length) {
            if (!previous?.[BASE]) throw new Error('Reload this note before deleting it.');
            await repository.deleteRecord(DOMAIN, id, previous[BASE].record[APP_RECORD_VERSION]);
          } else {
            saved = await repository.saveRecord(DOMAIN, record);
          }
          const current = await read(next.activePadId);
          const observed = current.pads.find(item => item.id === id)?.[BASE].record;
          if (removedIds.length ? observed : !observed
            || observed[APP_RECORD_VERSION].valueHash !== saved[APP_RECORD_VERSION].valueHash) {
            throw new Error('This note changed again after saving. Your edit is retained; review the current note.');
          }
          // Updating a link on another note must not silently rebase the open
          // editor onto a competing version. Keep its actual observed base.
          const open = before.pads.find(item => item.id === before.activePadId);
          const refreshed = current.pads.find(item => item.id === before.activePadId);
          if (open && open.id !== id && next.activePadId === open.id
            && open[BASE]?.record[APP_RECORD_VERSION].valueHash !== refreshed?.[BASE]?.record[APP_RECORD_VERSION].valueHash) {
            state = { ...current, activePadId: open.id, pads: [...current.pads.filter(item => item.id !== open.id), open] };
            return state;
          }
          return current;
        }, { key: `scratch:${repository.libraryId}:${id}` });
        publish({ status: 'idle', bootFailed: false });
        return { ok: true, state: payload };
      } catch (error) {
        publish({ status: 'error', bootFailed: status.bootFailed });
        return { ok: false, state: before, error };
      }
    },
  };
}
