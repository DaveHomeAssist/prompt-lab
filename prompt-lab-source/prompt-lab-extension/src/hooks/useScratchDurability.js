import { useSyncExternalStore } from 'react';
import { getScratchDurability, subscribeScratchDurability } from '../lib/scratchJournal.js';

export default function useScratchDurability() {
  return useSyncExternalStore(subscribeScratchDurability, getScratchDurability, getScratchDurability);
}
