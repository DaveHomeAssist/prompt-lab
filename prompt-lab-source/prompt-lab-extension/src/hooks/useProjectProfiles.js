import { useEffect, useRef, useState } from 'react';
import { storageKeys } from '../lib/storage.js';
import {
  EXAMPLE_PROJECT_PROFILE,
  activeProfile,
  buildProfilePreamble,
  deleteProfile,
  downloadProfileExport,
  duplicateProfile,
  loadProjectProfiles,
  mergeProfileLists,
  migrateProjectProfiles,
  parseProfileImport,
  reorderProfile,
  selectProfile,
  upsertProfile,
  writeProjectProfiles,
} from '../lib/projectProfiles.js';

/** Local project profiles, shared by the header, saves, and provider sends. */
export default function useProjectProfiles() {
  const initial = migrateProjectProfiles();
  const [profiles, setProfiles] = useState(initial.profiles);
  const [error, setError] = useState(initial.error || '');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [runDisabled, setRunDisabled] = useState(false);
  const active = activeProfile(profiles);
  const activeId = active?.id || '';
  const previousActive = useRef(activeId);
  const sendRef = useRef({ profile: null, disabled: false });
  sendRef.current = { profile: active, disabled: runDisabled || !active };

  useEffect(() => {
    if (previousActive.current === activeId) return;
    previousActive.current = activeId;
    setRunDisabled(false);
  }, [activeId]);

  useEffect(() => {
    const onStorage = (event) => {
      if (event.key !== storageKeys.projectProfiles && event.key !== storageKeys.projectProfilesSchemaVersion) return;
      const next = migrateProjectProfiles();
      setProfiles(next.profiles);
      if (next.error) setError(next.error);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const commit = (next) => {
    const written = writeProjectProfiles(next);
    if (!written.ok) {
      setError(written.error);
      return written;
    }
    setProfiles(written.profiles);
    setError('');
    return written;
  };

  const select = (id) => {
    const written = commit(selectProfile(profiles, id));
    if (written.ok) setPickerOpen(false);
    return written.ok;
  };

  return {
    profiles,
    active,
    preamble: buildProfilePreamble(active),
    error,
    pickerOpen,
    setPickerOpen,
    managerOpen,
    setManagerOpen,
    previewOpen,
    setPreviewOpen,
    runDisabled,
    setRunDisabled,
    sendRef,
    togglePicker: () => {
      setManagerOpen(false);
      setPickerOpen((open) => !open);
    },
    closePicker: () => setPickerOpen(false),
    openManager: () => {
      setPickerOpen(false);
      setManagerOpen(true);
    },
    closeManager: () => setManagerOpen(false),
    select,
    save: (draft) => commit(upsertProfile(profiles, draft)),
    duplicate: (id) => commit(duplicateProfile(profiles, id)),
    remove: (id) => commit(deleteProfile(profiles, id)),
    reorder: (id, direction) => commit(reorderProfile(profiles, id, direction)),
    importText: (source) => {
      const parsed = parseProfileImport(source);
      if (!parsed.ok) {
        setError(parsed.error);
        return { ok: false, error: parsed.error, profiles };
      }
      return commit(mergeProfileLists(profiles, parsed.profiles));
    },
    importExample: () => {
      if (profiles.some((profile) => profile.id === EXAMPLE_PROJECT_PROFILE.id)) return false;
      return commit(mergeProfileLists(profiles, [{ ...EXAMPLE_PROJECT_PROFILE, selected: profiles.length === 0 }])).ok;
    },
    exportProfiles: () => downloadProfileExport(profiles),
    reload: () => setProfiles(loadProjectProfiles()),
  };
}
