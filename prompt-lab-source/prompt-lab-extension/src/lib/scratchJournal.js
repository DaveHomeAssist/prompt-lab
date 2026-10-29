import { createLibraryJournal } from './libraryJournal.js';
import { storageKeys } from './storage.js';
import { logWarn } from './logger.js';

export const SCRATCH_JOURNAL_RECORD = 'scratch';
export const SCRATCH_JOURNAL_REVISION_KEY = 'pl2-scratch-journal-revision';
export const SCRATCH_JOURNAL_BOOT_MARK = 'prompt-lab:scratch-journal-boot';
const KEYS = [storageKeys.scratch, storageKeys.scratchSchemaVersion, storageKeys.pad, `${storageKeys.pad}_meta`, 'pl-pad', 'pl-pad_meta'];
const IDLE = Object.freeze({ status: 'idle', bootFailed: false });
const UNAVAILABLE = Object.freeze({ status: 'error', bootFailed: true });
const listeners = new Set();
let activeJournal = null;
let snapshot = IDLE;
let operation = 0;
const desktop = () => typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__);
const publish = value => { snapshot = value; listeners.forEach(listener => listener()); };

export const subscribeScratchDurability = listener => { listeners.add(listener); return () => listeners.delete(listener); };
export const getScratchDurability = () => desktop() ? (activeJournal ? snapshot : UNAVAILABLE) : IDLE;

export function assertScratchJournalReady() {
  if (desktop() && !activeJournal) throw new Error('Durable Scratch storage is unavailable. Retry loading before editing.');
}

export function createScratchJournal({ storage, idb, timeoutMs }) {
  return createLibraryJournal({
    storage, idb, timeoutMs,
    recordId: SCRATCH_JOURNAL_RECORD,
    revisionKey: SCRATCH_JOURNAL_REVISION_KEY,
    isKey: key => KEYS.includes(key),
    readState: target => {
      const entries = {};
      for (const key of KEYS) {
        const value = target.getItem(key);
        if (value !== null) entries[key] = value;
      }
      return entries;
    },
    applyRecord: (target, record) => {
      for (const key of KEYS) {
        if (Object.hasOwn(record.entries, key)) target.setItem(key, record.entries[key]);
        else target.removeItem(key);
      }
      target.setItem(SCRATCH_JOURNAL_REVISION_KEY, String(record.revision));
    },
  });
}

// localStorage remains the synchronous mirror used by both Scratch surfaces.
// Only the strict IndexedDB completion acknowledges a desktop save.
export function commitScratchSave() {
  if (!desktop()) return null;
  assertScratchJournalReady();
  const current = ++operation;
  publish({ status: 'saving', bootFailed: false });
  activeJournal.commit();
  const committed = activeJournal.flush();
  committed.then(() => {
    if (current === operation) publish({ status: 'saved', bootFailed: false });
  }, error => {
    logWarn('scratch durable save', error);
    if (current === operation) publish({ status: 'error', bootFailed: false });
  });
  return committed;
}

// An independent record/revision keeps a Library recovery from replacing notes.
// Startup waits for recovery before any Scratch component can read the mirror.
export async function startScratchJournal({ storage = localStorage, idb = globalThis.indexedDB, timeoutMs } = {}) {
  const journal = createScratchJournal({ storage, idb, timeoutMs });
  const current = ++operation;
  let outcome;
  try {
    outcome = await journal.restore();
    await journal.flush();
    activeJournal = journal;
    if (current === operation) publish(IDLE);
  } catch (error) {
    activeJournal = null;
    logWarn('scratch journal restore', error);
    outcome = { action: 'unavailable', error: error?.message || String(error) };
    if (current === operation) publish(UNAVAILABLE);
  }
  try { performance.mark(SCRATCH_JOURNAL_BOOT_MARK, { detail: outcome }); } catch { /* Diagnostics only. */ }
  return { journal, outcome, stop: () => {
    if (activeJournal === journal) { activeJournal = null; ++operation; publish(IDLE); }
  } };
}
