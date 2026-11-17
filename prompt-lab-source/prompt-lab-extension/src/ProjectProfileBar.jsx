import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Ic from './icons.jsx';
import useDialogA11y from './hooks/useDialogA11y.js';
import {
  EXAMPLE_PROJECT_PROFILE,
  MAX_PROFILE_INSTRUCTIONS,
  MAX_PROFILE_OUTPUT_FORMAT,
  PROFILE_COLORS,
  estimateTokens,
} from './lib/projectProfiles.js';

const blankDraft = () => ({
  id: '', name: '', emoji: '', color: '', instructions: '', defaultTags: '', outputFormat: '',
});

function draftFrom(profile) {
  if (!profile) return blankDraft();
  return {
    id: profile.id,
    name: profile.name,
    emoji: profile.emoji || '',
    color: profile.color || '',
    instructions: profile.instructions || '',
    defaultTags: (profile.defaultTags || []).join(', '),
    outputFormat: profile.outputFormat || '',
  };
}

function ProfileMark({ profile }) {
  if (profile?.emoji) return <span className="pl-profile-emoji" aria-hidden="true">{profile.emoji}</span>;
  if (profile?.color) return <span className={`pl-profile-dot is-${profile.color}`} aria-hidden="true" />;
  return <Ic n="Folder" size={12} />;
}

