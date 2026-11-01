import { createLibraryJournal, isSyncLibraryKey } from './libraryJournal.js';
import { storageKeys } from './storage.js';
import { logWarn } from './logger.js';
import { PROVIDER_NON_SECRET_FIELDS } from './providerRegistry.js';
import { BILLING_ENTITLEMENT_FIELDS } from './billing.js';

// WebView2 can lose the tail of its Local Storage log across hard restarts
// (Windows CI: every key written after launch 1 read empty on launches 2-4).
// The Library and Scratch journals cover their own keys; this journal covers
// account-sync identity and non-secret settings so a desktop restart cannot
// reset them. Desktop only, like the other journals.
//
// Sync state and the outbox (pl2-sync-state:*, pl2-sync-queue:*) are NOT here:
// they live in the Library record so both always restore together (R-21).
//
// Secrets: provider settings are journaled through an allowlist built from
// providerRegistry (PROVIDER_NON_SECRET_FIELDS), primitive values only, with
// URL credentials removed; every other field, including any future key field,
// is dropped (R-19). A value that cannot be journaled safely is recorded as
// "withheld", which restore skips; it never acts as a removal (R-24).
//
// Billing: pl2-billing is a client-side entitlement cache, not a security
// boundary (docs/billing-policy.md). On the desktop nothing re-verifies it
// (no sign-in there), so the journal only puts back the plan and entitlement
// fields this device already had (BILLING_ENTITLEMENT_FIELDS, lastVerifiedAt
// included); it cannot grant anything. Account email, name, Stripe ids and the
// portal link are never journaled.
export const SETTINGS_JOURNAL_RECORD = 'settings';
export const SETTINGS_JOURNAL_REVISION_KEY = 'pl2-settings-journal-revision';
export const SETTINGS_JOURNAL_STAMPS_KEY = 'pl2-settings-journal-stamps';
export const SETTINGS_JOURNAL_BOOT_MARK = 'prompt-lab:settings-journal-boot';
const STAMPS_ENTRY = '__stamps';
const WITHHELD_ENTRY = '__withheld';
const META = new Set([STAMPS_ENTRY, WITHHELD_ENTRY]);

const PROVIDER_SETTINGS_KEY = 'pl2-provider-settings';
const SETTINGS_KEYS = Object.freeze([
  PROVIDER_SETTINGS_KEY,
  storageKeys.billing,           // pl2-billing: client entitlement cache (see above)
  'pl_telemetry_consent',
  'pl2-redaction-settings',
]);
// The pre-merge snapshot is a full Library copy written rarely; journaling it
// would rewrite megabytes on every sync poll, so it stays out.
const SYNC_EXCLUDED_PREFIXES = Object.freeze(['pl2-sync-snapshot:']);
// Defense in depth for whole-string values (and allowlisted string fields).
const SECRET_VALUE = /^(sk-|sk_|sb_secret_|whsec_|rk_|ghp_|github_pat_|xox[abpr]-|eyJ[\w-]+\.)/;
const PRIMITIVE = new Set(['string', 'number', 'boolean']);

export function isSettingsJournalKey(key) {
  if (typeof key !== 'string') return false;
  if (SETTINGS_KEYS.includes(key)) return true;
  return key.startsWith('pl2-sync-') && !isSyncLibraryKey(key)
    && !SYNC_EXCLUDED_PREFIXES.some(prefix => key.startsWith(prefix));
}

function withoutUrlCredentials(value) {
  try {
    const url = new URL(value);
    if (!url.username && !url.password) return value;
    url.username = ''; url.password = '';
    return url.toString().replace(/\/$/, value.endsWith('/') ? '/' : '');
  } catch {
    return value.includes('@') ? null : value;
  }
}

function allowlisted(parsed, fields) {
  const safe = {};
  for (const field of fields) {
    if (!Object.hasOwn(parsed, field)) continue;
    let value = parsed[field];
    if (!PRIMITIVE.has(typeof value)) continue;          // objects, arrays, null: dropped
    if (typeof value === 'string') {
      if (SECRET_VALUE.test(value)) continue;
      if (/BaseUrl$/.test(field)) { value = withoutUrlCredentials(value); if (value === null) continue; }
    }
    safe[field] = value;
  }
  return safe;
}

