import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  SETTINGS_JOURNAL_RECORD, SETTINGS_JOURNAL_REVISION_KEY, SETTINGS_JOURNAL_STAMPS_KEY,
  isSettingsJournalKey, journalValue, mergeSettingsEntries, startSettingsJournal,
} from '../lib/settingsJournal.js';
import { LIBRARY_JOURNAL_RECORD, isSyncLibraryKey, startLibraryJournal } from '../lib/libraryJournal.js';
import { PROVIDER_NON_SECRET_FIELDS, PROVIDER_SECRET_FIELDS, VALID_PROVIDERS } from '../lib/providerRegistry.js';
import { notifyLocalWrite, storageKeys } from '../lib/storage.js';
import { createSyncEngine, stateKey } from '../lib/sync/syncEngine.js';
import { createFakeIndexedDb } from './helpers/fakeIndexedDb.js';

let idb;
const stops = [];
const boot = async (options = {}) => {
  const started = await startSettingsJournal({ storage: localStorage, idb, ...options });
  stops.push(started.stop);
  return started;
};
const settle = async ({ journal }) => { await Promise.resolve(); await journal.flush(); };
const record = () => idb.rows().get(SETTINGS_JOURNAL_RECORD);
const stopAll = () => { for (const stop of stops.splice(0)) stop(); };
// WebView2's Local Storage log lost every write after launch 1 (windows-latest NSIS run).
const loseLocalStorage = () => { stopAll(); localStorage.clear(); };
const stampsOf = () => JSON.parse(localStorage.getItem(SETTINGS_JOURNAL_STAMPS_KEY) || '{}');
const FAKE = 'FAKEVALUE-not-a-real-key-000';

const IDENTITY = { 'pl2-sync-device-id': 'device-1', 'pl2-sync-owner': 'user_A', 'pl2-sync-conflicts-unseen:user_A': '2' };

beforeEach(() => { localStorage.clear(); idb = createFakeIndexedDb(); });
afterEach(stopAll);