function ProjectProfilesManager({ state, onClose }) {
  const titleId = useId();
  const nameRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const dialogRef = useDialogA11y({ onClose: () => closeRef.current?.(), initialFocusRef: nameRef });
  const [draft, setDraft] = useState(blankDraft);
  const [pendingDelete, setPendingDelete] = useState('');
  const [status, setStatus] = useState('');
  const selected = state.profiles.find((profile) => profile.id === draft.id) || null;
  const tokens = estimateTokens(draft.instructions);
  const exampleLoaded = state.profiles.some((profile) => profile.id === EXAMPLE_PROJECT_PROFILE.id);

  const edit = (profile) => {
    setDraft(draftFrom(profile));
    setPendingDelete('');
    setStatus('');
    nameRef.current?.focus();
  };
  const setField = (key) => (event) => setDraft((current) => ({ ...current, [key]: event.target.value }));

  const save = () => {
    const name = draft.name.trim();
    if (!name) {
      setStatus('Add a name before saving this profile.');
      nameRef.current?.focus();
      return;
    }
    const written = state.save({
      id: draft.id,
      name,
      emoji: draft.emoji,
      color: draft.color,
      instructions: draft.instructions,
      outputFormat: draft.outputFormat,
      defaultTags: draft.defaultTags.split(',').map((tag) => tag.trim()).filter(Boolean),
      example: selected?.example === true && name === selected.name && draft.instructions === selected.instructions,
      selected: selected ? selected.selected : true,
    });
    setStatus(written.ok ? `Saved ${name}.` : (written.error || 'Profile was not saved.'));
    if (written.ok && !draft.id) setDraft(blankDraft());
  };

  const importFile = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const written = state.importText(String(reader.result || ''));
      setStatus(written.ok ? `Imported profiles from ${file.name}.` : (written.error || 'Import failed.'));
    };
    reader.onerror = () => setStatus('That file could not be read.');
    reader.readAsText(file);
  };

  const dialog = (
    <div className="pl-profile-scrim" onClick={onClose}>
      <div
        ref={dialogRef}
        className="pl-profile-manager"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid="project-profile-manager"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="pl-profile-manager-head">
          <div>
            <p className="pl-eyebrow">Local only</p>
            <h2 id={titleId}>Project profiles</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close project profiles">Close</button>
        </header>
        <div className="pl-profile-manager-body">
          <div className="pl-profile-manager-list">
            <div className="pl-profile-manager-actions">
              <button type="button" onClick={() => edit(null)}>New profile</button>
              <button type="button" onClick={() => state.importExample()} disabled={exampleLoaded}>
                {exampleLoaded ? 'Example already added' : 'Import example'}
              </button>
            </div>
            {state.profiles.length === 0 && <p className="pl-profile-empty">No profiles yet. Create one, or import the labelled example.</p>}
            <ul aria-label="Saved project profiles">
              {state.profiles.map((profile, index) => (
                <li key={profile.id}>
                  <button type="button" aria-current={profile.id === draft.id ? 'true' : undefined} onClick={() => edit(profile)}>
                    <ProfileMark profile={profile} />
                    <span>{profile.name}</span>
                    {profile.example && <span className="pl-profile-example">Example</span>}
                    {profile.selected && <span className="pl-profile-active-flag">Active</span>}
                  </button>
                  <button type="button" aria-label={`Move ${profile.name} up`} disabled={index === 0} onClick={() => state.reorder(profile.id, -1)}>Up</button>
                  <button type="button" aria-label={`Move ${profile.name} down`} disabled={index === state.profiles.length - 1} onClick={() => state.reorder(profile.id, 1)}>Down</button>
                </li>
              ))}
            </ul>
            <div className="pl-profile-manager-actions">
              <button type="button" onClick={() => state.exportProfiles()} disabled={state.profiles.length === 0}>Export JSON</button>
              <label className="pl-profile-import">
                Import JSON
                <input className="sr-only" type="file" accept="application/json" onChange={importFile} />
              </label>
            </div>
          </div>
          <form className="pl-profile-form" onSubmit={(event) => { event.preventDefault(); save(); }}>
            <label htmlFor="project-profile-name">Profile name
              <input id="project-profile-name" ref={nameRef} value={draft.name} onChange={setField('name')} maxLength={80} required />
            </label>
            <div className="pl-profile-form-row">
              <label htmlFor="project-profile-emoji">Emoji <span>(optional)</span>
                <input id="project-profile-emoji" value={draft.emoji} onChange={setField('emoji')} maxLength={8} />
              </label>
              <label htmlFor="project-profile-color">Color <span>(optional)</span>
                <select id="project-profile-color" value={draft.color} onChange={setField('color')}>
                  <option value="">None</option>
                  {PROFILE_COLORS.map((color) => <option key={color} value={color}>{color}</option>)}
                </select>
              </label>
            </div>
            <label htmlFor="project-profile-instructions">Instructions
              <textarea
                id="project-profile-instructions"
                value={draft.instructions}
                onChange={setField('instructions')}
                maxLength={MAX_PROFILE_INSTRUCTIONS}
                rows={8}
                aria-describedby="project-profile-instructions-meta"
                placeholder="Voice, audience, stack, terminology, and what to avoid."
              />
            </label>
            <p id="project-profile-instructions-meta" aria-live="polite">
              {draft.instructions.length}/{MAX_PROFILE_INSTRUCTIONS} characters · about {tokens} {tokens === 1 ? 'token' : 'tokens'}
            </p>
            <label htmlFor="project-profile-tags">Default tags <span>(optional, comma separated)</span>
              <input id="project-profile-tags" value={draft.defaultTags} onChange={setField('defaultTags')} placeholder="api, notes" />
            </label>
            <label htmlFor="project-profile-format">Output format <span>(optional)</span>
              <textarea id="project-profile-format" value={draft.outputFormat} onChange={setField('outputFormat')} maxLength={MAX_PROFILE_OUTPUT_FORMAT} rows={3} />
            </label>
            <div className="pl-profile-form-actions">
              <button type="submit">Save profile</button>
              <button type="button" onClick={() => selected && state.duplicate(selected.id)} disabled={!selected}>Duplicate</button>
              {selected && pendingDelete !== selected.id && (
                <button type="button" onClick={() => setPendingDelete(selected.id)}>Delete</button>
              )}
              {selected && pendingDelete === selected.id && (
                <span className="pl-profile-confirm" role="group" aria-label={`Delete ${selected.name}`}>
                  Delete {selected.name}?
                  <button type="button" onClick={() => { state.remove(selected.id); setDraft(blankDraft()); setPendingDelete(''); setStatus(`Deleted ${selected.name}.`); }}>Delete</button>
                  <button type="button" onClick={() => setPendingDelete('')}>Cancel</button>
                </span>
              )}
            </div>
            <p role="status" className="pl-profile-status">{status || state.error}</p>
          </form>
        </div>
      </div>
    </div>
  );
  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body);
}

