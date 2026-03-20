import { useEffect, useRef, useState } from 'react';
import Ic from './icons';
import ReferencePane from './ReferencePane';
import { logWarn } from './lib/logger.js';
import { matchPadShortcut } from './lib/padShortcuts.js';
import { storageKeys } from './lib/storage.js';
import { buildPromptLabDraftUrl, hasPromptLabDraftOverflow } from './lib/promptLabBridge.js';

const LEGACY_PAD_KEY = storageKeys.pad;
const LEGACY_PAD_META_KEY = `${storageKeys.pad}_meta`;
const PADS_KEY = 'pl2-pads';
const PADS_SCHEMA_VERSION_KEY = 'pl2-pads-schema-version';
const PADS_SCHEMA_VERSION = '3';

const DEFAULT_PAD_ID = 'default';
const DEFAULT_PAD_NAME = 'Scratchpad';
const DEFAULT_PROJECT = 'general';
const PROMPT_LAB_PROJECT_NAME = 'Prompt Lab';
const PROMPT_LAB_PROJECT_SAFE_NAME = 'Prompt Lab Project';

const STATUS_META = Object.freeze({
  draft: {
    label: 'Draft',
    chip: 'border border-slate-500/30 bg-slate-500/10 text-slate-200',
  },
  in_test: {
    label: 'In Test',
    chip: 'border border-amber-400/30 bg-amber-500/15 text-amber-200',
  },
  archived: {
    label: 'Archived',
    chip: 'border border-zinc-500/30 bg-zinc-500/10 text-zinc-300',
  },
});

function nowIso() {
  return new Date().toISOString();
}