// JSON object keys journaled through a field allowlist; live fields outside
// it survive a restore. Provider settings: no API keys (R-19). Billing cache:
// plan and entitlement only, no account email, name or other personal data.
const ALLOWLISTED = Object.freeze({
  [PROVIDER_SETTINGS_KEY]: PROVIDER_NON_SECRET_FIELDS,
  [storageKeys.billing]: BILLING_ENTITLEMENT_FIELDS,
});

// The journaled form of a value, or null when it is withheld (never journaled).
export function journalValue(key, raw) {
  if (raw === null || raw === undefined) return null;
  const fields = Object.hasOwn(ALLOWLISTED, key) ? ALLOWLISTED[key] : null;
  if (!fields) return SECRET_VALUE.test(raw) ? null : raw;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return JSON.stringify(allowlisted(parsed, fields));
  } catch { return null; }
}

const parseObject = (raw, fallback) => {
  try { const value = JSON.parse(raw || 'null'); return value && typeof value === 'object' ? value : fallback; } catch { return fallback; }
};
function readStamps(storage) {
  let raw = null;
  try { raw = storage.getItem(SETTINGS_JOURNAL_STAMPS_KEY); } catch { return {}; }
  const stamps = parseObject(raw, {});
  return Array.isArray(stamps) ? {} : stamps;
}
const recordStamps = entries => { const s = parseObject(entries[STAMPS_ENTRY], {}); return Array.isArray(s) ? {} : s; };
const recordWithheld = entries => { const w = parseObject(entries[WITHHELD_ENTRY], []); return new Set(Array.isArray(w) ? w : []); };

export function readSettingsState(storage) {
  const entries = {};
  const withheld = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!isSettingsJournalKey(key)) continue;
    const value = journalValue(key, storage.getItem(key));
    if (value === null) withheld.push(key);
    else entries[key] = value;
  }
  const stamps = readStamps(storage);
  if (Object.keys(stamps).length) entries[STAMPS_ENTRY] = JSON.stringify(stamps);
  if (withheld.length) entries[WITHHELD_ENTRY] = JSON.stringify(withheld.sort());
  return entries;
}

// The three states a key can have in a record: a value, withheld, or removed
// (a stamp with neither). A key with no stamp and no value says nothing.
function keyState(entries, stamps, withheld, key) {
  if (withheld.has(key)) return { kind: 'withheld', stamp: Number(stamps[key]) || 0 };
  if (Object.hasOwn(entries, key)) return { kind: 'value', value: entries[key], stamp: Number(stamps[key]) || 0 };
  const stamp = Number(stamps[key]) || 0;
  return stamp ? { kind: 'removed', stamp } : null;
}
const allKeys = (...records) => {
  const keys = new Set();
  for (const { entries, stamps, withheld } of records) {
    for (const key of [...Object.keys(entries), ...Object.keys(stamps), ...withheld]) if (!META.has(key)) keys.add(key);
  }
  return keys;
};
const view = entries => ({ entries, stamps: recordStamps(entries), withheld: recordWithheld(entries) });
function toEntries(states) {
  const entries = {}; const stamps = {}; const withheld = [];
  for (const [key, state] of states) {
    if (state.stamp) stamps[key] = state.stamp;
    if (state.kind === 'value') entries[key] = state.value;
    if (state.kind === 'withheld') withheld.push(key);
  }
  if (Object.keys(stamps).length) entries[STAMPS_ENTRY] = JSON.stringify(stamps);
  if (withheld.length) entries[WITHHELD_ENTRY] = JSON.stringify(withheld.sort());
  return entries;
}

// R-20: runs inside the write transaction. Per key, the side with the newer
// stamp wins. This device keeps its unstamped live value over a journaled one,
// but a key it has never seen (for example after a failed boot read with Local
// Storage lost) keeps the journal's value or removal.
export function mergeSettingsEntries(storedEntries, freshEntries) {
  const stored = view(storedEntries); const fresh = view(freshEntries);
  const states = new Map();
  for (const key of allKeys(stored, fresh)) {
    if (!isSettingsJournalKey(key)) continue;
    const a = keyState(stored.entries, stored.stamps, stored.withheld, key);
    const b = keyState(fresh.entries, fresh.stamps, fresh.withheld, key);
    let pick;
    if (!b) pick = a;
    else if (!a) pick = b;
    else if (b.stamp > a.stamp) pick = b;
    else if (b.stamp < a.stamp) pick = (b.stamp === 0 && b.kind !== 'removed' && a.kind === 'value') ? b : a;
    else pick = b.kind === 'removed' && a.kind !== 'removed' && !b.stamp ? a : b;
    if (pick) states.set(key, { ...pick, stamp: Math.max(a?.stamp || 0, b?.stamp || 0) });
  }
  return toEntries(states);
}