export default function ProjectProfileBar({ state, suggestion, onUseSuggestion }) {
  const [query, setQuery] = useState('');
  const searchRef = useRef(null);
  const chipRef = useRef(null);
  const rootRef = useRef(null);
  const closePickerRef = useRef(state.closePicker);
  closePickerRef.current = state.closePicker;
  const listId = useId();
  const active = state.active;
  const visible = state.profiles.filter((profile) => profile.name.toLowerCase().includes(query.trim().toLowerCase()));
  const previewText = state.runDisabled || !active
    ? 'No project profile will be added. Your prompt text is sent as written.'
    : state.preamble
      ? state.preamble
      : 'This profile has no instructions yet, so nothing extra is sent. Your prompt text is sent as written.';

  useEffect(() => {
    if (state.pickerOpen) searchRef.current?.focus();
  }, [state.pickerOpen]);

  useEffect(() => {
    if (!state.pickerOpen) return undefined;
    const onPointer = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) closePickerRef.current();
    };
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      closePickerRef.current();
      chipRef.current?.focus();
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [state.pickerOpen]);

  const choose = (id) => {
    state.select(id);
    setQuery('');
    chipRef.current?.focus();
  };

  return (
    <div className="pl-profile-anchor" ref={rootRef}>
      <button
        ref={chipRef}
        type="button"
        className="pl-profile-chip"
        data-testid="project-profile-chip"
        aria-haspopup="listbox"
        aria-expanded={state.pickerOpen}
        aria-controls={listId}
        aria-label={active ? `Project profile: ${active.name}` : 'Project profile: None'}
        onClick={() => state.setPickerOpen((open) => !open)}
      >
        <ProfileMark profile={active} />
        <span className="pl-profile-chip-name">{active ? active.name : 'No profile'}</span>
        {active?.example && <span className="pl-profile-example">Example</span>}
      </button>
      {state.pickerOpen && (
        <div
          className="pl-profile-menu"
          id={listId}
          role="listbox"
          aria-label="Project profiles"
          onKeyDown={(event) => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
            const options = [...event.currentTarget.querySelectorAll('[role="option"]')];
            if (!options.length) return;
            event.preventDefault();
            const index = options.indexOf(document.activeElement);
            const next = event.key === 'ArrowDown' ? index + 1 : index - 1;
            options[(next + options.length) % options.length]?.focus();
          }}
        >
          <label className="pl-profile-search">
            <span className="sr-only">Search project profiles</span>
            <input
              ref={searchRef}
              data-testid="project-profile-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search profiles"
            />
          </label>
          <button type="button" role="option" aria-selected={!active} onClick={() => choose('')}>None</button>
          {visible.map((profile) => (
            <button type="button" role="option" aria-selected={profile.id === active?.id} key={profile.id} onClick={() => choose(profile.id)}>
              <ProfileMark profile={profile} />
              <span>{profile.name}</span>
              {profile.example && <span className="pl-profile-example">Example</span>}
            </button>
          ))}
          {query.trim() && visible.length === 0 && <p className="pl-profile-empty">No profiles match that search.</p>}
          {suggestion && suggestion.id !== active?.id && (
            <button type="button" onClick={() => onUseSuggestion(suggestion.id)}>Use suggested profile {suggestion.name}</button>
          )}
          <button
            type="button"
            aria-pressed={state.previewOpen}
            onClick={() => { state.setPreviewOpen((open) => !open); state.closePicker(); }}
          >
            Preview what gets sent
          </button>
          <button type="button" onClick={() => state.openManager()}>Manage profiles</button>
        </div>
      )}
      {state.managerOpen && <ProjectProfilesManager state={state} onClose={state.closeManager} />}
      {state.previewOpen && createPortal(
        <SendPreview state={state} active={active} previewText={previewText} />,
        rootRef.current?.closest('header') || document.body,
      )}
    </div>
  );
}

function SendPreview({ state, active, previewText }) {
  return (
    <div className="pl-profile-preview" data-testid="project-profile-preview" role="region" aria-label="What gets sent">
      {active && (
        <label className="pl-profile-override">
          <input
            type="checkbox"
            checked={state.runDisabled}
            onChange={(event) => state.setRunDisabled(event.target.checked)}
          />
          Profile off for this run
        </label>
      )}
      {state.runDisabled || !active || !state.preamble
        ? <p>{previewText}</p>
        : (
          <>
            <p>Run, Enhance, and Rewrite send this as a system preamble. Your prompt text is not changed.</p>
            <pre>{state.preamble}</pre>
          </>
        )}
    </div>
  );
}
