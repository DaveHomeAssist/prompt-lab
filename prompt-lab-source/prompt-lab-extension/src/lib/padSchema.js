import { storageKeys } from './storage.js';

export const PADS_KEY = 'pl2-pads';
export const PADS_SCHEMA_VERSION_KEY = 'pl2-pads-schema-version';
export const PADS_V2_BACKUP_KEY = 'pl2-pads-v2-backup';
export const PADS_SCHEMA_VERSION = 3;
export const PAD_EDITOR_FORMAT = 'tiptap-json';

const DEFAULT_PAD_ID = 'default';
const DEFAULT_PAD_NAME = 'Scratchpad';

export function createEmptyPadDocument() {
  return { type: 'doc', content: [{ type: 'paragraph' }] };
}

export function plainTextToPadDocument(value = '') {
  const lines = String(value).replace(/\r\n?/g, '\n').split('\n');
  return {
    type: 'doc',
    content: lines.map((line) => ({
      type: 'paragraph',
      ...(line ? { content: [{ type: 'text', text: line }] } : {}),
    })),
  };
}

function inlineText(node) {
  if (!node || typeof node !== 'object') return '';
  if (node.type === 'text') return String(node.text || '');
  if (node.type === 'hardBreak') return '\n';
  return (Array.isArray(node.content) ? node.content : []).map(inlineText).join('');
}

function blockText(node) {
  if (!node || typeof node !== 'object') return '';
  const children = Array.isArray(node.content) ? node.content : [];
  if (node.type === 'bulletList') return children.map((child) => `- ${blockText(child)}`).join('\n');
  if (node.type === 'orderedList') return children.map((child, index) => `${index + 1}. ${blockText(child)}`).join('\n');
  if (node.type === 'taskList') {
    return children.map((child) => `- [${child?.attrs?.checked ? 'x' : ' '}] ${blockText(child)}`).join('\n');
  }
  if (node.type === 'listItem' || node.type === 'taskItem') return children.map(blockText).filter(Boolean).join('\n');
  if (node.type === 'paragraph' || node.type === 'heading') return inlineText(node);
  return children.map(blockText).filter(Boolean).join('\n');
}

export function padDocumentToPlainText(doc) {
  if (!doc || doc.type !== 'doc') return '';
  return (Array.isArray(doc.content) ? doc.content : []).map(blockText).join('\n');
}

export function isPadDocument(value) {
  return Boolean(value && value.type === 'doc' && Array.isArray(value.content));
}