function parseEntryTimestamp(value) {
  const parsed = new Date(value || '').getTime();
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

function parseSavedTimestamp(raw) {
  if (!raw) return Date.now();
  const iso = new Date(raw).getTime();
  if (!Number.isNaN(iso)) return iso;
  return Date.now();
}

function buildEntryId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function slugifyProject(value) {
  const normalized = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || DEFAULT_PROJECT;
}

function normalizePadName(value, fallback = DEFAULT_PAD_NAME) {
  const trimmed = (value || '').trim() || fallback;
  if (trimmed.toLowerCase() === PROMPT_LAB_PROJECT_NAME.toLowerCase()) {
    return PROMPT_LAB_PROJECT_SAFE_NAME;
  }
  return trimmed;
}

function normalizeStatus(value) {
  const normalized = (value || '').toString().trim().toLowerCase().replace(/\s+/g, '_');
  if (normalized === 'in_test' || normalized === 'draft' || normalized === 'archived') return normalized;
  return 'draft';
}

function deriveEntryTitle(body, fallback = 'Untitled prompt') {
  const firstLine = (body || '')
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return fallback;
  return firstLine.replace(/^#+\s*/, '').slice(0, 72);
}

function buildPromptEntry({
  title = '',
  body = '',
  status = 'draft',
  updatedAt = nowIso(),
  project = DEFAULT_PROJECT,
  lastSentAt = '',
  promptLabLink = '',
} = {}) {
  const safeBody = typeof body === 'string' ? body : '';
  const safeUpdatedAt = typeof updatedAt === 'string' ? updatedAt : new Date(updatedAt).toISOString();
  return {
    id: buildEntryId(),
    title: (title || '').trim() || deriveEntryTitle(safeBody),
    body: safeBody,
    status: normalizeStatus(status),
    updatedAt: safeUpdatedAt,
    project: (project || '').trim() || DEFAULT_PROJECT,
    lastSentAt: lastSentAt || '',
    promptLabLink: promptLabLink || '',
  };
}

function normalizePromptEntry(entry, fallbackProject = DEFAULT_PROJECT, fallbackUpdatedAt = nowIso()) {
  const safeEntry = entry && typeof entry === 'object' ? entry : {};
  return {
    id: typeof safeEntry.id === 'string' && safeEntry.id ? safeEntry.id : buildEntryId(),
    title: typeof safeEntry.title === 'string' && safeEntry.title.trim()
      ? safeEntry.title.trim()
      : deriveEntryTitle(typeof safeEntry.body === 'string' ? safeEntry.body : ''),
    body: typeof safeEntry.body === 'string' ? safeEntry.body : '',
    status: normalizeStatus(safeEntry.status),
    updatedAt: typeof safeEntry.updatedAt === 'string' && safeEntry.updatedAt
      ? safeEntry.updatedAt
      : fallbackUpdatedAt,
    project: typeof safeEntry.project === 'string' && safeEntry.project.trim()
      ? safeEntry.project.trim()
      : fallbackProject,
    lastSentAt: typeof safeEntry.lastSentAt === 'string' ? safeEntry.lastSentAt : '',
    promptLabLink: typeof safeEntry.promptLabLink === 'string' ? safeEntry.promptLabLink : '',
  };
}

function getPadTimestamp(pad) {
  if (!pad?.entries?.length) return Date.now();
  return Math.max(...pad.entries.map((entry) => parseEntryTimestamp(entry.updatedAt)));
}

function normalizePad(pad) {
  const normalizedName = normalizePadName(pad?.name);
  const defaultProject = normalizedName === DEFAULT_PAD_NAME ? DEFAULT_PROJECT : slugifyProject(normalizedName);
  const entries = Array.isArray(pad?.entries) && pad.entries.length > 0
    ? pad.entries.map((entry) => normalizePromptEntry(entry, defaultProject))
    : [buildPromptEntry({ project: defaultProject })];

  return {
    id: typeof pad?.id === 'string' && pad.id ? pad.id : buildEntryId(),
    name: normalizedName,
    entries,
    timestamp: getPadTimestamp({ entries }),
  };
}

function buildDefaultPadsPayload(content = '', timestamp = Date.now()) {
  const updatedAt = new Date(timestamp).toISOString();
  const defaultEntry = buildPromptEntry({
    title: content.trim() ? deriveEntryTitle(content) : 'Untitled prompt',
    body: content,
    updatedAt,
    project: DEFAULT_PROJECT,
  });

  return {
    pads: [
      {
        id: DEFAULT_PAD_ID,
        name: DEFAULT_PAD_NAME,
        entries: [defaultEntry],
        timestamp,
      },
    ],
    activePadId: DEFAULT_PAD_ID,
  };
}

function isValidPadsPayload(value) {
  return Boolean(
    value &&
    Array.isArray(value.pads) &&
    value.pads.length > 0 &&
    typeof value.activePadId === 'string' &&
    value.pads.every((pad) =>
      pad &&
      typeof pad.id === 'string' &&
      typeof pad.name === 'string' &&
      Array.isArray(pad.entries) &&
      pad.entries.length > 0 &&
      pad.entries.every((entry) =>
        entry &&
        typeof entry.id === 'string' &&
        typeof entry.title === 'string' &&
        typeof entry.body === 'string' &&
        typeof entry.status === 'string' &&
        typeof entry.updatedAt === 'string' &&
        typeof entry.project === 'string' &&
        typeof entry.lastSentAt === 'string' &&
        typeof entry.promptLabLink === 'string'
      )
    )
  );
}

function readRawPadsPayload() {
  try {
    const raw = localStorage.getItem(PADS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (error) {
    logWarn('read raw pads payload', error);
    return null;
  }
}

function readPadsPayload() {
  const raw = readRawPadsPayload();
  return isValidPadsPayload(raw) ? raw : null;
}

function migrateV2PayloadToV3(payload) {
  if (!payload || !Array.isArray(payload.pads)) return null;
  const nextPads = payload.pads.map((pad) => {
    const normalizedName = normalizePadName(pad?.name);
    const defaultProject = normalizedName === DEFAULT_PAD_NAME ? DEFAULT_PROJECT : slugifyProject(normalizedName);
    const updatedAt = new Date(parseSavedTimestamp(pad?.timestamp)).toISOString();
    const entry = buildPromptEntry({
      title: deriveEntryTitle(pad?.content || '', normalizedName === DEFAULT_PAD_NAME ? 'Untitled prompt' : normalizedName),
      body: typeof pad?.content === 'string' ? pad.content : '',
      updatedAt,
      project: defaultProject,
    });

    return {
      id: typeof pad?.id === 'string' && pad.id ? pad.id : buildEntryId(),
      name: normalizedName,
      entries: [entry],
      timestamp: parseEntryTimestamp(updatedAt),
    };
  });

  return {
    pads: nextPads.length > 0 ? nextPads : buildDefaultPadsPayload().pads,
    activePadId: typeof payload.activePadId === 'string' && nextPads.some((pad) => pad.id === payload.activePadId)
      ? payload.activePadId
      : nextPads[0]?.id || DEFAULT_PAD_ID,
  };
}

function migratePadStorage() {
  try {
    const version = localStorage.getItem(PADS_SCHEMA_VERSION_KEY);

    if (version === PADS_SCHEMA_VERSION) {
      const existing = readPadsPayload();
      if (existing) {
        return { migrated: false, payload: existing, error: null };
      }
    }

    const rawPayload = readRawPadsPayload();
    if (rawPayload && Array.isArray(rawPayload.pads) && rawPayload.pads.every((pad) => Array.isArray(pad.entries))) {
      const normalized = {
        pads: rawPayload.pads.map(normalizePad),
        activePadId: typeof rawPayload.activePadId === 'string' ? rawPayload.activePadId : DEFAULT_PAD_ID,
      };
      localStorage.setItem(PADS_KEY, JSON.stringify(normalized));
      localStorage.setItem(PADS_SCHEMA_VERSION_KEY, PADS_SCHEMA_VERSION);
      return { migrated: true, payload: normalized, error: null };
    }

    if (rawPayload && Array.isArray(rawPayload.pads)) {
      const migratedPayload = migrateV2PayloadToV3(rawPayload);
      if (migratedPayload) {
        localStorage.setItem(PADS_KEY, JSON.stringify(migratedPayload));
        localStorage.setItem(PADS_SCHEMA_VERSION_KEY, PADS_SCHEMA_VERSION);
        return { migrated: true, payload: migratedPayload, error: null };
      }
    }

    let legacyContent = localStorage.getItem(LEGACY_PAD_KEY) || '';
    let legacyMeta = localStorage.getItem(LEGACY_PAD_META_KEY) || '';

    if (!legacyContent) {
      const prePl2 = localStorage.getItem('pl-pad');
      if (prePl2) {
        legacyContent = prePl2;
        legacyMeta = localStorage.getItem('pl-pad_meta') || '';
      }
    }

    const payload = buildDefaultPadsPayload(
      legacyContent,
      parseSavedTimestamp(legacyMeta)
    );

    localStorage.setItem(PADS_KEY, JSON.stringify(payload));
    localStorage.setItem(PADS_SCHEMA_VERSION_KEY, PADS_SCHEMA_VERSION);
    localStorage.removeItem(LEGACY_PAD_KEY);
    localStorage.removeItem(LEGACY_PAD_META_KEY);
    localStorage.removeItem('pl-pad');
    localStorage.removeItem('pl-pad_meta');

    return { migrated: true, payload, error: null };
  } catch (error) {
    logWarn('pad schema migration', error);
    return {
      migrated: false,
      payload: buildDefaultPadsPayload(
        localStorage.getItem(LEGACY_PAD_KEY) || '',
        parseSavedTimestamp(localStorage.getItem(LEGACY_PAD_META_KEY) || '')
      ),
      error,
    };
  }
}

function persistPadsState(nextState) {
  try {
    localStorage.setItem(PADS_KEY, JSON.stringify(nextState));
    localStorage.setItem(PADS_SCHEMA_VERSION_KEY, PADS_SCHEMA_VERSION);
  } catch (error) {
    console.warn('[PadTab] persistPadsState failed (quota exceeded?)', error);
  }
}

function buildProjectExportText(pad) {
  return pad.entries.map((entry) => {
    const statusLabel = STATUS_META[entry.status]?.label || 'Draft';
    const lines = [
      `# ${entry.title || 'Untitled prompt'}`,
      `Status: ${statusLabel}`,
      `Project: ${entry.project || DEFAULT_PROJECT}`,
      `Updated: ${entry.updatedAt}`,
    ];
    if (entry.lastSentAt) {
      lines.push(`Last sent: ${entry.lastSentAt}`);
    }
    lines.push('');
    lines.push(entry.body || '');
    return lines.join('\n');
  }).join('\n\n---\n\n');
}

async function copyText(text) {
  if (navigator?.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const el = document.createElement('textarea');
  el.value = text;
  el.style.cssText = 'position:fixed;top:-9999px;opacity:0';
  document.body.appendChild(el);
  el.focus();
  el.select();
  document.execCommand('copy');
  document.body.removeChild(el);
}

export default function PadTab({ m, notify, pageScroll = false, compact = false }) {
  const migrationCheckedRef = useRef(false);
  const textareaRefs = useRef({});
  const savedStateTimerRef = useRef(null);

  const [padsState, setPadsState] = useState(() => {
    const payload = readPadsPayload();
    return payload || buildDefaultPadsPayload('', Date.now());
  });
  const [activeEntryId, setActiveEntryId] = useState(() => {
    const payload = readPadsPayload() || buildDefaultPadsPayload('', Date.now());
    const activePad = payload.pads.find((pad) => pad.id === payload.activePadId) || payload.pads[0];
    return activePad?.entries?.[0]?.id || '';
  });
  const [selectionState, setSelectionState] = useState({ entryId: '', text: '' });
  const [saveState, setSaveState] = useState('idle');
  const [saveError, setSaveError] = useState('');
  const [lastSavedAt, setLastSavedAt] = useState(() => {
    const payload = readPadsPayload() || buildDefaultPadsPayload('', Date.now());
    const activePad = payload.pads.find((pad) => pad.id === payload.activePadId) || payload.pads[0];
    return activePad?.timestamp ? new Date(activePad.timestamp).toISOString() : '';
  });
  const [relativeSavedAt, setRelativeSavedAt] = useState('');
  const [refPane, setRefPane] = useState({ open: false, entryId: '', mode: 'entry' });

  const shellMinHeightClass = pageScroll ? 'min-h-[calc(100vh-9rem)]' : 'min-h-[calc(100vh-7rem)]';
  const editorPaneMinHeightClass = pageScroll ? 'min-h-[calc(100vh-13rem)]' : 'min-h-[calc(100vh-11rem)]';
  const copyBtnClass = m.text?.includes('gray-100')
    ? 'border border-violet-400/30 bg-violet-500/15 text-violet-200 hover:border-violet-300 hover:bg-violet-500/25'
    : 'border border-violet-300 bg-violet-50 text-violet-700 hover:border-violet-400 hover:bg-violet-100';

  const activePad = padsState.pads.find((pad) => pad.id === padsState.activePadId) || padsState.pads[0];
  const activeEntry = activePad?.entries.find((entry) => entry.id === activeEntryId) || activePad?.entries[0] || null;
  const promptCount = activePad?.entries.length || 0;

  const formatRelativeTime = (value) => {
    if (!value) return '';
    const diffMs = Date.now() - new Date(value).getTime();
    if (Number.isNaN(diffMs) || diffMs < 0) return 'just now';
    const seconds = Math.floor(diffMs / 1000);
    if (seconds < 10) return 'just now';
    if (seconds < 60) return `${seconds} sec ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hr ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? '' : 's'} ago`;
  };

  const markSaved = (value) => {
    const savedAt = value || nowIso();
    setLastSavedAt(savedAt);
    setRelativeSavedAt(formatRelativeTime(savedAt));
    setSaveError('');
    setSaveState('saved');
    clearTimeout(savedStateTimerRef.current);
    savedStateTimerRef.current = setTimeout(() => setSaveState('idle'), 1800);
  };

  const applyPadsState = (nextState, { silent = false, notice = '' } = {}) => {
    persistPadsState(nextState);
    setPadsState(nextState);
    const nextActivePad = nextState.pads.find((pad) => pad.id === nextState.activePadId) || nextState.pads[0];
    const savedAt = nextActivePad?.timestamp ? new Date(nextActivePad.timestamp).toISOString() : nowIso();
    if (!silent) markSaved(savedAt);
    if (notice) notify?.(notice);
  };

  const updatePad = (padId, updater, options = {}) => {
    const nextState = {
      ...padsState,
      pads: padsState.pads.map((pad) => {
        if (pad.id !== padId) return pad;
        const updatedPad = normalizePad(updater(pad));
        return updatedPad;
      }),
    };
    applyPadsState(nextState, options);
    return nextState;
  };

  const updateEntry = (entryId, updater, options = {}) => {
    const nextState = {
      ...padsState,
      pads: padsState.pads.map((pad) => {
        if (!pad.entries.some((entry) => entry.id === entryId)) return pad;
        const nextEntries = pad.entries.map((entry) => (
          entry.id === entryId ? normalizePromptEntry(updater(entry), entry.project, nowIso()) : entry
        ));
        return normalizePad({ ...pad, entries: nextEntries });
      }),
    };
    applyPadsState(nextState, options);
    return nextState;
  };

  useEffect(() => {
    if (migrationCheckedRef.current) return;
    migrationCheckedRef.current = true;

    const { payload, error, migrated } = migratePadStorage();
    setPadsState(payload);
    const migratedActivePad = payload.pads.find((pad) => pad.id === payload.activePadId) || payload.pads[0];
    setActiveEntryId(migratedActivePad?.entries?.[0]?.id || '');
    if (migratedActivePad?.timestamp) {
      const savedAt = new Date(migratedActivePad.timestamp).toISOString();
      setLastSavedAt(savedAt);
      setRelativeSavedAt(formatRelativeTime(savedAt));
    }

    if (error) {
      notify?.('Prompt notes migration failed; using fallback data');
      return;
    }

    if (migrated) {
      notify?.('Notebook migrated to structured prompt cards');
    }
  }, [notify]);

  useEffect(() => {
    if (!activePad?.entries.some((entry) => entry.id === activeEntryId)) {
      setActiveEntryId(activePad?.entries?.[0]?.id || '');
    }
  }, [activeEntryId, activePad]);

  useEffect(() => {
    if (!lastSavedAt) {
      setRelativeSavedAt('');
      return undefined;
    }
    const update = () => setRelativeSavedAt(formatRelativeTime(lastSavedAt));
    update();
    const intervalId = setInterval(update, 30000);
    return () => clearInterval(intervalId);
  }, [lastSavedAt]);

  useEffect(() => () => clearTimeout(savedStateTimerRef.current), []);

  const handleSelectionChange = (entryId, event) => {
    const { selectionStart, selectionEnd, value } = event.target;
    const selected = value.slice(selectionStart, selectionEnd).trim();
    setActiveEntryId(entryId);
    if (!selected) {
      setSelectionState((prev) => (prev.entryId === entryId ? { entryId: '', text: '' } : prev));
      return;
    }
    setSelectionState({ entryId, text: selected });
  };

  const handleSelectPad = (padId) => {
    if (padId === padsState.activePadId) return;
    const nextState = {
      ...padsState,
      activePadId: padId,
    };
    persistPadsState(nextState);
    setPadsState(nextState);
    const nextPad = nextState.pads.find((pad) => pad.id === padId) || nextState.pads[0];
    setActiveEntryId(nextPad?.entries?.[0]?.id || '');
    setSelectionState({ entryId: '', text: '' });
    const savedAt = nextPad?.timestamp ? new Date(nextPad.timestamp).toISOString() : '';
    setLastSavedAt(savedAt);
    setRelativeSavedAt(savedAt ? formatRelativeTime(savedAt) : '');
    setSaveState('idle');
    setSaveError('');
  };

  const handleCreatePad = () => {
    const suggestedName = `Project ${padsState.pads.length + 1}`;
    const requestedName = window.prompt('Name the new project tab:', suggestedName);
    if (requestedName === null) return;
    const name = normalizePadName(requestedName, suggestedName);
    const defaultProject = slugifyProject(name);
    const newPad = normalizePad({
      id: buildEntryId(),
      name,
      entries: [buildPromptEntry({ project: defaultProject })],
    });
    const nextState = {
      pads: [...padsState.pads, newPad],
      activePadId: newPad.id,
    };
    applyPadsState(nextState, { notice: `Created project: ${name}` });
    setActiveEntryId(newPad.entries[0].id);
    setSelectionState({ entryId: '', text: '' });
  };

  const handleRenamePad = () => {
    if (!activePad) return;
    const requestedName = window.prompt('Rename project tab:', activePad.name);
    if (requestedName === null) return;
    const name = normalizePadName(requestedName, activePad.name);
    if (!name || name === activePad.name) return;
    updatePad(activePad.id, (pad) => ({ ...pad, name }), { notice: `Renamed project: ${name}` });
  };

  const handleDeletePad = () => {
    if (!activePad || padsState.pads.length <= 1) return;
    if (!window.confirm(`Delete project "${activePad.name}" and all its prompt cards?`)) return;

    const currentIndex = padsState.pads.findIndex((pad) => pad.id === activePad.id);
    const remainingPads = padsState.pads.filter((pad) => pad.id !== activePad.id);
    const fallbackPad = remainingPads[Math.max(0, currentIndex - 1)] || remainingPads[0];
    const nextState = {
      pads: remainingPads,
      activePadId: fallbackPad.id,
    };
    applyPadsState(nextState, { notice: `Deleted project: ${activePad.name}` });
    setActiveEntryId(fallbackPad?.entries?.[0]?.id || '');
    setSelectionState({ entryId: '', text: '' });
  };

  const handleAddEntry = () => {
    if (!activePad) return;
    const nextEntry = buildPromptEntry({
      project: activeEntry?.project || slugifyProject(activePad.name),
    });
    const nextState = updatePad(activePad.id, (pad) => ({
      ...pad,
      entries: [nextEntry, ...pad.entries],
    }), { notice: 'Added prompt card' });
    const nextPad = nextState.pads.find((pad) => pad.id === activePad.id) || nextState.pads[0];
    setActiveEntryId(nextPad?.entries?.[0]?.id || nextEntry.id);
    setSelectionState({ entryId: '', text: '' });
    setTimeout(() => textareaRefs.current[nextEntry.id]?.focus(), 0);
  };

  const handleEntryFieldChange = (entryId, field, value) => {
    const nextUpdatedAt = nowIso();
    updateEntry(entryId, (entry) => ({
      ...entry,
      [field]: value,
      title: field === 'title' ? value : entry.title,
      body: field === 'body' ? value : entry.body,
      project: field === 'project' ? value : entry.project,
      updatedAt: nextUpdatedAt,
    }), { silent: true });
    markSaved(nextUpdatedAt);
  };

  const handleEntryStatus = (entryId, status) => {
    updateEntry(entryId, (entry) => ({
      ...entry,
      status: normalizeStatus(status),
      updatedAt: nowIso(),
    }), {
      notice: status === 'archived'
        ? 'Prompt archived'
        : status === 'in_test'
          ? 'Prompt marked In Test'
          : 'Prompt restored to Draft',
    });
  };

  const handleClearEntryBody = (entry) => {
    if (!entry.body.trim()) return;
    if (!window.confirm(`Clear the body for "${entry.title}"?`)) return;
    updateEntry(entry.id, (current) => ({
      ...current,
      body: '',
      updatedAt: nowIso(),
    }), { notice: 'Prompt body cleared' });
    if (selectionState.entryId === entry.id) {
      setSelectionState({ entryId: '', text: '' });
    }
    textareaRefs.current[entry.id]?.focus();
  };

  const handleCopyEntry = async (entry) => {
    if (!entry.body.trim()) return;
    try {
      await copyText(entry.body);
      notify('Prompt copied');
    } catch (error) {
      logWarn('copy prompt entry', error);
      notify('Copy unavailable');
    }
  };

  const handleCopyProject = async () => {
    if (!activePad) return;
    try {
      await copyText(buildProjectExportText(activePad));
      notify('Project copied');
    } catch (error) {
      logWarn('copy project export', error);
      notify('Copy unavailable');
    }
  };

  const exportProject = () => {
    if (!activePad) return;
    const filename = `${slugifyProject(activePad.name)}-prompts.txt`;
    const blob = new Blob([buildProjectExportText(activePad)], { type: 'text/plain;charset=utf-8' });
    try {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      setTimeout(() => URL.revokeObjectURL(url), 0);
      notify('Project downloaded');
    } catch (error) {
      logWarn('project download', error);
      notify('Download unavailable');
    }
  };

  const openPromptLabForDraft = async ({ entry, draft, title, source }) => {
    const cleanDraft = (draft || '').trim();
    if (!cleanDraft) return;

    const basePayload = {
      draft: cleanDraft,
      title: (title || '').trim(),
      source,
      tab: 'editor',
    };

    let launchUrl = buildPromptLabDraftUrl(basePayload);
    let clipboardFallback = false;
    let clipboardReady = false;

    if (hasPromptLabDraftOverflow(basePayload)) {
      clipboardFallback = true;
      try {
        await copyText(cleanDraft);
        clipboardReady = true;
      } catch (error) {
        logWarn('prompt lab clipboard fallback', error);
        notify('Draft is too large for a direct handoff URL, and clipboard copy failed.');
        return;
      }
      launchUrl = buildPromptLabDraftUrl({
        title: basePayload.title,
        source: basePayload.source,
        tab: basePayload.tab,
        clipboard: true,
      });
    }

    const opened = window.open(launchUrl, '_blank', 'noopener,noreferrer');
    if (!opened) {
      window.location.assign(launchUrl);
    }

    if (entry) {
      updateEntry(entry.id, (current) => ({
        ...current,
        lastSentAt: nowIso(),
        promptLabLink: launchUrl,
      }), { silent: true });
      markSaved(nowIso());
    }

    notify(
      clipboardFallback && clipboardReady
        ? 'Draft copied to clipboard and opened in Prompt Lab.'
        : 'Opened in Prompt Lab.'
    );
  };

  const handleSendEntryToPromptLab = async (entry) => {
    await openPromptLabForDraft({
      entry,
      draft: entry.body,
      title: entry.title,
      source: `notebook:${activePad?.name || DEFAULT_PAD_NAME}`,
    });
  };

  const handleSendSelectedToPromptLab = async () => {
    if (!selectionState.text) return;
    const sourceEntry = activePad?.entries.find((entry) => entry.id === selectionState.entryId) || activeEntry;
    await openPromptLabForDraft({
      entry: sourceEntry,
      draft: selectionState.text,
      title: sourceEntry?.title || 'Selected prompt draft',
      source: `notebook-selection:${activePad?.name || DEFAULT_PAD_NAME}`,
    });
  };

  const insertDate = () => {
    if (!activeEntryId) return;
    const target = textareaRefs.current[activeEntryId];
    const dateStamp = `\n\n── ${new Date().toLocaleDateString(undefined, {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })} ──\n`;

    if (!target) {
      handleEntryFieldChange(activeEntryId, 'body', `${activeEntry?.body || ''}${dateStamp}`);
      notify('Date separator inserted');
      return;
    }

    const entry = activePad.entries.find((item) => item.id === activeEntryId);
    if (!entry) return;
    const start = target.selectionStart ?? entry.body.length;
    const end = target.selectionEnd ?? entry.body.length;
    const nextBody = `${entry.body.slice(0, start)}${dateStamp}${entry.body.slice(end)}`;
    handleEntryFieldChange(activeEntryId, 'body', nextBody);
    setTimeout(() => {
      const nextCursor = start + dateStamp.length;
      target.selectionStart = nextCursor;
      target.selectionEnd = nextCursor;
      target.focus();
    }, 0);
    notify('Date separator inserted');
  };

  const handleClearShortcut = () => {
    if (!activeEntry) return;
    handleClearEntryBody(activeEntry);
  };

  const handleCopyAll = () => {
    handleCopyProject();
  };

  useEffect(() => {
    const onKeyDown = (event) => {
      const shortcut = matchPadShortcut(event);
      if (!shortcut) return;
      event.preventDefault();
      switch (shortcut.id) {
        case 'export':
          exportProject();
          return;
        case 'insertDate':
          insertDate();
          return;
        case 'copyAll':
          handleCopyAll();
          return;
        case 'clear':
          handleClearShortcut();
          return;
        case 'toggleRef':
          setRefPane(prev => ({ ...prev, open: !prev.open, entryId: prev.entryId || activeEntryId }));
          return;
        default:
          return;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeEntry, activeEntryId, activePad, selectionState]);

  return (
    <div className={`${shellMinHeightClass} flex ${pageScroll ? '' : 'flex-1 overflow-hidden'}`}>
      <div className={`w-[220px] shrink-0 flex flex-col border-r ${m.border} ${pageScroll ? '' : 'overflow-hidden'}`}>
        <div className={`flex items-center justify-between px-3 py-2 border-b ${m.border} shrink-0`}>
          <span className={`text-xs font-semibold ${m.text}`}>Projects</span>
          <button
            type="button"
            onClick={handleCreatePad}
            className={`flex items-center gap-1 text-xs ${m.btn} ${m.textAlt} px-2 py-1 rounded-lg transition-colors`}
            title="New project tab"
          >
            <Ic n="Plus" size={11} />
          </button>
        </div>
        <div className={`flex-1 ${pageScroll ? '' : 'overflow-y-auto'} py-1`}>
          {padsState.pads.map((pad) => {
            const isActive = pad.id === padsState.activePadId;
            const latestEntry = [...pad.entries].sort((left, right) => parseEntryTimestamp(right.updatedAt) - parseEntryTimestamp(left.updatedAt))[0];
            const preview = latestEntry?.body ? latestEntry.body.slice(0, 56).replace(/\n/g, ' ') : '';
            const timeStr = latestEntry?.updatedAt ? formatRelativeTime(latestEntry.updatedAt) : '';

            return (
              <button
                key={pad.id}
                type="button"
                onClick={() => handleSelectPad(pad.id)}
                className={`w-full text-left px-3 py-2.5 transition-colors ${
                  isActive ? 'bg-violet-600/15 border-r-2 border-violet-500' : m.btn
                }`}
              >
                <div className={`text-xs font-medium truncate ${isActive ? 'text-violet-200' : m.text}`}>{pad.name}</div>
                <div className={`text-[10px] truncate mt-0.5 ${m.textMuted}`}>{pad.entries.length} prompt{pad.entries.length === 1 ? '' : 's'}</div>
                {preview && <div className={`text-[10px] truncate mt-0.5 ${m.textMuted}`}>{preview}</div>}
                {timeStr && <div className={`text-[10px] mt-0.5 ${m.textMuted}`}>{timeStr}</div>}
              </button>
            );
          })}
        </div>
      </div>

      <div className={`flex-1 flex flex-col min-w-0 ${pageScroll ? '' : 'overflow-hidden'}`}>
        <div className={`flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b ${m.border} shrink-0`}>
          <div className="flex items-center gap-3">
            <span className={`text-sm font-semibold ${m.text}`}>{activePad?.name || DEFAULT_PAD_NAME}</span>
            <span className={`text-xs font-mono ${m.textMuted}`}>{promptCount} prompt{promptCount === 1 ? '' : 's'}</span>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <button type="button" onClick={handleRenamePad} className={`flex items-center gap-1 text-xs ${m.btn} ${m.textAlt} px-2 py-1 rounded-lg transition-colors`} title="Rename project tab">Rename</button>
            <button type="button" onClick={handleAddEntry} className={`flex items-center gap-1 text-xs ${m.btn} ${m.textAlt} px-2 py-1 rounded-lg transition-colors`} title="Add prompt card">
              <Ic n="Plus" size={11} />Prompt
            </button>
            <button
              type="button"
              onClick={handleSendSelectedToPromptLab}
              disabled={!selectionState.text}
              className={`flex items-center gap-1 text-xs px-2 py-1 rounded-lg transition-colors ${
                selectionState.text
                  ? 'bg-violet-600 text-white hover:bg-violet-500'
                  : `${m.btn} ${m.textMuted} opacity-40 cursor-not-allowed`
              }`}
              title="Send selected text to Prompt Lab"
            >
              <Ic n="Share2" size={11} />Send Selected
            </button>
            <button type="button" onClick={handleCopyProject} className={`flex items-center gap-1 text-xs ${m.btn} ${m.textAlt} px-2 py-1 rounded-lg transition-colors`} title="Copy project prompts">
              <Ic n="Copy" size={11} />Copy All
            </button>
            <button type="button" onClick={exportProject} className={`flex items-center gap-1 text-xs ${m.btn} ${m.textAlt} px-2 py-1 rounded-lg transition-colors`} title="Download project prompts">
              <Ic n="Download" size={11} />
            </button>
            <button
              type="button"
              onClick={() => setRefPane(prev => ({ ...prev, open: !prev.open, entryId: prev.entryId || activeEntryId }))}
              className={`flex items-center gap-1 text-xs px-2 py-1 rounded-lg transition-colors ${
                refPane.open ? 'bg-violet-600 text-white' : `${m.btn} ${m.textAlt}`
              }`}
              title="Toggle reference panel (Cmd+Shift+R)"
            >
              <Ic n="Columns" size={11} />Ref
            </button>
            <button
              type="button"
              onClick={handleDeletePad}
              disabled={padsState.pads.length <= 1}
              className={`flex items-center gap-1 text-xs px-2 py-1 rounded-lg transition-colors ${
                padsState.pads.length > 1
                  ? 'text-red-400 hover:bg-red-950/30'
                  : `${m.textMuted} opacity-40 cursor-not-allowed`
              }`}
              title={padsState.pads.length > 1 ? 'Delete project tab' : 'At least one project tab required'}
            >
              <Ic n="Trash2" size={11} />
            </button>
          </div>
        </div>

        <div className={`flex-1 flex ${!compact && refPane.open ? 'flex-row' : 'flex-col'} min-h-0 overflow-hidden`}>
        <div className={`flex-1 p-4 flex flex-col gap-3 ${editorPaneMinHeightClass} ${pageScroll ? '' : 'overflow-y-auto'}`}>
          {activePad?.entries.map((entry) => {
            const statusMeta = STATUS_META[entry.status] || STATUS_META.draft;
            const isActiveEntry = entry.id === activeEntryId;
            return (
              <article key={entry.id} className={`${m.surface} border ${isActiveEntry ? 'border-violet-500/40' : m.border} rounded-xl p-4 flex flex-col gap-3`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <input
                      type="text"
                      value={entry.title}
                      onChange={(event) => handleEntryFieldChange(entry.id, 'title', event.target.value)}
                      onFocus={() => setActiveEntryId(entry.id)}
                      className={`w-full bg-transparent text-sm font-semibold ${m.text} focus:outline-none placeholder-gray-500`}
                      placeholder="Prompt title"
                    />
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <input
                        type="text"
                        value={entry.project}
                        onChange={(event) => handleEntryFieldChange(entry.id, 'project', event.target.value)}
                        onFocus={() => setActiveEntryId(entry.id)}
                        className={`min-w-[9rem] rounded-lg border ${m.input} px-2 py-1 text-xs ${m.text} focus:outline-none focus:border-violet-500`}
                        placeholder="project"
                      />
                      <span className={`inline-flex items-center rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${statusMeta.chip}`}>
                        {statusMeta.label}
                      </span>
                      <span className={`text-[11px] ${m.textMuted}`}>Updated {formatRelativeTime(entry.updatedAt)}</span>
                      {entry.lastSentAt && (
                        <span className={`text-[11px] ${m.textMuted}`}>Sent {formatRelativeTime(entry.lastSentAt)}</span>
                      )}
                    </div>
                  </div>
                </div>

                <textarea
                  ref={(node) => {
                    if (node) textareaRefs.current[entry.id] = node;
                    else delete textareaRefs.current[entry.id];
                  }}
                  value={entry.body}
                  onChange={(event) => handleEntryFieldChange(entry.id, 'body', event.target.value)}
                  onFocus={() => setActiveEntryId(entry.id)}
                  onSelect={(event) => handleSelectionChange(entry.id, event)}
                  onKeyUp={(event) => handleSelectionChange(entry.id, event)}
                  onMouseUp={(event) => handleSelectionChange(entry.id, event)}
                  className={`w-full min-h-[11rem] resize-y rounded-xl border ${m.input} p-4 text-sm leading-relaxed ${m.text} focus:outline-none focus:border-violet-500 transition-colors`}
                  placeholder="Prompt body..."
                  spellCheck
                />

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setRefPane({ open: true, entryId: entry.id, mode: 'entry' })}
                      className={`flex items-center gap-1 text-xs ${m.btn} ${m.textAlt} px-2 py-1.5 rounded-lg transition-colors`}
                      title="Open in reference panel"
                    >
                      <Ic n="PanelRight" size={11} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCopyEntry(entry)}
                      disabled={!entry.body.trim()}
                      className={`flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg font-semibold transition-colors ${
                        entry.body.trim() ? copyBtnClass : `${m.btn} ${m.textMuted} opacity-40 cursor-not-allowed`
                      }`}
                    >
                      <Ic n="Copy" size={11} />Copy
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSendEntryToPromptLab(entry)}
                      disabled={!entry.body.trim()}
                      className={`flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg font-semibold transition-colors ${
                        entry.body.trim()
                          ? 'bg-violet-600 text-white hover:bg-violet-500'
                          : `${m.btn} ${m.textMuted} opacity-40 cursor-not-allowed`
                      }`}
                    >
                      <Ic n="Share2" size={11} />Send to Prompt Lab
                    </button>
                    {entry.status !== 'in_test' ? (
                      <button
                        type="button"
                        onClick={() => handleEntryStatus(entry.id, 'in_test')}
                        className={`flex items-center gap-1 text-xs px-2 py-1 rounded-lg transition-colors ${m.btn} text-amber-300 hover:bg-amber-950/30`}
                      >
                        <Ic n="FlaskConical" size={11} />Mark In Test
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleEntryStatus(entry.id, 'draft')}
                        className={`flex items-center gap-1 text-xs px-2 py-1 rounded-lg transition-colors ${m.btn} ${m.textAlt}`}
                      >
                        <Ic n="RotateCcw" size={11} />Restore Draft
                      </button>
                    )}
                    {entry.status !== 'archived' ? (
                      <button
                        type="button"
                        onClick={() => handleEntryStatus(entry.id, 'archived')}
                        className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg transition-colors text-red-400 hover:bg-red-950/30"
                      >
                        <Ic n="Trash2" size={11} />Archive
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleEntryStatus(entry.id, 'draft')}
                        className={`flex items-center gap-1 text-xs px-2 py-1 rounded-lg transition-colors ${m.btn} ${m.textAlt}`}
                      >
                        <Ic n="RotateCcw" size={11} />Restore Draft
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {entry.promptLabLink && (
                      <a
                        href={entry.promptLabLink}
                        target="_blank"
                        rel="noreferrer noopener"
                        className={`text-[11px] ${m.textMuted} hover:text-violet-400 transition-colors`}
                      >
                        Last handoff
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => handleClearEntryBody(entry)}
                      disabled={!entry.body.trim()}
                      className={`text-xs transition-colors ${
                        entry.body.trim()
                          ? 'text-red-400 hover:text-red-300'
                          : `${m.textMuted} opacity-40 cursor-not-allowed`
                      }`}
                    >
                      Clear
                    </button>
                  </div>
                </div>
              </article>
            );
          })}

          <div className="flex items-center justify-start min-h-5">
            {saveError ? (
              <div className="flex items-center gap-1.5 text-xs font-mono text-red-400 transition-colors">
                <Ic n="X" size={11} />
                <span>{saveError}</span>
              </div>
            ) : saveState === 'saved' ? (
              <div className="flex items-center gap-1.5 text-xs font-mono text-green-500 transition-opacity duration-200">
                <Ic n="Check" size={11} />
                <span>Saved</span>
              </div>
            ) : lastSavedAt ? (
              <div className={`flex items-center gap-1.5 text-xs font-mono text-gray-500 transition-colors ${m.textMuted}`}>
                <Ic n="Clock" size={11} />
                <span>Last saved {relativeSavedAt}</span>
              </div>
            ) : null}
          </div>
        </div>
        {refPane.open && !compact && activePad && (
          <ReferencePane
            m={m}
            activePad={activePad}
            referenceEntryId={refPane.entryId}
            referenceMode={refPane.mode}
            onSelectEntry={(id) => setRefPane(prev => ({ ...prev, entryId: id }))}
            onModeChange={(mode) => setRefPane(prev => ({ ...prev, mode }))}
            onClose={() => setRefPane(prev => ({ ...prev, open: false }))}
            docked
          />
        )}
        </div>
        {refPane.open && compact && activePad && (
          <ReferencePane
            m={m}
            activePad={activePad}
            referenceEntryId={refPane.entryId}
            referenceMode={refPane.mode}
            onSelectEntry={(id) => setRefPane(prev => ({ ...prev, entryId: id }))}
            onModeChange={(mode) => setRefPane(prev => ({ ...prev, mode }))}
            onClose={() => setRefPane(prev => ({ ...prev, open: false }))}
            docked={false}
          />
        )}
      </div>
    </div>
  );
}
