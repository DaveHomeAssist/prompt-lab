import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  SETTINGS_JOURNAL_RECORD, SETTINGS_JOURNAL_REVISION_KEY, SETTINGS_JOURNAL_STAMPS_KEY,
  isSettingsJournalKey, journalValue, startSettingsJournal,
} from '../lib/settingsJournal.js';
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

const SYNC = {
  'pl2-sync-device-id': 'device-1',
  'pl2-sync-owner': 'user_A',
  'pl2-sync-state:user_A': JSON.stringify({ initialized: true, cursor: 42, clock: 7 }),
  'pl2-sync-queue:user_A': '[]',
};

beforeEach(() => { localStorage.clear(); idb = createFakeIndexedDb(); });
afterEach(stopAll);

describe('desktop settings journal', () => {
  it('restores pl2-sync-* keys, provider settings, billing cache and consent after Local Storage loss', async () => {
    const first = await boot();
    for (const [key, value] of Object.entries(SYNC)) localStorage.setItem(key, value);
    localStorage.setItem('pl2-provider-settings', JSON.stringify({ provider: 'ollama', ollamaBaseUrl: 'http://127.0.0.1:11434', ollamaModel: 'm' }));
    localStorage.setItem('pl2-billing', JSON.stringify({ plan: 'pro', status: 'active' }));
    localStorage.setItem('pl_telemetry_consent', 'denied');
    await settle(first);

    loseLocalStorage();
    const { outcome } = await boot();
    expect(outcome.action).toBe('restore');
    for (const [key, value] of Object.entries(SYNC)) expect(localStorage.getItem(key)).toBe(value);
    expect(JSON.parse(localStorage.getItem('pl2-provider-settings'))).toMatchObject({ provider: 'ollama', ollamaModel: 'm' });
    expect(JSON.parse(localStorage.getItem('pl2-billing')).plan).toBe('pro');
    expect(localStorage.getItem('pl_telemetry_consent')).toBe('denied');
  });

  it('keeps a live value that is newer than the journal', async () => {
    const first = await boot();
    localStorage.setItem('pl2-sync-owner', 'user_A');
    localStorage.setItem('pl2-sync-state:user_A', '{"cursor":1}');
    await settle(first);
    stopAll();
    // A later write reached Local Storage but its journal commit never finished.
    const stamps = JSON.parse(localStorage.getItem(SETTINGS_JOURNAL_STAMPS_KEY));
    localStorage.setItem('pl2-sync-state:user_A', '{"cursor":9}');
    localStorage.setItem(SETTINGS_JOURNAL_STAMPS_KEY, JSON.stringify({ ...stamps, 'pl2-sync-state:user_A': stamps['pl2-sync-state:user_A'] + 5000 }));
    localStorage.removeItem(SETTINGS_JOURNAL_REVISION_KEY); // force the restore path
    // A live value with no stamp at all is also kept: it cannot be proven older.
    localStorage.setItem('pl2-sync-device-id', 'device-live');
    record().entries['pl2-sync-device-id'] = 'device-journal';

    const started = await boot();
    expect(started.outcome.action).toBe('restore');
    expect(localStorage.getItem('pl2-sync-state:user_A')).toBe('{"cursor":9}');
    expect(localStorage.getItem('pl2-sync-device-id')).toBe('device-live');
    expect(localStorage.getItem('pl2-sync-owner')).toBe('user_A');
    await settle(started);
    expect(record().entries['pl2-sync-state:user_A']).toBe('{"cursor":9}');
  });

  it('replaces an older live value when the journal holds a newer write', async () => {
    const first = await boot();
    localStorage.setItem('pl2-sync-state:user_A', '{"cursor":1}');
    await settle(first);
    const older = JSON.parse(localStorage.getItem(SETTINGS_JOURNAL_STAMPS_KEY))['pl2-sync-state:user_A'];
    localStorage.setItem('pl2-sync-state:user_A', '{"cursor":2}');
    await settle(first);
    stopAll();
    // Local Storage dropped the last write and its stamp, reverting to cursor 1.
    localStorage.setItem('pl2-sync-state:user_A', '{"cursor":1}');
    localStorage.setItem(SETTINGS_JOURNAL_STAMPS_KEY, JSON.stringify({ 'pl2-sync-state:user_A': older }));
    localStorage.removeItem(SETTINGS_JOURNAL_REVISION_KEY);
    await boot();
    expect(localStorage.getItem('pl2-sync-state:user_A')).toBe('{"cursor":2}');
  });

  it('never journals secrets and keeps live secrets when restoring provider settings', async () => {
    const first = await boot();
    localStorage.setItem('pl2-provider-settings', JSON.stringify({
      provider: 'anthropic', apiKey: 'sk-ant-SECRET', openaiApiKey: 'sk-SECRET2', geminiApiKey: 'g-SECRET3',
      openrouterApiKey: 'or-SECRET4', anthropicModel: 'claude', ollamaBaseUrl: 'http://127.0.0.1:11434',
    }));
    await settle(first);
    const stored = JSON.stringify(record());
    for (const secret of ['sk-ant-SECRET', 'sk-SECRET2', 'g-SECRET3', 'or-SECRET4']) expect(stored).not.toContain(secret);
    expect(JSON.parse(record().entries['pl2-provider-settings'])).toEqual({ provider: 'anthropic', anthropicModel: 'claude', ollamaBaseUrl: 'http://127.0.0.1:11434' });

    loseLocalStorage();
    await boot();
    const restored = JSON.parse(localStorage.getItem('pl2-provider-settings'));
    expect(restored).toEqual({ provider: 'anthropic', anthropicModel: 'claude', ollamaBaseUrl: 'http://127.0.0.1:11434' });

    expect(journalValue('pl2-sync-owner', 'sk_live_raw')).toBeNull();
    expect(journalValue('pl2-provider-settings', 'not json')).toBeNull();
  });

  it('journals only the allowlist and leaves the pre-merge snapshot out', async () => {
    const first = await boot();
    localStorage.setItem('pl2-sync-snapshot:user_A', '{"big":true}');
    localStorage.setItem('pl2-library', '[]');
    localStorage.setItem('pl2-sync-owner', 'user_A');
    await settle(first);
    const keys = Object.keys(record().entries).filter(key => key !== '__stamps');
    expect(keys).toEqual(['pl2-sync-owner']);
    expect(isSettingsJournalKey('pl2-sync-snapshot:user_A')).toBe(false);
    expect(isSettingsJournalKey('pl2-sync-conflicts-unseen:user_A')).toBe(true);
    expect(sessionStorage.getItem(SETTINGS_JOURNAL_STAMPS_KEY)).toBeNull();
  });

  it('does not bring back a key that was removed', async () => {
    const first = await boot();
    localStorage.setItem('pl2-sync-owner', 'user_A');
    await settle(first);
    localStorage.removeItem('pl2-sync-owner');
    await settle(first);
    loseLocalStorage();
    await boot();
    expect(localStorage.getItem('pl2-sync-owner')).toBeNull();
  });

  it('restores the Storage methods when stopped', async () => {
    const before = Storage.prototype.setItem;
    const started = await boot();
    expect(Storage.prototype.setItem).not.toBe(before);
    stopAll();
    expect(Storage.prototype.setItem).toBe(before);
    expect(started.outcome.action).toBeDefined();
  });
});
