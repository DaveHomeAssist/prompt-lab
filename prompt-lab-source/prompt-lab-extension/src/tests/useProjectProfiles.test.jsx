import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import useProjectProfiles from '../hooks/useProjectProfiles.js';
import { storageKeys } from '../lib/storage.js';
import { writeProjectProfiles } from '../lib/projectProfiles.js';

describe('useProjectProfiles same-window refresh', () => {
  beforeEach(() => {
    localStorage.removeItem(storageKeys.projectProfiles);
    localStorage.removeItem(storageKeys.projectProfilesSchemaVersion);
  });

  it('picks up profiles written by a workspace import in this window', () => {
    const { result } = renderHook(() => useProjectProfiles());
    expect(result.current.profiles).toEqual([]);

    act(() => {
      writeProjectProfiles([{
        id: 'imported',
        name: 'Imported project',
        instructions: 'Use the imported voice.',
        selected: true,
      }]);
    });

    expect(result.current.profiles.map((profile) => profile.name)).toEqual(['Imported project']);
    expect(result.current.active.id).toBe('imported');

    let saved;
    act(() => {
      saved = result.current.save({ id: 'local', name: 'Local project', instructions: 'Keep both.' });
    });
    expect(saved.ok).toBe(true);
    expect(result.current.profiles.map((profile) => profile.id).sort()).toEqual(['imported', 'local']);
  });
});
