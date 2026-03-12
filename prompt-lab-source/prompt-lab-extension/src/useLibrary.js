import { useState, useEffect } from 'react';
import {
  ensureString,
  suggestTitleFromText,
  normalizeEntry,
  normalizeLibrary,
  extractVars,
  looksSensitive,
  encodeShare,
} from './promptUtils';
import { DEFAULT_LIBRARY_SEEDS } from './constants';

export default function useLibrary(notify) {
  const [library, setLibrary] = useState([]);
  const [libReady, setLibReady] = useState(false);
  const [collections, setCollections] = useState([]);
  const [search, setSearch] = useState('');
  const [activeTag, setActiveTag] = useState(null);
  const [activeCollection, setActiveCollection] = useState(null);
  const [sortBy, setSortBy] = useState('newest');
  const [expandedId, setExpandedId] = useState(null);
  const [expandedVersionId, setExpandedVersionId] = useState(null);
  const [shareId, setShareId] = useState(null);
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [draggingLibraryId, setDraggingLibraryId] = useState(null);
  const [dragOverLibraryId, setDragOverLibraryId] = useState(null);

  // ── Init ──
  useEffect(() => {
    try {
      const l = localStorage.getItem('pl2-library');
      const hasStoredLibrary = Boolean(l);
      if (l) {
        setLibrary(normalizeLibrary(JSON.parse(l)));
      } else {
        setLibrary(normalizeLibrary(DEFAULT_LIBRARY_SEEDS));
      }
      const c = localStorage.getItem('pl2-collections');
      if (c) {
        const parsed = JSON.parse(c);
        setCollections(Array.isArray(parsed) ? parsed.filter(x => typeof x === 'string' && x.trim()) : []);
      } else if (!hasStoredLibrary) {
        setCollections(['Handoff Templates']);
      }
    } catch {}
    setLibReady(true);
  }, []);

  // ── Persist ──
  useEffect(() => {
    if (libReady) { try { localStorage.setItem('pl2-library', JSON.stringify(library)); } catch {} }
  }, [library, libReady]);
  useEffect(() => { try { localStorage.setItem('pl2-collections', JSON.stringify(collections)); } catch {} }, [collections]);

  // ── CRUD ──
  const doSave = ({ raw, enhanced, variants, notes, tags, title, collection, editingId }) => {
    const cleanTitle = ensureString(title).trim() || suggestTitleFromText(enhanced || raw);
    const normalizedTags = Array.isArray(tags) ? tags.filter(t => typeof t === 'string' && t.trim()) : [];
    const effectiveEnhanced = ensureString(enhanced).trim() ? ensureString(enhanced) : ensureString(raw);
    const now = new Date().toISOString();
    setLibrary(prev => {
      if (editingId) {
        let updated = false;
        const next = prev.map(e => {
          if (e.id !== editingId) return e;
          updated = true;
          return {
            ...e,
            title: cleanTitle,
            original: ensureString(raw),
            enhanced: effectiveEnhanced,
            variants: Array.isArray(variants) ? variants : [],
            notes: ensureString(notes),
            tags: normalizedTags,
            collection: ensureString(collection),
            versions: [...(e.versions || []), { enhanced: e.enhanced, variants: e.variants, savedAt: e.updatedAt || e.createdAt }].slice(-10),
            updatedAt: now,
          };
        });
        if (updated) return next;
      }
      return [{
        id: crypto.randomUUID(),
        title: cleanTitle,
        original: ensureString(raw),
        enhanced: effectiveEnhanced,
        variants: Array.isArray(variants) ? variants : [],
        notes: ensureString(notes),
        tags: normalizedTags,
        collection: ensureString(collection),
        createdAt: now,
        useCount: 0,
        versions: [],
      }, ...prev];
    });
    notify(editingId ? 'Prompt updated!' : 'Saved!');
  };

  const del = id => {
    if (!window.confirm('Delete this prompt?')) return;
    setLibrary(prev => prev.filter(e => e.id !== id));
    notify('Prompt deleted.');
  };

  const bumpUse = id => setLibrary(prev => prev.map(e => e.id === id ? { ...e, useCount: e.useCount + 1 } : e));

  const moveLibraryEntry = (sourceId, targetId) => {
    if (!sourceId || !targetId || sourceId === targetId) return;
    setLibrary(prev => {
      const from = prev.findIndex(e => e.id === sourceId);
      const to = prev.findIndex(e => e.id === targetId);
      if (from < 0 || to < 0 || from === to) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  const renameEntry = (id, nextTitle, editingId, setSaveTitle) => {
    const trimmed = nextTitle.trim();
    if (!trimmed) return;
    setLibrary(prev => prev.map(e => e.id === id ? { ...e, title: trimmed } : e));
    if (editingId === id && setSaveTitle) setSaveTitle(trimmed);
    setRenamingId(null);
    setRenameValue('');
    notify('Renamed.');
  };

  const restoreVersion = (entryId, version) => {
    setLibrary(prev => prev.map(e => e.id === entryId ? { ...e, enhanced: version.enhanced, variants: version.variants || [] } : e));
    notify('Restored!');
  };

  // ── Export / Import ──
  const exportLib = () => {
    if (library.length === 0) { notify('Library is empty.'); return; }
    if (library.some(e => looksSensitive(e.original) || looksSensitive(e.enhanced) || looksSensitive(e.notes))
      && !window.confirm('Export may include sensitive prompt content. Continue?')) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(library, null, 2)], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'prompt-library.json' });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const importLib = e => {
    const file = e.target.files[0]; if (!file) return;
    if (file.size > 2 * 1024 * 1024) { notify('Import failed: file is too large.'); e.target.value = ''; return; }
    const r = new FileReader();
    r.onload = ev => {
      try {
        const d = JSON.parse(ev.target.result);
        const normalized = normalizeLibrary(d);
        if (!normalized.length) { notify('Import failed: no valid prompts found.'); return; }
        setLibrary(prev => normalizeLibrary([...normalized, ...prev]));
        notify(`Imported ${normalized.length} prompts!`);
      }
      catch { notify('Import failed'); }
    };
    r.readAsText(file); e.target.value = '';
  };

  const getShareUrl = entry => {
    if (!entry) return null;
    const c = encodeShare(entry);
    return c ? `${window.location.origin}${window.location.pathname}#share=${c}` : null;
  };

  // ── Derived ──
  const allLibTags = [...new Set(library.flatMap(e => e.tags || []))];
  const filtered = [...library]
    .filter(e => {
      const q = search.toLowerCase();
      const title = ensureString(e.title).toLowerCase();
      return (!q || title.includes(q) || (e.tags || []).some(t => t.toLowerCase().includes(q)))
        && (!activeTag || (e.tags || []).includes(activeTag))
        && (!activeCollection || e.collection === activeCollection);
    })
    .sort((a, b) => {
      if (sortBy === 'manual') return 0;
      if (sortBy === 'oldest') return new Date(a.createdAt) - new Date(b.createdAt);
      if (sortBy === 'most-used') return b.useCount - a.useCount;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
  const quickInject = [...library].sort((a, b) => b.useCount - a.useCount).slice(0, 5);

  return {
    library, setLibrary, libReady, collections, setCollections,
    search, setSearch, activeTag, setActiveTag, activeCollection, setActiveCollection,
    sortBy, setSortBy, expandedId, setExpandedId, expandedVersionId, setExpandedVersionId,
    shareId, setShareId, renamingId, setRenamingId, renameValue, setRenameValue,
    draggingLibraryId, setDraggingLibraryId, dragOverLibraryId, setDragOverLibraryId,
    doSave, del, bumpUse, moveLibraryEntry, renameEntry, restoreVersion,
    exportLib, importLib, getShareUrl,
    allLibTags, filtered, quickInject,
  };
}