describe('desktop settings journal', () => {
  it('restores sync identity keys, provider settings, billing cache and consent after Local Storage loss', async () => {
    const first = await boot();
    for (const [key, value] of Object.entries(IDENTITY)) localStorage.setItem(key, value);
    localStorage.setItem('pl2-provider-settings', JSON.stringify({ provider: 'ollama', ollamaBaseUrl: 'http://127.0.0.1:11434', ollamaModel: 'm' }));
    localStorage.setItem('pl2-billing', JSON.stringify({ plan: 'pro', status: 'active' }));
    localStorage.setItem('pl_telemetry_consent', 'denied');
    await settle(first);

    loseLocalStorage();
    const { outcome } = await boot();
    expect(outcome.action).toBe('restore');
    for (const [key, value] of Object.entries(IDENTITY)) expect(localStorage.getItem(key)).toBe(value);
    expect(JSON.parse(localStorage.getItem('pl2-provider-settings'))).toEqual({ provider: 'ollama', ollamaBaseUrl: 'http://127.0.0.1:11434', ollamaModel: 'm' });
    expect(JSON.parse(localStorage.getItem('pl2-billing')).plan).toBe('pro');
    expect(localStorage.getItem('pl_telemetry_consent')).toBe('denied');
  });

  it('keeps a live value that is newer than the journal, and an unstamped live value', async () => {
    const first = await boot();
    localStorage.setItem('pl2-sync-owner', 'user_A');
    localStorage.setItem('pl2-sync-device-id', 'device-journal');
    await settle(first);
    stopAll();
    // A later write reached Local Storage but its journal commit never finished.
    const stamps = stampsOf();
    localStorage.setItem('pl2-sync-owner', 'user_B');
    localStorage.setItem(SETTINGS_JOURNAL_STAMPS_KEY, JSON.stringify({ ...stamps, 'pl2-sync-owner': stamps['pl2-sync-owner'] + 5000, 'pl2-sync-device-id': undefined }));
    localStorage.setItem('pl2-sync-device-id', 'device-live'); // no stamp: cannot be proven older
    localStorage.removeItem(SETTINGS_JOURNAL_REVISION_KEY); // force the restore path

    const started = await boot();
    expect(started.outcome.action).toBe('restore');
    expect(localStorage.getItem('pl2-sync-owner')).toBe('user_B');
    expect(localStorage.getItem('pl2-sync-device-id')).toBe('device-live');
    await settle(started);
    expect(record().entries['pl2-sync-owner']).toBe('user_B');
  });

  it('replaces an older live value when the journal holds a newer write', async () => {
    const first = await boot();
    localStorage.setItem('pl2-sync-owner', 'user_old');
    await settle(first);
    const older = stampsOf()['pl2-sync-owner'];
    localStorage.setItem('pl2-sync-owner', 'user_new');
    await settle(first);
    stopAll();
    // Local Storage dropped the last write and its stamp.
    localStorage.setItem('pl2-sync-owner', 'user_old');
    localStorage.setItem(SETTINGS_JOURNAL_STAMPS_KEY, JSON.stringify({ 'pl2-sync-owner': older }));
    localStorage.removeItem(SETTINGS_JOURNAL_REVISION_KEY);
    await boot();
    expect(localStorage.getItem('pl2-sync-owner')).toBe('user_new');
  });

  describe('R-19: provider settings allowlist', () => {
    it('drops every provider API key field', () => {
      expect(PROVIDER_SECRET_FIELDS.length).toBe(VALID_PROVIDERS.filter(id => id !== 'ollama').length);
      for (const field of PROVIDER_SECRET_FIELDS) {
        expect(PROVIDER_NON_SECRET_FIELDS).not.toContain(field);
        const out = journalValue('pl2-provider-settings', JSON.stringify({ provider: 'openai', [field]: FAKE, openaiModel: 'gpt' }));
        expect(out).not.toContain(FAKE);
        expect(JSON.parse(out)).toEqual({ provider: 'openai', openaiModel: 'gpt' });
      }
    });

    // Fire Watch re-review 6, probe P1: all 12 shapes.
    const shapes = {
      nested: { provider: 'openai', providers: { openai: { apiKey: FAKE } } },
      anthropicKey: { anthropicKey: FAKE },
      xaiKey: { xaiKey: FAKE },
      bearer: { bearer: FAKE },
      auth: { auth: FAKE },
      pat: { githubPat: FAKE },
      headers: { customHeaders: { Authorization: `Bearer ${FAKE}` } },
      urlUserinfo: { ollamaBaseUrl: `http://user:${FAKE}@duncan:11434` },
      keysArray: { keys: [FAKE] },
      plainApiKey: { apiKey: FAKE },
      openaiApiKey: { openaiApiKey: FAKE },
      clientSecret: { clientSecret: FAKE },
    };
    for (const [name, value] of Object.entries(shapes)) {
      it(`never journals the ${name} shape`, () => {
        const out = journalValue('pl2-provider-settings', JSON.stringify(value));
        expect(out).not.toBeNull();
        expect(out).not.toContain(FAKE);
        expect(out).not.toContain('user:');
      });
    }

    it('keeps allowlisted primitives only and strips URL credentials', () => {
      const out = JSON.parse(journalValue('pl2-provider-settings', JSON.stringify({
        provider: 'ollama', ollamaModel: 'llama', ollamaBaseUrl: `http://user:${FAKE}@duncan:11434`,
        openaiModel: { nested: true }, anthropicModel: ['x'], futureField: 'x',
      })));
      expect(out).toEqual({ provider: 'ollama', ollamaModel: 'llama', ollamaBaseUrl: 'http://duncan:11434' });
    });

    it('never writes a secret to IndexedDB and keeps live secrets when restoring', async () => {
      const first = await boot();
      localStorage.setItem('pl2-provider-settings', JSON.stringify({ provider: 'anthropic', apiKey: FAKE, openaiApiKey: FAKE, anthropicModel: 'claude' }));
      await settle(first);
      expect(JSON.stringify(record())).not.toContain(FAKE);
      stopAll();
      // Older live copy with a key still in it; the journal's model is newer.
      const stamps = stampsOf();
      localStorage.setItem('pl2-provider-settings', JSON.stringify({ provider: 'anthropic', apiKey: FAKE, anthropicModel: 'old' }));
      localStorage.setItem(SETTINGS_JOURNAL_STAMPS_KEY, JSON.stringify({ 'pl2-provider-settings': stamps['pl2-provider-settings'] - 10 }));
      localStorage.removeItem(SETTINGS_JOURNAL_REVISION_KEY);
      await boot();
      expect(JSON.parse(localStorage.getItem('pl2-provider-settings'))).toEqual({ provider: 'anthropic', apiKey: FAKE, anthropicModel: 'claude' });
    });
  });

  it('R-20: a write after a failed boot read keeps the journaled keys', async () => {
    const first = await boot();
    localStorage.setItem('pl2-sync-owner', 'user_A');
    localStorage.setItem('pl2-sync-device-id', 'device-1');
    await settle(first);
    loseLocalStorage();
    // A cold start: IndexedDB answers only after the boot read gave up.
    idb.state.openDelayMs = 40;
    const blind = await boot({ timeoutMs: 5, bootRetries: 0 });
    expect(blind.outcome.action).toBe('unavailable');
    expect(localStorage.getItem('pl2-sync-owner')).toBeNull();
    localStorage.setItem('pl_telemetry_consent', 'granted');
    await new Promise(resolve => setTimeout(resolve, 80));
    await blind.journal.flush();
    expect(record().entries.pl_telemetry_consent).toBe('granted');
    expect(record().entries['pl2-sync-owner']).toBe('user_A');
    expect(record().entries['pl2-sync-device-id']).toBe('device-1');
  });

  it('R-20: merges per key inside the write, so an unaware writer cannot drop journaled keys', () => {
    const stored = { 'pl2-sync-owner': 'user_A', __stamps: JSON.stringify({ 'pl2-sync-owner': 100 }) };
    const fresh = { pl_telemetry_consent: 'granted', __stamps: JSON.stringify({ pl_telemetry_consent: 200 }) };
    const merged = mergeSettingsEntries(stored, fresh);
    expect(merged['pl2-sync-owner']).toBe('user_A');
    expect(merged.pl_telemetry_consent).toBe('granted');
    expect(JSON.parse(merged.__stamps)).toEqual({ 'pl2-sync-owner': 100, pl_telemetry_consent: 200 });
  });

  it('R-20: records the removal of a key that is already missing locally', async () => {
    const first = await boot();
    localStorage.setItem('pl2-sync-owner', 'user_A');
    await settle(first);
    loseLocalStorage();
    idb.state.hangOpen = true;
    await boot({ timeoutMs: 10 });            // boot read fails: owner not restored
    localStorage.removeItem('pl2-sync-owner'); // sign-out removes an absent key
    expect(stampsOf()['pl2-sync-owner']).toBeGreaterThan(0);
    stopAll();
    idb.state.hangOpen = false;
    const next = await boot();
    await settle(next);
    expect(localStorage.getItem('pl2-sync-owner')).toBeNull();
    expect(record().entries['pl2-sync-owner']).toBeUndefined();
  });

  it('R-24: a withheld value is skipped on restore, never treated as a removal', async () => {
    const first = await boot();
    localStorage.setItem('pl2-redaction-settings', `sk-${FAKE}`);
    await settle(first);
    expect(JSON.stringify(record())).not.toContain(FAKE);
    expect(JSON.parse(record().entries.__withheld)).toContain('pl2-redaction-settings');
    stopAll();
    localStorage.setItem(SETTINGS_JOURNAL_STAMPS_KEY, '{}');
    localStorage.removeItem(SETTINGS_JOURNAL_REVISION_KEY);
    await boot();
    expect(localStorage.getItem('pl2-redaction-settings')).toBe(`sk-${FAKE}`);
  });

  it('R-25: a journaled removal beats an unstamped live value', async () => {
    localStorage.setItem('pl2-billing', JSON.stringify({ plan: 'pro' })); // written before the journal existed
    const first = await boot();
    localStorage.removeItem('pl2-billing');
    await settle(first);
    stopAll();
    // Local Storage rolls back to the pre-journal state (value, no stamps).
    localStorage.setItem('pl2-billing', JSON.stringify({ plan: 'pro' }));
    localStorage.removeItem(SETTINGS_JOURNAL_STAMPS_KEY);
    localStorage.removeItem(SETTINGS_JOURNAL_REVISION_KEY);
    await boot();
    expect(localStorage.getItem('pl2-billing')).toBeNull();
  });

  it('R-25: a full storage never makes the caller\'s setItem throw because of the stamp', async () => {
    // Fail only the stamp write, after the value write succeeded.
    let calls = 0;
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === SETTINGS_JOURNAL_STAMPS_KEY && ++calls) throw new DOMException('full', 'QuotaExceededError');
      return real.call(this, key, value);
    };
    try {
      await boot();
      expect(() => localStorage.setItem('pl2-sync-owner', 'user_A')).not.toThrow();
      expect(localStorage.getItem('pl2-sync-owner')).toBe('user_A');
      expect(calls).toBeGreaterThan(0);
    } finally { stopAll(); Storage.prototype.setItem = real; }
  });

  it('journals only the allowlist and leaves the pre-merge snapshot, sync state and outbox out', async () => {
    const first = await boot();
    localStorage.setItem('pl2-sync-snapshot:user_A', '{"big":true}');
    localStorage.setItem('pl2-sync-state:user_A', '{}');
    localStorage.setItem('pl2-sync-queue:user_A', '[]');
    localStorage.setItem('pl2-library', '[]');
    localStorage.setItem('pl2-sync-owner', 'user_A');
    await settle(first);
    expect(Object.keys(record().entries).filter(key => !key.startsWith('__'))).toEqual(['pl2-sync-owner']);
    expect(isSettingsJournalKey('pl2-sync-snapshot:user_A')).toBe(false);
    expect(isSettingsJournalKey('pl2-sync-state:user_A')).toBe(false);
    expect(isSyncLibraryKey('pl2-sync-queue:user_A')).toBe(true);
    expect(sessionStorage.getItem(SETTINGS_JOURNAL_STAMPS_KEY)).toBeNull();
  });

  it('labels its own timeouts', async () => {
    idb.state.hangOpen = true;
    const { outcome } = await boot({ timeoutMs: 5, bootRetries: 0 });
    expect(outcome.error).toBe('Settings journal did not answer in time.');
  });

  it('restores the Storage methods when stopped', async () => {
    const before = Storage.prototype.setItem;
    await boot();
    expect(Storage.prototype.setItem).not.toBe(before);
    stopAll();
    expect(Storage.prototype.setItem).toBe(before);
  });
});

