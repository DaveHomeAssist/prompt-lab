import { useEffect, useRef, useState } from 'react';
import { decodeShare, extractVars, isGhostVar, resolveGhostVars, suggestTitleFromText } from '../promptUtils';
import { normalizeEntry } from '../lib/promptSchema.js';
import { normalizeError } from '../lib/errorTaxonomy.js';
import { useSessionRestore, useSessionSave } from './useSessionState.js';
import { ensureString } from '../lib/utils.js';
import { decodePackShare } from '../lib/packExport.js';
import { importPresetPack } from '../lib/presetImport.js';

/**
 * Save/share/load controller around the library + session storage boundaries.
 */
export default function usePersistenceFlow({ ui, lib, editor }) {
  const { notify, setTab, tab, setABVariant } = ui;
  const {
    raw, enhanced, variants, notes, enhMode,
    setRaw, setEnhanced, setVariants, setNotes, setEnhMode,
    setComposerBlocks,
  } = editor;

  const [showSave, setShowSave] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [saveTargetId, setSaveTargetId] = useState(null);
  const [saveSourceEntry, setSaveSourceEntry] = useState(null);
  const [saveTitle, setSaveTitle] = useState('');
  const [saveTags, setSaveTags] = useState([]);
  const [saveCollection, setSaveCollection] = useState('');
  const [changeNote, setChangeNote] = useState('');
  const [showDiff, setShowDiff] = useState(false);
  const [showNewColl, setShowNewColl] = useState(false);
  const [newCollName, setNewCollName] = useState('');
  const [varVals, setVarValsState] = useState({});
  const [showVarForm, setShowVarForm] = useState(false);
  const [pendingTemplate, setPendingTemplate] = useState(null);
  const [pendingTemplateTarget, setPendingTemplateTarget] = useState('editor');
  const templateLoadReqRef = useRef(0);
  const activeEntryRef = useRef(null);
  const varValsRef = useRef({});
  const sharedHashHandledRef = useRef(false);

  const setVarVals = (valueOrUpdater) => {
    const next = typeof valueOrUpdater === 'function'
      ? valueOrUpdater(varValsRef.current)
      : valueOrUpdater;
    const normalized = next && typeof next === 'object' ? next : {};
    varValsRef.current = normalized;
    setVarValsState(normalized);
  };

  useSessionRestore({ setRaw, setEnhanced, setVariants, setNotes, setTab, setEnhMode });
  useSessionSave({ raw, enhanced, variants, notes, tab, enhMode });

  useEffect(() => {
    if (sharedHashHandledRef.current) return;
    const hash = window.location.hash;
    if (hash.startsWith('#pack=')) {
      if (!lib.libReady) return;
      const pack = decodePackShare(hash.slice(6));
      if (!pack) {
        sharedHashHandledRef.current = true;
        notify('Shared pack is invalid.');
        return;
      }
      sharedHashHandledRef.current = true;
      void importPresetPack(pack, {
        load: async () => lib.library,
        save: async (library) => {
          lib.setLibrary(library);
          return true;
        },
      }).then((result) => {
        setTab('library');
        notify(`Shared pack loaded: ${result.imported.length} imported, ${result.skipped.length} skipped.`);
      }).catch(() => notify('Shared pack could not be imported.'));
      return;
    }
    if (!hash.startsWith('#share=')) return;
    sharedHashHandledRef.current = true;

    const decoded = decodeShare(hash.slice(7));
    const normalized = normalizeEntry({ ...decoded, id: crypto.randomUUID() });
    if (!normalized) {
      notify('Shared prompt is invalid.');
      return;
    }

    setRaw(normalized.original);
    setEnhanced(normalized.enhanced);
    setVariants(normalized.variants || []);
    setNotes(normalized.notes || '');
    setSaveTags(normalized.tags || []);
    setSaveTitle(normalized.title || '');
    setShowSave(true);
    notify('Shared prompt loaded!');
  }, [lib.libReady]);

  const copy = async (text, msg = 'Copied!') => {
    const value = ensureString(text);
    if (!value) {
      notify('Nothing to copy');
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      notify(msg);
    } catch (error) {
      try {
        const el = document.createElement('textarea');
        el.value = value;
        el.style.cssText = 'position:fixed;top:-9999px;opacity:0';
        document.body.appendChild(el);
        el.focus();
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
        notify(msg);
      } catch (fallbackError) {
        notify(normalizeError(fallbackError, 'clipboard').userMessage || 'Copy unavailable');
      }
    }
  };

  const resetTemplateFlow = () => {
    setVarVals({});
    setShowVarForm(false);
    setPendingTemplate(null);
    setPendingTemplateTarget('editor');
  };

  const closeSavePanel = () => {
    setShowSave(false);
    setSaveTargetId(null);
    setSaveSourceEntry(null);
    setChangeNote('');
    setShowNewColl(false);
    setNewCollName('');
  };

  const openSavePanel = (entry = null) => {
    const explicitEntry = entry ? normalizeEntry(entry) : null;
    const loadedEntry = editingId ? lib.library.find((item) => item.id === editingId) || null : null;
    const activeEntry = explicitEntry || loadedEntry || activeEntryRef.current;
    const source = activeEntry?.enhanced || enhanced || raw;
    setSaveTitle(activeEntry?.title || suggestTitleFromText(source));
    setSaveTargetId(activeEntry?.id || null);
    setSaveSourceEntry(explicitEntry);
    if (activeEntry) {
      setSaveTags(activeEntry.tags || []);
      setSaveCollection(activeEntry.collection || '');
    } else {
      setSaveTags([]);
      setSaveCollection('');
    }
    setChangeNote('');
    setShowNewColl(false);
    setNewCollName('');
    setShowSave(true);
  };

  const routeResolvedEntry = (entry, target = 'editor') => {
    const normalized = normalizeEntry(entry);
    if (!normalized) return;

    if (target === 'editor') {
      activeEntryRef.current = normalized;
      setEditingId(normalized.id);
      setRaw(normalized.original);
      setEnhanced(normalized.enhanced);
      setVariants(normalized.variants || []);
      setNotes(normalized.notes || '');
      setSaveTags(normalized.tags || []);
      setSaveTitle(normalized.title);
      setSaveCollection(normalized.collection || '');
      setShowSave(false);
      setSaveTargetId(null);
      setSaveSourceEntry(null);
      setShowDiff(false);
      if (typeof lib.bumpUse === 'function') {
        lib.bumpUse(normalized.id);
      }
      if (typeof lib.trackRecentAccess === 'function') {
        lib.trackRecentAccess(normalized.id);
      }
      setTab('editor');
      notify('Loaded into editor!');
      return;
    }

    if (target === 'ab:a' || target === 'ab:b') {
      const side = target.slice(-1);
      const promptText = normalized.enhanced || normalized.original;
      if (!promptText.trim() || typeof setABVariant !== 'function') return;
      setABVariant(side, promptText, { entryId: normalized.id, title: normalized.title });
      if (typeof lib.bumpUse === 'function') {
        lib.bumpUse(normalized.id);
      }
      if (typeof lib.trackRecentAccess === 'function') {
        lib.trackRecentAccess(normalized.id);
      }
      setTab('abtest');
      notify(`Loaded ${normalized.title || 'prompt'} into Variant ${side.toUpperCase()}`);
    }
  };

  const buildResolvedEntry = (entry, values) => {
    const normalized = normalizeEntry(entry);
    if (!normalized) return null;
    let text = ensureString(normalized.enhanced);
    Object.entries(values || {}).forEach(([key, value]) => {
      text = text.replaceAll(`{{${key}}}`, ensureString(value));
    });
    return { ...normalized, enhanced: text };
  };

  const applyEntry = (entry) => {
    routeResolvedEntry(entry, 'editor');
  };

  const applyTemplateWithVals = (entry, values, target = 'editor') => {
    const resolved = buildResolvedEntry(entry, values);
    if (!resolved) return;
    routeResolvedEntry(resolved, target);
  };

  const resolveEntryForTarget = async (entry, target = 'editor') => {
    const vars = extractVars(entry?.enhanced);
    if (vars.length === 0) {
      routeResolvedEntry(entry, target);
      return;
    }

    const reqId = templateLoadReqRef.current + 1;
    templateLoadReqRef.current = reqId;
    const ghostVars = vars.filter(isGhostVar);
    const manualVars = vars.filter((name) => !isGhostVar(name));
    const ghostVals = await resolveGhostVars(ghostVars);
    if (reqId !== templateLoadReqRef.current) return;

    if (manualVars.length === 0) {
      resetTemplateFlow();
      applyTemplateWithVals(entry, ghostVals, target);
      return;
    }

    setPendingTemplate(entry);
    setPendingTemplateTarget(target);
    setVarVals({
      ...Object.fromEntries(manualVars.map((name) => [name, ''])),
      ...ghostVals,
    });
    setShowVarForm(true);
  };

  const loadEntry = async (entry) => {
    await resolveEntryForTarget(entry, 'editor');
  };

  const deleteEntry = (entryId) => {
    if (typeof lib.del !== 'function' || !lib.del(entryId)) return false;
    if (editingId !== entryId) return true;

    // Preserve the visible draft so it can be saved as a new prompt, but never
    // leave a deleted record as the active save target.
    activeEntryRef.current = null;
    setEditingId(null);
    setSaveTargetId(current => current === entryId ? null : current);
    setSaveSourceEntry(current => current?.id === entryId ? null : current);
    setShowSave(false);
    setChangeNote('');
    return true;
  };

  const restoreEntryVersion = (entryId, version) => {
    if (typeof lib.restoreVersion !== 'function') return null;
    const restoredEntry = normalizeEntry(lib.restoreVersion(entryId, version));
    if (!restoredEntry || editingId !== restoredEntry.id) return restoredEntry;

    // Restoration already wrote the library record. Synchronize the loaded
    // editor without routing through the normal load path, which would bump
    // usage and emit an unrelated "Loaded" notification.
    activeEntryRef.current = restoredEntry;
    setEditingId(restoredEntry.id);
    setRaw(restoredEntry.original);
    setEnhanced(restoredEntry.enhanced);
    setVariants(restoredEntry.variants || []);
    setNotes(restoredEntry.notes || '');
    setSaveTitle(restoredEntry.title || '');
    setSaveTags(restoredEntry.tags || []);
    setSaveCollection(restoredEntry.collection || '');
    setSaveTargetId(null);
    setSaveSourceEntry(null);
    setChangeNote('');
    setShowSave(false);
    setShowDiff(false);
    return restoredEntry;
  };

  const sendEntryToABTest = async (entry, side) => {
    await resolveEntryForTarget(entry, `ab:${side}`);
  };

  const applyTemplate = () => {
    if (!pendingTemplate) return;
    applyTemplateWithVals(pendingTemplate, varValsRef.current, pendingTemplateTarget);
    resetTemplateFlow();
  };

  const skipTemplate = () => {
    if (!pendingTemplate) return;
    routeResolvedEntry(pendingTemplate, pendingTemplateTarget);
    resetTemplateFlow();
  };

  const doSave = (onSaved, overrides = {}) => {
    const contentSource = saveSourceEntry ? normalizeEntry(saveSourceEntry) : null;
    const targetId = Object.prototype.hasOwnProperty.call(overrides, 'targetId')
      ? overrides.targetId
      : (saveTargetId ?? editingId);
    const titleValue = Object.prototype.hasOwnProperty.call(overrides, 'titleOverride')
      ? overrides.titleOverride
      : saveTitle;
    const collectionValue = Object.prototype.hasOwnProperty.call(overrides, 'collectionOverride')
      ? overrides.collectionOverride
      : saveCollection;
    const saved = lib.doSave({
      raw: contentSource?.original ?? raw,
      enhanced: contentSource?.enhanced ?? enhanced,
      variants: contentSource?.variants ?? variants,
      notes: contentSource?.notes ?? notes,
      tags: saveTags,
      title: titleValue,
      collection: collectionValue,
      editingId: targetId,
      changeNote,
      sourceEntry: contentSource || activeEntryRef.current,
    });
    // A rejected write returns null; keep the save panel and buffers so the
    // user can retry or copy instead of losing the draft to a false success.
    if (!saved?.id) return saved;
    if (saved?.id) {
      activeEntryRef.current = {
        ...(contentSource || activeEntryRef.current || {}),
        id: saved.id,
        title: saved.title || titleValue,
        original: contentSource?.original ?? raw,
        enhanced: contentSource?.enhanced ?? enhanced,
        variants: contentSource?.variants ?? variants,
        notes: contentSource?.notes ?? notes,
        tags: saveTags,
        collection: collectionValue,
      };
      if (!contentSource) {
        setEditingId(saved.id);
      }
      setSaveTitle(saved.title || titleValue);
      if (typeof onSaved === 'function') onSaved(saved.id);
    }
    setSaveTargetId(null);
    setSaveSourceEntry(null);
    setChangeNote('');
    setShowSave(false);
    return saved;
  };

  const addToComposer = (entry) => {
    setComposerBlocks((prev) => [
      ...prev,
      { id: crypto.randomUUID(), label: entry.title, content: entry.enhanced, sourceId: entry.id },
    ]);
    if (typeof lib.bumpUse === 'function') {
      lib.bumpUse(entry.id);
    }
    if (typeof lib.trackRecentAccess === 'function') {
      lib.trackRecentAccess(entry.id);
    }
    notify('Added to Composer!');
  };

  const clearPersistenceState = () => {
    templateLoadReqRef.current += 1;
    activeEntryRef.current = null;
    setShowSave(false);
    setEditingId(null);
    setSaveTargetId(null);
    setSaveSourceEntry(null);
    setSaveTitle('');
    setSaveTags([]);
    setSaveCollection('');
    setChangeNote('');
    setShowDiff(false);
    setShowNewColl(false);
    setNewCollName('');
    resetTemplateFlow();
  };

  return {
    showSave, setShowSave,
    editingId, setEditingId,
    saveTargetId,
    hasPanelSaveSource: Boolean(saveSourceEntry),
    saveTitle, setSaveTitle,
    saveTags, setSaveTags,
    saveCollection, setSaveCollection,
    changeNote, setChangeNote,
    showDiff, setShowDiff,
    showNewColl, setShowNewColl,
    newCollName, setNewCollName,
    varVals, setVarVals,
    showVarForm, setShowVarForm,
    pendingTemplate,
    copy,
    closeSavePanel,
    openSavePanel,
    doSave,
    applyEntry,
    loadEntry,
    deleteEntry,
    restoreEntryVersion,
    sendEntryToABTest,
    applyTemplate,
    skipTemplate,
    addToComposer,
    clearPersistenceState,
  };
}
