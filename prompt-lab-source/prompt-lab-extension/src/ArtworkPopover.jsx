import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArtworkControls } from './ArtworkPicker.jsx';
import { safeArtwork } from './lib/libraryPresentation.js';

export default function ArtworkPopover({ entry, trigger, onSave, onClose }) {
  const dialogRef = useRef(null);
  const [draft, setDraft] = useState(() => safeArtwork(entry.metadata?.artwork));
  const [ready, setReady] = useState(true);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState('');
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    dialog.showModal();
    const place = () => {
      const rect = trigger.getBoundingClientRect();
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - dialog.offsetWidth - 8));
      const top = Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - dialog.offsetHeight - 8));
      dialog.style.left = `${left}px`; dialog.style.top = `${top}px`;
    };
    place();
    const observer = new ResizeObserver(place); observer.observe(dialog);
    window.addEventListener('resize', place);
    return () => { observer.disconnect(); window.removeEventListener('resize', place); dialog.close(); trigger?.isConnected && trigger.focus(); };
  }, [trigger]);
  const apply = async () => {
    if (savingRef.current || !ready) return;
    savingRef.current = true; setSaving(true); setError('');
    try {
      const saved = await onSave(entry.id, draft);
      if (saved !== true) throw new Error('Artwork was not saved. Your choice is kept here. Try Apply again.');
      onClose();
    } catch (failure) { setError(failure.message || 'Artwork was not saved. Try Apply again.'); }
    finally { savingRef.current = false; setSaving(false); }
  };
  return createPortal(<dialog ref={dialogRef} className="pl-artwork-popover" aria-label={`Artwork for ${entry.title}`} onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); if (!savingRef.current) onClose(); } }} onCancel={event => { event.preventDefault(); if (!savingRef.current) onClose(); }}>
    <header><strong>Prompt artwork</strong><span>{entry.title}</span></header>
    <ArtworkControls value={draft} onChange={setDraft} onReadyChange={setReady} disabled={saving} label="Prompt artwork" />
    {error && <p role="alert">{error}</p>}
    <footer><button type="button" disabled={saving} onClick={onClose}>Cancel</button><button type="button" disabled={saving || !ready} onClick={apply}>{saving ? 'Saving…' : 'Apply'}</button></footer>
  </dialog>, trigger.closest('.pl-app-shell') || document.body);
}