// R-21: a restore must never pair a newer sync shadow with an older Library.
describe('R-21: sync state restores together with the Library', () => {
  const entry = (id, text) => ({ id, title: id, original: text, enhanced: text, tags: [], createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-01T10:00:00.000Z' });
  function memoryServer() {
    const rows = new Map(); let seq = 0; const pushes = [];
    const put = (kind, item_id, payload, deleted = false) => {
      const key = `${kind}:${item_id}`; const version = (rows.get(key)?.version || 0) + 1;
      rows.set(key, { kind, item_id, payload, deleted, version, lamport: 1, change_seq: ++seq });
      return version;
    };
    const transport = {
      pull: async (cursor, limit) => [...rows.values()].filter(r => r.change_seq > cursor).sort((a, b) => a.change_seq - b.change_seq).slice(0, limit),
      push: async (device, items) => items.map((item) => {
        pushes.push(item);
        const key = `${item.kind}:${item.item_id}`; const current = rows.get(key);
        if ((current?.version || 0) !== Number(item.base_version)) return { kind: item.kind, item_id: item.item_id, status: 'conflict_lost', version: current.version };
        return { kind: item.kind, item_id: item.item_id, status: 'applied', version: put(item.kind, item.item_id, item.payload, item.deleted) };
      }),
      manifest: async () => [...rows.values()].map(({ kind, item_id, version }) => ({ kind, item_id, version })),
      fetchItems: async (keys) => keys.map(({ kind, item_id }) => rows.get(`${kind}:${item_id}`)).filter(Boolean),
    };
    return { put, transport, pushes };
  }
  const engineFor = (server) => createSyncEngine({ storage: localStorage, transport: server.transport, userId: 'user_A', deviceId: 'device-1', notifyWrite: notifyLocalWrite });
  const bootBoth = async () => {
    const library = await startLibraryJournal({ storage: localStorage, idb });
    stops.push(library.stop);
    const settings = await boot();
    return { library, settings };
  };
  const ids = () => JSON.parse(localStorage.getItem(storageKeys.library) || '[]').map(row => row.id).sort();
  const promptPushes = (server) => server.pushes.filter(item => item.kind === 'prompt');

  it('a lost Library commit restores the matching older shadow: no stale push, no delete', async () => {
    const server = memoryServer();
    server.put('prompt', 'a', { state: 'active', entry: entry('a', 'A') });
    localStorage.setItem(storageKeys.library, '[]');
    let journals = await bootBoth();
    await engineFor(server).syncOnce();
    await settle(journals.library);
    expect(ids()).toEqual(['a']);
    expect(Object.keys(idb.rows().get(LIBRARY_JOURNAL_RECORD).entries)).toContain(stateKey('user_A'));

    // Another device adds b; this device pulls it, but the journal commit fails.
    server.put('prompt', 'b', { state: 'active', entry: entry('b', 'B') });
    idb.state.failCommits = true;
    await engineFor(server).syncOnce();
    expect(ids()).toEqual(['a', 'b']);
    await Promise.resolve();
    await journals.library.journal.flush().catch(() => {});
    idb.state.failCommits = false;

    loseLocalStorage();
    journals = await bootBoth();
    expect(ids()).toEqual(['a']);
    const shadow = JSON.parse(localStorage.getItem(stateKey('user_A'))).shadow;
    expect(Object.keys(shadow).filter(key => key.startsWith('prompt:'))).toEqual(['prompt:a']);

    server.pushes.length = 0;
    await engineFor(server).syncOnce();
    expect(promptPushes(server)).toEqual([]);
    expect(ids()).toEqual(['a', 'b']);
  });

  it('control: a newer shadow paired with the older Library would push a delete', async () => {
    const server = memoryServer();
    server.put('prompt', 'a', { state: 'active', entry: entry('a', 'A') });
    server.put('prompt', 'b', { state: 'active', entry: entry('b', 'B') });
    localStorage.setItem(storageKeys.library, '[]');
    await engineFor(server).syncOnce();
    expect(ids()).toEqual(['a', 'b']);
    // What the split journals could restore: shadow knows b, the Library does not.
    localStorage.setItem(storageKeys.library, JSON.stringify(JSON.parse(localStorage.getItem(storageKeys.library)).filter(row => row.id === 'a')));
    server.pushes.length = 0;
    await engineFor(server).syncOnce();
    expect(promptPushes(server).some(item => item.item_id === 'b' && item.deleted)).toBe(true);
  });
});

describe('billing cache: plan and entitlement fields only', () => {
  const cached = {
    plan: 'pro', status: 'active', billingPeriod: 'monthly', productName: 'Prompt Lab Pro',
    lastValidatedAt: '2026-11-01T10:00:00.000Z', lastVerifiedAt: '2026-11-01T10:00:00.000Z',
    billingDisabled: false, checkoutDisabled: false,
    customerEmail: 'person@example.com', customerName: 'Pat Person', customerId: 'cus_FAKE123',
    subscriptionId: 'sub_FAKE123', priceId: 'price_FAKE123', manageUrl: 'https://billing.example.com/p/session/FAKE',
    validationError: 'Signed in as person@example.com', futureField: { address: '1 Main St' },
  };
  const personal = ['person@example.com', 'Pat Person', 'cus_FAKE123', 'sub_FAKE123', 'price_FAKE123', 'billing.example.com', '1 Main St'];

  it('journals only the entitlement fields', () => {
    const out = JSON.parse(journalValue('pl2-billing', JSON.stringify(cached)));
    expect(out).toEqual({
      plan: 'pro', status: 'active', billingPeriod: 'monthly', productName: 'Prompt Lab Pro',
      lastValidatedAt: '2026-11-01T10:00:00.000Z', lastVerifiedAt: '2026-11-01T10:00:00.000Z',
      billingDisabled: false, checkoutDisabled: false,
    });
  });

  it('never writes personal billing fields to IndexedDB, and restores the entitlement after Local Storage loss', async () => {
    const first = await boot();
    localStorage.setItem('pl2-billing', JSON.stringify(cached));
    await settle(first);
    const stored = JSON.stringify(record());
    for (const value of personal) expect(stored).not.toContain(value);
    loseLocalStorage();
    await boot();
    const restored = JSON.parse(localStorage.getItem('pl2-billing'));
    expect(restored.plan).toBe('pro');
    expect(restored.lastVerifiedAt).toBe(cached.lastVerifiedAt);
    for (const value of personal) expect(JSON.stringify(restored)).not.toContain(value);
  });

  it('keeps the live personal fields when a newer journaled entitlement replaces an older live copy', async () => {
    const first = await boot();
    localStorage.setItem('pl2-billing', JSON.stringify({ ...cached, plan: 'free', status: 'canceled' }));
    await settle(first);
    stopAll();
    const stamps = stampsOf();
    localStorage.setItem('pl2-billing', JSON.stringify(cached));
    localStorage.setItem(SETTINGS_JOURNAL_STAMPS_KEY, JSON.stringify({ 'pl2-billing': stamps['pl2-billing'] - 10 }));
    localStorage.removeItem(SETTINGS_JOURNAL_REVISION_KEY);
    await boot();
    const live = JSON.parse(localStorage.getItem('pl2-billing'));
    expect(live.plan).toBe('free');
    expect(live.status).toBe('canceled');
    expect(live.customerEmail).toBe('person@example.com');
  });
});