function isoFromTimestamp(value, fallback) {
  const date = typeof value === 'number' ? new Date(value) : new Date(value || fallback);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

export function createPad({ id = DEFAULT_PAD_ID, name = DEFAULT_PAD_NAME, text = '', now = new Date().toISOString() } = {}) {
  return {
    id,
    name,
    doc: plainTextToPadDocument(text),
    plainText: String(text),
    editorFormat: PAD_EDITOR_FORMAT,
    createdAt: now,
    updatedAt: now,
  };
}

export function createDefaultPadsPayload(text = '', now = new Date().toISOString()) {
  return {
    schemaVersion: PADS_SCHEMA_VERSION,
    pads: [createPad({ text, now })],
    activePadId: DEFAULT_PAD_ID,
  };
}

export function isValidPadsPayloadV3(value) {
  return Boolean(
    value
    && value.schemaVersion === PADS_SCHEMA_VERSION
    && Array.isArray(value.pads)
    && value.pads.length > 0
    && typeof value.activePadId === 'string'
    && value.pads.every((pad) => (
      pad
      && typeof pad.id === 'string'
      && typeof pad.name === 'string'
      && isPadDocument(pad.doc)
      && typeof pad.plainText === 'string'
      && pad.editorFormat === PAD_EDITOR_FORMAT
      && typeof pad.createdAt === 'string'
      && typeof pad.updatedAt === 'string'
    ))
  );
}

function isValidPadsPayloadV2(value) {
  return Boolean(
    value
    && Array.isArray(value.pads)
    && value.pads.length > 0
    && typeof value.activePadId === 'string'
    && value.pads.every((pad) => pad && typeof pad.id === 'string' && typeof pad.name === 'string' && typeof pad.content === 'string')
  );
}

function convertV2Payload(value, now) {
  return {
    schemaVersion: PADS_SCHEMA_VERSION,
    activePadId: value.activePadId,
    pads: value.pads.map((pad) => {
      const updatedAt = isoFromTimestamp(pad.timestamp, now);
      return {
        id: pad.id,
        name: pad.name,
        doc: plainTextToPadDocument(pad.content),
        plainText: pad.content,
        editorFormat: PAD_EDITOR_FORMAT,
        createdAt: updatedAt,
        updatedAt,
      };
    }),
  };
}

export function persistPadsPayload(payload, storage = globalThis.localStorage) {
  if (!isValidPadsPayloadV3(payload)) throw new Error('Scratchpad data is invalid and was not saved.');
  storage.setItem(PADS_KEY, JSON.stringify(payload));
  storage.setItem(PADS_SCHEMA_VERSION_KEY, String(PADS_SCHEMA_VERSION));
  return true;
}

export function loadAndMigratePads(storage = globalThis.localStorage, now = new Date().toISOString()) {
  const rawPads = storage.getItem(PADS_KEY);
  let parsed = null;
  if (rawPads) {
    try { parsed = JSON.parse(rawPads); } catch { parsed = null; }
  }

  if (isValidPadsPayloadV3(parsed)) {
    storage.setItem(PADS_SCHEMA_VERSION_KEY, String(PADS_SCHEMA_VERSION));
    return { payload: parsed, migrated: false, error: null };
  }

  let source = parsed;
  let sourceLabel = 'version-2';
  if (!isValidPadsPayloadV2(source)) {
    const legacyText = storage.getItem(storageKeys.pad) || storage.getItem('pl-pad') || '';
    const legacyTimestamp = storage.getItem(`${storageKeys.pad}_meta`) || storage.getItem('pl-pad_meta') || now;
    source = {
      pads: [{ id: DEFAULT_PAD_ID, name: DEFAULT_PAD_NAME, content: legacyText, timestamp: legacyTimestamp }],
      activePadId: DEFAULT_PAD_ID,
    };
    sourceLabel = 'legacy-single-pad';
  }

  const payload = convertV2Payload(source, now);
  try {
    storage.setItem(PADS_V2_BACKUP_KEY, JSON.stringify({
      backedUpAt: now,
      source: sourceLabel,
      version: 2,
      payload: source,
    }));
    persistPadsPayload(payload, storage);
    storage.removeItem(storageKeys.pad);
    storage.removeItem(`${storageKeys.pad}_meta`);
    storage.removeItem('pl-pad');
    storage.removeItem('pl-pad_meta');
    return { payload, migrated: true, error: null };
  } catch (error) {
    return { payload, migrated: false, error };
  }
}

export function sanitizePastedPadHtml(html, allowedColors = []) {
  const parser = new DOMParser();
  const documentNode = parser.parseFromString(String(html || ''), 'text/html');
  documentNode.querySelectorAll('script,style,iframe,object,embed').forEach((node) => node.remove());
  const colors = new Set(allowedColors.map((color) => {
    const probe = documentNode.createElement('span');
    probe.style.color = color;
    return probe.style.color.toLowerCase();
  }));
  documentNode.body.querySelectorAll('*').forEach((element) => {
    const color = element.style?.color?.toLowerCase() || '';
    element.removeAttribute('style');
    if (color && colors.has(color)) element.style.color = color;
    [...element.attributes].forEach((attribute) => {
      if (/^on/i.test(attribute.name)) element.removeAttribute(attribute.name);
    });
  });
  return documentNode.body.innerHTML;
}
