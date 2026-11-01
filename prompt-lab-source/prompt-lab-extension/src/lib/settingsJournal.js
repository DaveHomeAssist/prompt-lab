import { createLibraryJournal } from './libraryJournal.js';
import { storageKeys } from './storage.js';
import { logWarn } from './logger.js';

// WebView2 can lose the tail of its Local Storage log across hard restarts
// (Windows CI: every key written after launch 1 read empty on launches 2-4).
// The Library and Scratch journals cover their own keys; this journal covers
// account-sync state and non-secret settings so a desktop restart cannot reset
// them. Desktop only, like the other journals.
//
// Never journaled: API keys and other secrets (they belong in the OS keychain).
// Provider settings are journaled with every secret field removed. The billing
// cache is included because it is a non-authoritative client cache that the
// server re-verifies (docs/billing-policy.md); it holds no secret.
export const SETTINGS_JOURNAL_RECORD = 'settings';
export const SETTINGS_JOURNAL_REVISION_KEY = 'pl2-settings-journal-revision';
export const SETTINGS_JOURNAL_STAMPS_KEY = 'pl2-settings-journal-stamps';
export const SETTINGS_JOURNAL_BOOT_MARK = 'prompt-lab:settings-journal-boot';
const STAMPS_ENTRY = '__stamps';

const PROVIDER_SETTINGS_KEY = 'pl2-provider-settings';
const SETTINGS_KEYS = Object.freeze([
  PROVIDER_SETTINGS_KEY,
  storageKeys.billing,           // pl2-billing: re-verified entitlement cache
  'pl_telemetry_consent',
  'pl2-redaction-settings',
]);
// The pre-merge snapshot is a full Library copy written rarely; journaling it
// would rewrite megabytes on every sync poll, so it stays out.
const SYNC_EXCLUDED_PREFIXES = Object.freeze(['pl2-sync-snapshot:']);
const SECRET_FIELD = /(api[-_]?key|secret|token|password|passphrase|credential|private[-_]?key|authorization)/i;
const SECRET_VALUE = /^(sk-|sk_|sb_secret_|whsec_|rk_|eyJ[\w-]+\.)/;

export function isSettingsJournalKey(key) {
  if (typeof key !== 'string') return false;
  if (SETTINGS_KEYS.includes(key)) return true;
  return key.startsWith('pl2-sync-') && !SYNC_EXCLUDED_PREFIXES.some(prefix => key.startsWith(prefix));
}

// Removes secret fields from the provider settings JSON. Anything that cannot
// be parsed is not journaled at all (it might be a raw secret).
export function journalValue(key, raw) {
  if (raw === null || raw === undefined) return null;
  if (key !== PROVIDER_SETTINGS_KEY) return SECRET_VALUE.test(raw) ? null : raw;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const safe = {};
    for (const [field, value] of Object.entries(parsed)) {
      if (SECRET_FIELD.test(field)) continue;
      if (typeof value === 'string' && SECRET_VALUE.test(value)) continue;
      safe[field] = value;
    }
    return JSON.stringify(safe);
  } catch { return null; }
}

function readStamps(storage) {
  try {
    const stamps = JSON.parse(storage.getItem(SETTINGS_JOURNAL_STAMPS_KEY) || '{}');
    return stamps && typeof stamps === 'object' && !Array.isArray(stamps) ? stamps : {};
  } catch { return {}; }
}

export function readSettingsState(storage) {
  const entries = {};
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!isSettingsJournalKey(key)) continue;
    const value = journalValue(key, storage.getItem(key));
    if (value !== null) entries[key] = value;
  }
  const stamps = readStamps(storage);
  if (Object.keys(stamps).length) entries[STAMPS_ENTRY] = JSON.stringify(stamps);
  return entries;
}

