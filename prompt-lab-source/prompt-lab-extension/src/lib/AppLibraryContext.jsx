import { createContext, useContext, useRef } from 'react';
import * as legacyRecords from '../experimentStore.js';
import { createScratchRepositoryStore } from './scratchRepositoryStore.js';

const browserRecords = {
  ...legacyRecords,
  // The repository store takes the observed record as its second argument.
  // Legacy deletion has no version argument and must never interpret it as a store.
  deleteTestCase: id => legacyRecords.deleteTestCase(id),
  patchEvalRun: (id, patch) => legacyRecords.patchEvalRun(id, patch),
};
const AppLibraryContext = createContext({ repository: null, records: browserRecords, scratch: null });

// The startup owner must review migration before supplying this dependency.
// Changing libraries requires a drained, remounted app, never a render-time swap.
export function AppLibraryProvider({ repository = null, children }) {
  const selected = useRef(null);
  if (!selected.current) {
    selected.current = {
      repository,
      records: repository ? legacyRecords.createExperimentStore(repository) : browserRecords,
      scratch: repository ? createScratchRepositoryStore(repository) : null,
    };
  }
  if (selected.current.repository !== repository) {
    throw new Error('Remount the app after reviewing a library change.');
  }
  return <AppLibraryContext.Provider value={selected.current}>{children}</AppLibraryContext.Provider>;
}

export const useAppLibrary = () => useContext(AppLibraryContext);
export const useAppRecords = () => useAppLibrary().records;
