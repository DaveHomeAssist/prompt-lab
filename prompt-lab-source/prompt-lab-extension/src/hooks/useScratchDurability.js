import { useSyncExternalStore } from 'react';
import { getScratchDurability, subscribeScratchDurability } from '../lib/scratchJournal.js';
import { useAppLibrary } from '../lib/AppLibraryContext.jsx';

export default function useScratchDurability() {
  const { scratch } = useAppLibrary();
  const subscribe = scratch?.subscribe || subscribeScratchDurability;
  const getStatus = scratch?.getStatus || getScratchDurability;
  return useSyncExternalStore(subscribe, getStatus, getStatus);
}