// Boot restore, per key. A journaled value replaces the live one only when the
// live key is missing (and not removed later here), or when this device's
// stamp for it is older. A journaled removal beats an older or unstamped live
// value (R-25). Withheld keys are left exactly as they are (R-24). Live fields
// outside the provider allowlist (API keys) survive a provider replace.
export function applySettingsJournalRecord(storage, record, rawSet = (k, v) => storage.setItem(k, v), rawRemove = k => storage.removeItem(k)) {
  const local = readStamps(storage);
  const journal = view(record.entries);
  const merged = { ...journal.stamps };
  for (const [key, stamp] of Object.entries(local)) merged[key] = Math.max(Number(stamp) || 0, Number(merged[key]) || 0);
  for (const key of allKeys(journal)) {
    if (!isSettingsJournalKey(key)) continue;
    const saved = keyState(journal.entries, journal.stamps, journal.withheld, key);
    if (!saved || saved.kind === 'withheld') continue;
    const live = storage.getItem(key);
    const liveStamp = Number(local[key]) || 0;
    if (saved.kind === 'removed') {
      if (live !== null && saved.stamp > liveStamp) rawRemove(key);
      continue;
    }
    if (journalValue(key, live) === saved.value) continue;
    const journalNewer = live === null ? saved.stamp >= liveStamp : liveStamp > 0 && saved.stamp > liveStamp;
    if (!journalNewer) continue;
    let value = saved.value;
    if (Object.hasOwn(ALLOWLISTED, key) && live !== null) {
      const current = parseObject(live, null);
      if (current && !Array.isArray(current)) value = JSON.stringify({ ...current, ...JSON.parse(saved.value) });
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
    mergeEntries: mergeSettingsEntries,
  });
}

// Many writers (the sync engine, billing, consent) call storage.setItem
// directly, so the journal watches the Storage methods for this one storage
// object. Settings keys are stamped and journaled here; sync state and outbox
// writes are announced to the Library journal, which owns them (R-21).
function watchWrites(storage, onWrite) {
  const proto = Object.getPrototypeOf(storage);
  const originalSet = proto.setItem;
  const originalRemove = proto.removeItem;
  let warned = false;
  const stamp = (key) => {
    // R-25: the value is already saved; a full storage must not make the
    // caller's setItem throw because of this bookkeeping write.
    try {
      const stamps = readStamps(storage);
      stamps[key] = Math.max(Date.now(), (Number(stamps[key]) || 0) + 1);
      originalSet.call(storage, SETTINGS_JOURNAL_STAMPS_KEY, JSON.stringify(stamps));
    } catch (error) {
      if (!warned) { warned = true; logWarn('settings journal stamp', error); }
    }
  };
  const after = (key) => {
    // Sync state and outbox writes are not forwarded: the sync engine tells the
    // Library journal itself, once per sync (R-28, R-29).
    if (isSettingsJournalKey(key)) { stamp(key); onWrite(key); }
  };
  function setItem(key, value) {
    const result = originalSet.call(this, key, value);
    if (this === storage) after(String(key));
    return result;
  }
  function removeItem(key) {
    const result = originalRemove.call(this, key);
    // R-20: a removal is recorded even when the key is already missing here
    // (for example sign-out after a failed boot read), so it cannot come back.
    if (this === storage) after(String(key));
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
  // Writes are watched even when the boot read failed: each write merges per
  // key inside its transaction, so it cannot drop what the journal holds.
  const unwatch = watchWrites(storage, journal.note);
  try { performance.mark(SETTINGS_JOURNAL_BOOT_MARK, { detail: outcome }); } catch { /* Diagnostics only. */ }
  return { journal, outcome, stop: unwatch };
}