// Per key: a journaled value replaces the live one only when the live key is
// missing, or when this device's write stamp for it is older than the
// journal's. A live value with a newer (or unknown) stamp is kept. Secret
// fields already in the live provider settings are preserved on a replace.
export function applySettingsJournalRecord(storage, record, rawSet = (k, v) => storage.setItem(k, v), rawRemove = k => storage.removeItem(k)) {
  const local = readStamps(storage);
  let journal = {};
  try { journal = JSON.parse(record.entries[STAMPS_ENTRY] || '{}') || {}; } catch { journal = {}; }
  const keys = new Set([...Object.keys(record.entries), ...Object.keys(journal)]);
  keys.delete(STAMPS_ENTRY);
  const merged = { ...journal };
  for (const [key, stamp] of Object.entries(local)) merged[key] = Math.max(Number(stamp) || 0, Number(merged[key]) || 0);
  for (const key of keys) {
    if (!isSettingsJournalKey(key)) continue;
    const live = storage.getItem(key);
    const saved = Object.hasOwn(record.entries, key) ? record.entries[key] : null;
    const liveStamp = Number(local[key]) || 0;
    const savedStamp = Number(journal[key]) || 0;
    if (journalValue(key, live) === saved) continue;
    const journalNewer = live === null ? savedStamp >= liveStamp : liveStamp > 0 && savedStamp > liveStamp;
    if (!journalNewer) continue;
    if (saved === null) { rawRemove(key); continue; }
    let value = saved;
    if (key === PROVIDER_SETTINGS_KEY && live !== null) {
      try {
        const secrets = Object.fromEntries(Object.entries(JSON.parse(live)).filter(([field]) => SECRET_FIELD.test(field)));
        value = JSON.stringify({ ...JSON.parse(saved), ...secrets });
      } catch { /* keep the journaled, secret-free value */ }
    }
    rawSet(key, value);
  }
  rawSet(SETTINGS_JOURNAL_STAMPS_KEY, JSON.stringify(merged));
  rawSet(SETTINGS_JOURNAL_REVISION_KEY, String(record.revision));
}

export function createSettingsJournal({ storage, idb, timeoutMs, bootRetries }) {
  return createLibraryJournal({
    storage, idb, timeoutMs, bootRetries,
    recordId: SETTINGS_JOURNAL_RECORD,
    revisionKey: SETTINGS_JOURNAL_REVISION_KEY,
    isKey: isSettingsJournalKey,
    readState: readSettingsState,
    applyRecord: (target, record) => applySettingsJournalRecord(target, record),
  });
}

// Many writers (the sync engine, billing, consent) call storage.setItem
// directly, so the journal watches the Storage methods for this one storage
// object. Every write of a journaled key is stamped, then journaled.
function watchWrites(storage, onWrite) {
  const proto = Object.getPrototypeOf(storage);
  const originalSet = proto.setItem;
  const originalRemove = proto.removeItem;
  const stamp = (key) => {
    const stamps = readStamps(storage);
    stamps[key] = Math.max(Date.now(), (Number(stamps[key]) || 0) + 1);
    originalSet.call(storage, SETTINGS_JOURNAL_STAMPS_KEY, JSON.stringify(stamps));
  };
  function setItem(key, value) {
    const result = originalSet.call(this, key, value);
    if (this === storage && isSettingsJournalKey(String(key))) { stamp(String(key)); onWrite(String(key)); }
    return result;
  }
  function removeItem(key) {
    const had = this === storage && this.getItem(key) !== null;
    const result = originalRemove.call(this, key);
    if (had && isSettingsJournalKey(String(key))) { stamp(String(key)); onWrite(String(key)); }
    return result;
  }
  proto.setItem = setItem;
  proto.removeItem = removeItem;
  return () => {
    if (proto.setItem === setItem) proto.setItem = originalSet;
    if (proto.removeItem === removeItem) proto.removeItem = originalRemove;
  };
}

export async function startSettingsJournal({ storage = localStorage, idb = globalThis.indexedDB, timeoutMs, bootRetries } = {}) {
  const journal = createSettingsJournal({ storage, idb, timeoutMs, bootRetries });
  let outcome;
  try {
    outcome = await journal.restore();
    // Live values kept as newer during a restore still need journaling.
    if (outcome.action === 'restore') journal.commit();
  } catch (error) {
    logWarn('settings journal restore', error);
    outcome = { action: 'unavailable', error: error?.message || String(error), attempts: error?.attempts ?? 1 };
  }
  // Writes are watched even when the boot read failed: the next write retries the open.
  const unwatch = watchWrites(storage, journal.note);
  try { performance.mark(SETTINGS_JOURNAL_BOOT_MARK, { detail: outcome }); } catch { /* Diagnostics only. */ }
  return { journal, outcome, stop: unwatch };
}
