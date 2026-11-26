import { describe, expect, it, vi } from 'vitest';
import { readSyncConfig } from '../lib/sync/syncConfig.js';
import { hashValue, stableStringify } from '../lib/sync/syncHash.js';
import { backoffDelay, createSyncQueue, MAX_DELAY_MS, QUEUE_CORRUPT_ERROR } from '../lib/sync/syncQueue.js';
import { applyRemoteRows, duplicateKey, mergeStructure, readLocalItems } from '../lib/sync/syncModel.js';
import { createSupabaseTransport, downloadAccountExport, exportAccountData } from '../lib/sync/supabaseTransport.js';
import { areUploadsSuspended, createSyncEngine, isKeptSeparate, KEPT_SEPARATE_KEY, OWNER_KEY, rememberKeptSeparate, rememberUploadsSuspended, UPLOADS_SUSPENDED_KEY } from '../lib/sync/syncEngine.js';

const memory = () => {
  const map = new Map();
  return { get length() { return map.size; }, key: (i) => [...map.keys()][i] ?? null, getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
};

describe('account sync flag', () => {
  it('is off by default and with a missing key or bad URL', () => {
    expect(readSyncConfig({}).enabled).toBe(false);
    expect(readSyncConfig().enabled).toBe(false);
    expect(readSyncConfig({ VITE_PL_ACCOUNT_SYNC: 'on', VITE_SUPABASE_URL: 'https://abc.supabase.co' }).enabled).toBe(false);
    expect(readSyncConfig({ VITE_PL_ACCOUNT_SYNC: 'on', VITE_SUPABASE_URL: 'https://evil.example.com', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x' }).enabled).toBe(false);
    expect(readSyncConfig({ VITE_PL_ACCOUNT_SYNC: 'yes', VITE_SUPABASE_URL: 'https://abc.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x' }).enabled).toBe(false);
  });
  it('turns on only with the flag, a Supabase URL and a publishable key', () => {
    expect(readSyncConfig({ VITE_PL_ACCOUNT_SYNC: 'on', VITE_SUPABASE_URL: 'https://abc.supabase.co/', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x' })).toMatchObject({ enabled: true, url: 'https://abc.supabase.co' });
  });
});

describe('sync hash', () => {
  it('ignores key order', () => {
    expect(stableStringify({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe('{"a":[1,{"c":3,"d":2}],"b":1}');
    expect(hashValue({ a: 1, b: 2 })).toBe(hashValue({ b: 2, a: 1 }));
    expect(hashValue({ a: 1 })).not.toBe(hashValue({ a: 2 }));
  });
});

describe('sync queue', () => {
  it('backs off exponentially with jitter and a 5 minute cap', () => {
    expect(backoffDelay(1, () => 0.5)).toBe(2000);
    expect(backoffDelay(3, () => 0.5)).toBe(8000);
    expect(backoffDelay(40, () => 1)).toBe(MAX_DELAY_MS * 1.2);
    expect(backoffDelay(1, () => 0)).toBe(1600);
  });
  it('persists entries and keeps a newer edit when an older push is acknowledged', () => {
    const storage = memory();
    const queue = createSyncQueue(storage, 'q');
    queue.put({ key: 'prompt:a', lamport: 1 });
    queue.put({ key: 'prompt:a', lamport: 2 });
    expect(createSyncQueue(storage, 'q').size()).toBe(1);
    expect(queue.acknowledge('prompt:a', 1)).toBe(false);
    queue.fail(['prompt:a'], 'offline', 1000, () => 0.5);
    expect(queue.due(1000)).toHaveLength(0);
    expect(queue.due(3000)).toHaveLength(1);
    expect(queue.acknowledge('prompt:a', 2)).toBe(true);
    expect(queue.size()).toBe(0);
  });

  it('keeps a corrupt outbox, stores a backup, and does not replace it on the next write', () => {
    const storage = memory();
    const raw = '{"prompt:a":';
    storage.setItem('q', raw);
    const queue = createSyncQueue(storage, 'q', { now: () => 1700000000000 });
    expect(queue.isCorrupt()).toBe(true);
    expect(queue.entries()).toEqual([]);
    expect(queue.put({ key: 'prompt:b', lamport: 2 })).toBe(false);
    expect(queue.acknowledge('prompt:a', 1)).toBe(false);
    expect(storage.getItem('q')).toBe(raw);
    expect(storage.getItem('q:corrupt:1700000000000')).toBe(raw);
    expect(queue.isCorrupt()).toBe(true);
    expect(storage.getItem('q:corrupt:1700000000000')).toBe(raw);
  });

  it('returns false when the outbox write hits quota instead of throwing', () => {
    const storage = memory();
    const queue = createSyncQueue(storage, 'q');
    queue.put({ key: 'prompt:a', lamport: 1 });
    storage.setItem = (key) => {
      if (key === 'q') {
        const error = new Error('quota');
        error.name = 'QuotaExceededError';
        throw error;
      }
    };
    expect(queue.put({ key: 'prompt:a', lamport: 2 })).toBe(false);
    expect(storage.getItem('q')).toContain('"lamport":1');
  });
});

describe('sync model', () => {
  it('does not sync the device-local Clear Library stamp, and restamps on apply', () => {
    const storage = memory();
    storage.setItem('pl2-library-clear:0000000000000001:abc', '1');
    storage.setItem('pl2-library', JSON.stringify([{ id: 'a', title: 'A', metadata: { libraryGeneration: '0000000000000001:abc' } }]));
    const items = readLocalItems(storage);
    expect(items.get('prompt:a').payload.entry.metadata).toEqual({});
    applyRemoteRows(storage, [{ kind: 'prompt', item_id: 'b', version: 1, payload: { state: 'active', entry: { id: 'b', title: 'B', metadata: { libraryGeneration: 'other' } } } }]);
    const stored = JSON.parse(storage.getItem('pl2-library')).find((entry) => entry.id === 'b');
    expect(stored.metadata.libraryGeneration).toBe('0000000000000001:abc');
  });
  it('keeps the applied remote copy newer than the local copy it replaces', () => {
    const storage = memory();
    storage.setItem('pl2-library', JSON.stringify([{ id: 'a', title: 'local', updatedAt: '2026-10-30T10:00:00.000Z' }]));
    applyRemoteRows(storage, [{ kind: 'prompt', item_id: 'a', version: 2, payload: { state: 'active', entry: { id: 'a', title: 'remote', updatedAt: '2026-10-30T09:00:00.000Z' } } }]);
    const [stored] = JSON.parse(storage.getItem('pl2-library'));
    expect(stored.title).toBe('remote');
    expect(Date.parse(stored.updatedAt)).toBeGreaterThan(Date.parse('2026-10-30T10:00:00.000Z'));
  });
  it('treats the same untouched starter-pack prompt as a duplicate', () => {
    const seed = { packId: 'p', seedPromptId: 's' };
    expect(duplicateKey({ id: '1', title: 'x', original: 'o', metadata: seed })).toBe(duplicateKey({ id: '2', title: 'x', original: 'o', metadata: seed }));
  });
  it('never treats a customized starter-pack copy as a duplicate (#277 review)', () => {
    const seed = { packId: 'p', seedPromptId: 's' };
    expect(duplicateKey({ id: '1', title: 'x', original: 'default', metadata: seed })).not.toBe(duplicateKey({ id: '2', title: 'x', original: 'my customized text', metadata: seed }));
  });
  it('merges folder trees without orphans or duplicate paths', () => {
    const merged = mergeStructure(
      { collections: ['A', 'B'], folders: [{ id: 'f1', collection: 'A' }, { id: 'f2', collection: 'A/B', parentId: 'f1' }, { id: 'f3', collection: 'C' }], loadedPacks: ['x'] },
      { collections: ['A'], folders: [{ id: 'r1', collection: 'A' }], loadedPacks: ['y'] },
    );
    expect(merged.folders.map((folder) => folder.id)).toEqual(['r1', 'f3']);
    expect(merged.collections).toEqual(['A', 'B']);
    expect(merged.loadedPacks).toEqual(['y', 'x']);
  });
});

describe('sync transport and engine', () => {
  it('sends the publishable key and the Clerk token, never anything else', async () => {
    const calls = [];
    const transport = createSupabaseTransport({ url: 'https://abc.supabase.co', publishableKey: 'sb_publishable_x', getToken: async () => 'clerk-token', fetchImpl: async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => [] }; } });
    await transport.pull(0, 10);
    expect(calls[0].url).toBe('https://abc.supabase.co/rest/v1/rpc/sync_pull');
    expect(calls[0].init.headers).toMatchObject({ apikey: 'sb_publishable_x', Authorization: 'Bearer clerk-token' });
  });
  it('does not apply a newer remote row when the unsynced local edit cannot be queued', async () => {
    const storage = memory();
    const local = { id: 'a', title: 'local edit', original: 'mine', updatedAt: '2026-11-26T12:00:00.000Z' };
    storage.setItem('pl2-library', JSON.stringify([local]));
    storage.setItem(OWNER_KEY, 'user_1');
    storage.setItem('pl2-sync-state:user_1', JSON.stringify({
      initialized: true,
      cursor: 1,
      clock: 1,
      lastManifestAt: Date.now(),
      shadow: { 'prompt:a': { version: 1, hash: 'previous-sync' } },
      oversize: {},
      lost: {},
    }));
    const write = storage.setItem.bind(storage);
    storage.setItem = (key, value) => {
      if (key === 'pl2-sync-queue:user_1') {
        const error = new Error('quota');
        error.name = 'QuotaExceededError';
        throw error;
      }
      write(key, value);
    };
    const calls = [];
    const transport = {
      pull: async () => {
        calls.push('pull');
        return [{
          kind: 'prompt',
          item_id: 'a',
          version: 2,
          change_seq: 2,
          deleted: false,
          lamport: 2,
          payload: { state: 'active', entry: { id: 'a', title: 'remote', original: 'theirs', updatedAt: '2026-11-26T13:00:00.000Z' } },
        }];
      },
      push: async () => { calls.push('push'); return []; },
      manifest: async () => [],
      fetchItems: async () => [],
    };
    const result = await createSyncEngine({ storage, transport, userId: 'user_1', deviceId: 'd' }).syncOnce();
    expect(calls).toEqual(['pull']);
    expect(result.status).toBe('error');
    expect(result.error).toBe('Pending changes could not be saved');
    expect(JSON.parse(storage.getItem('pl2-library'))).toEqual([local]);
  });

  it('does not discard a corrupt outbox when a sync runs', async () => {
    const storage = memory();
    const raw = '{"prompt:a":';
    storage.setItem('pl2-sync-queue:user_1', raw);
    const transport = createSupabaseTransport({
      url: 'https://abc.supabase.co',
      publishableKey: 'k',
      getToken: async () => 'token',
      fetchImpl: async () => { throw new Error('should not fetch'); },
    });
    const result = await createSyncEngine({ storage, transport, userId: 'user_1', deviceId: 'd' }).syncOnce();
    expect(result).toMatchObject({ status: 'error', queueCorrupt: true, error: QUEUE_CORRUPT_ERROR, pending: 0 });
    expect(storage.getItem('pl2-sync-queue:user_1')).toBe(raw);
    const backupKey = Array.from({ length: storage.length }, (_, index) => storage.key(index))
      .find((key) => key.startsWith('pl2-sync-queue:user_1:corrupt:'));
    expect(storage.getItem(backupKey)).toBe(raw);
  });

  it('reports signed-out status without a token and leaves local data alone', async () => {
    const storage = memory();
    storage.setItem('pl2-library', JSON.stringify([{ id: 'a', title: 'A' }]));
    const transport = createSupabaseTransport({ url: 'https://abc.supabase.co', publishableKey: 'k', getToken: async () => null, fetchImpl: async () => { throw new Error('should not fetch'); } });
    const result = await createSyncEngine({ storage, transport, userId: 'user_1', deviceId: 'd' }).syncOnce();
    expect(result.status).toBe('auth');
    expect(JSON.parse(storage.getItem('pl2-library'))).toEqual([{ id: 'a', title: 'A' }]);
  });

  it('deletes synced data with an empty body so only the signed-in user is erased', async () => {
    const calls = [];
    const transport = createSupabaseTransport({
      url: 'https://abc.supabase.co',
      publishableKey: 'k',
      getToken: async () => 'token-A',
      fetchImpl: async (url, init) => {
        calls.push({ url, body: init.body });
        return { ok: true, status: 200, json: async () => ({ items: 2, conflicts: 1 }) };
      },
    });
    const result = await transport.deleteMyData();
    expect(result).toEqual({ items: 2, conflicts: 1 });
    expect(calls).toEqual([{ url: 'https://abc.supabase.co/rest/v1/rpc/sync_delete_my_data', body: '{}' }]);
    expect(calls[0].body).not.toContain('user_');
  });

  it('exports the signed-in account rows as a JSON download', async () => {
    const transport = {
      pull: async () => [{ kind: 'prompt', item_id: 'p1', change_seq: 1, payload: { entry: { id: 'p1' } } }],
      listConflicts: async () => [],
    };
    const data = await exportAccountData(transport);
    const clicks = [];
    const json = downloadAccountExport(data, {
      createUrl: () => 'blob:synced',
      revoke: () => {},
      click: (anchor) => clicks.push({ download: anchor.download, href: anchor.href }),
    });
    expect(clicks).toEqual([{ download: 'prompt-lab-synced-library.json', href: 'blob:synced' }]);
    const parsed = JSON.parse(json);
    expect(parsed.format).toBe('prompt-lab-account-export');
    expect(parsed.items).toHaveLength(1);
    expect(parsed.conflicts).toEqual([]);
  });
});

describe('keep separate', () => {
  it('records the signed-in account and leaves the local Library and its owner untouched', () => {
    const storage = memory();
    storage.setItem('pl2-library', JSON.stringify([{ id: 'p1', title: 'Stay' }]));
    storage.setItem(OWNER_KEY, 'user_A');
    expect(rememberKeptSeparate(storage, 'user_B')).toBe(true);
    expect(isKeptSeparate(storage, 'user_B')).toBe(true);
    expect(isKeptSeparate(storage, 'user_A')).toBe(false);
    expect(storage.getItem(KEPT_SEPARATE_KEY)).toBe('user_B');
    expect(storage.getItem(OWNER_KEY)).toBe('user_A');
    expect(JSON.parse(storage.getItem('pl2-library'))).toEqual([{ id: 'p1', title: 'Stay' }]);
  });
});

describe('uploads suspended after deleting synced data', () => {
  const prompt = { id: 'p1', title: 'Stay', updatedAt: '2026-11-23T00:00:00.000Z', original: 'keep me' };

  it('does not read or upload, and drops the outbox, while uploads are suspended', async () => {
    const storage = memory();
    storage.setItem('pl2-library', JSON.stringify([prompt]));
    storage.setItem('pl2-sync-queue:user_A', JSON.stringify({
      'prompt:p1': { key: 'prompt:p1', kind: 'prompt', item_id: 'p1', lamport: 1, base_version: 0, payload: { state: 'active', entry: prompt }, nextAttemptAt: 0 },
    }));
    rememberUploadsSuspended(storage, 'user_A');
    const transport = {
      manifest: async () => { throw new Error('manifest'); },
      pull: async () => { throw new Error('pull'); },
      push: async () => { throw new Error('push'); },
      fetchItems: async () => { throw new Error('fetch'); },
    };
    const engine = createSyncEngine({ storage, transport, userId: 'user_A' });
    await expect(engine.syncOnce()).resolves.toMatchObject({ status: 'uploads-suspended', pushed: 0, pending: 0 });
    expect(engine.pendingCount()).toBe(0);
    expect(JSON.parse(storage.getItem('pl2-library'))).toEqual([prompt]);
    expect(areUploadsSuspended(storage, 'user_A')).toBe(true);
  });

  it('does not send a push when the suspension lands while the first pull is in flight', async () => {
    const storage = memory();
    storage.setItem('pl2-library', JSON.stringify([prompt]));
    let release = () => {};
    const gate = new Promise((resolve) => { release = resolve; });
    const calls = [];
    const transport = {
      pull: async () => { calls.push('pull'); await gate; return []; },
      push: async () => { calls.push('push'); return []; },
      manifest: async () => [],
      fetchItems: async () => [],
    };
    const engine = createSyncEngine({ storage, transport, userId: 'user_A' });
    const run = engine.syncOnce();
    await vi.waitFor(() => expect(calls).toEqual(['pull']));
    rememberUploadsSuspended(storage, 'user_A');
    release();
    await expect(run).resolves.toMatchObject({ status: 'uploads-suspended', pushed: 0 });
    expect(calls).toEqual(['pull']);
    expect(JSON.parse(storage.getItem('pl2-library'))).toEqual([prompt]);
    expect(storage.getItem(UPLOADS_SUSPENDED_KEY)).toBe('user_A');
  });
});

import { requestSignInTicket, resumeDesktopSession, signInWithBrowser, signOutDesktop } from '../lib/sync/desktopAuth.js';
import { readLocalSnapshot, restoreLocalSnapshot, takeLocalSnapshot } from '../lib/sync/syncBackup.js';
import { pageMayContinue, statusForError } from '../lib/sync/syncEngine.js';
import { publishAccountAuth, readAccountAuth, subscribeAccountAuth } from '../lib/sync/accountAuthBridge.js';

describe('desktop PKCE sign-in (R-04: secrets stay in Rust)', () => {
  it('only uses the Rust sign-in commands; the webview never handles the code, verifier or refresh token', async () => {
    const calls = [];
    let opened = '';
    const invoke = async (command, args) => {
      calls.push([command, args]);
      if (command === 'account_oauth_begin') return 'https://clerk.promptlab.tools/oauth/authorize?client_id=cid&state=s';
      if (command === 'account_oauth_finish') return { access_token: 'at1', expires_in: 60 };
      if (command === 'account_access_token') return null;
      if (command === 'account_sign_out') return null;
      throw new Error(`unexpected command ${command}`);
    };
    const before = JSON.stringify({ ...localStorage });
    const session = await signInWithBrowser({ invoke, openUrl: async (url) => { opened = url; }, clientId: 'cid' });
    expect(session).toEqual({ accessToken: 'at1', expiresIn: 60 });
    expect(opened).toMatch(/^https:\/\/clerk\.promptlab\.tools\/oauth\/authorize\?/);
    expect(calls.map(([command]) => command)).toEqual(['account_oauth_begin', 'account_oauth_finish']);
    expect(calls[0][1]).toEqual({ clientId: 'cid' });
    expect(JSON.stringify(calls)).not.toMatch(/refresh|verifier|code=/);
    expect(JSON.stringify({ ...localStorage })).toBe(before);
    expect(await resumeDesktopSession({ invoke, clientId: 'cid' })).toBeNull();
    await signOutDesktop({ invoke });
    expect(calls.map(([command]) => command).filter((command) => /secret/.test(command))).toEqual([]);
  });
  it('maps a refreshed token, and treats a failed refresh as signed out', async () => {
    expect(await resumeDesktopSession({ invoke: async () => ({ access_token: 'at2', expires_in: 30 }), clientId: 'cid' })).toEqual({ accessToken: 'at2', expiresIn: 30 });
    expect(await resumeDesktopSession({ invoke: async () => { throw new Error('keychain unavailable'); }, clientId: 'cid' })).toBeNull();
    await expect(signInWithBrowser({ invoke: undefined, openUrl: async () => {}, clientId: 'cid' })).rejects.toThrow(/unavailable/);
    await expect(signInWithBrowser({ invoke: async (c) => (c === 'account_oauth_begin' ? 'https://clerk.promptlab.tools/x' : {}), openUrl: async () => {}, clientId: 'cid' })).rejects.toThrow(/no access token/);
  });
  it('exchanges the access token for a one-time ticket at the bridge', async () => {
    const seen = [];
    const ticket = await requestSignInTicket({ accessToken: 'at1', fetchImpl: async (url, init) => { seen.push([url, init.headers.Authorization]); return { ok: true, json: async () => ({ ticket: 't1' }) }; } });
    expect(ticket).toBe('t1');
    expect(seen).toEqual([['https://promptlab.tools/api/sync/desktop-token', 'Bearer at1']]);
  });
});

describe('pull paging (R-01b response cap)', () => {
  it('continues on a full page or a server-truncated page only', () => {
    expect(pageMayContinue([], 500)).toBe(false);
    expect(pageMayContinue([{ change_seq: 1 }], 500)).toBe(false);
    expect(pageMayContinue([{ change_seq: 1, page_truncated: false }], 500)).toBe(false);
    expect(pageMayContinue([{ change_seq: 1 }, { change_seq: 2, page_truncated: true }], 500)).toBe(true);
    expect(pageMayContinue(Array.from({ length: 500 }, (_, i) => ({ change_seq: i })), 500)).toBe(true);
  });
});

describe('sync backup, statuses and auth bridge', () => {
  it('snapshot restore merges and never removes current prompts', () => {
    const storage = memory();
    storage.setItem('pl2-library', JSON.stringify([{ id: 'a', title: 'old', updatedAt: '2026-10-01T00:00:00Z' }, { id: 'b', title: 'B' }]));
    takeLocalSnapshot(storage, 'user_1', { reason: 'first-sync' });
    storage.setItem('pl2-library', JSON.stringify([{ id: 'a', title: 'new', updatedAt: '2026-10-30T00:00:00Z' }, { id: 'c', title: 'C' }]));
    restoreLocalSnapshot(storage, readLocalSnapshot(storage, 'user_1'));
    const library = JSON.parse(storage.getItem('pl2-library'));
    expect(library.map((entry) => `${entry.id}:${entry.title}`).sort()).toEqual(['a:new', 'b:B', 'c:C']);
    expect(() => restoreLocalSnapshot(storage, { format: 'x' })).toThrow(/backup/);
  });
  it('maps server errors to statuses', () => {
    expect([401, 403, 413, 429, 503, 400, 0, 500].map((status) => statusForError({ status }))).toEqual(['auth', 'auth', 'quota', 'throttled', 'paused', 'error', 'offline', 'offline']);
  });
  it('publishes sign-in state to subscribers', () => {
    const seen = [];
    const stop = subscribeAccountAuth((value) => seen.push(value.userId));
    publishAccountAuth({ userId: 'user_ext', surface: 'extension' });
    stop();
    publishAccountAuth({ userId: '' });
    expect(seen).toEqual(['user_ext']);
    expect(readAccountAuth().userId).toBe('');
  });
});

import { createClerkSessionStorageCache } from '../lib/sync/clerkSessionStorage.js';

describe('extension Clerk token cache (re-review LOW)', () => {
  it('uses chrome.storage.session, restricted to trusted contexts, never chrome.storage.local', async () => {
    const data = {};
    const levels = [];
    const session = {
      get: async (key) => ({ [key]: data[key] }),
      set: async (obj) => { Object.assign(data, obj); },
      remove: async (key) => { delete data[key]; },
      setAccessLevel: async (opts) => { levels.push(opts.accessLevel); },
    };
    const local = { get: vi.fn(), set: vi.fn(), remove: vi.fn() };
    const previous = globalThis.chrome;
    globalThis.chrome = { storage: { session, local } };
    try {
      const cache = createClerkSessionStorageCache();
      expect(cache.kind).toBe('session');
      const key = cache.createKey('clerk.promptlab.tools', '__clerk_client_jwt', 'v2');
      expect(key).toBe('clerk.promptlab.tools|__clerk_client_jwt|v2');
      await cache.set(key, 'jwt-1');
      expect(await cache.get(key)).toBe('jwt-1');
      await cache.remove(key);
      expect(await cache.get(key)).toBeUndefined();
      expect(levels).toEqual(['TRUSTED_CONTEXTS']);
      expect(local.set).not.toHaveBeenCalled();
      expect(local.get).not.toHaveBeenCalled();
    } finally {
      globalThis.chrome = previous;
    }
  });
  it('falls back to memory, not local storage, without chrome.storage.session', async () => {
    const cache = createClerkSessionStorageCache(null);
    expect(cache.kind).toBe('memory');
    await cache.set('k', 'v');
    expect(await cache.get('k')).toBe('v');
  });
});

describe('supabase transport reads (R-01b)', () => {
  it('lists conflicts through the RPC, not a table select', async () => {
    const seen = [];
    const transport = createSupabaseTransport({ url: 'https://abc.supabase.co', publishableKey: 'k', getToken: async () => 'tok',
      fetchImpl: async (url, init) => { seen.push([url, init.method, init.body]); return { ok: true, status: 200, json: async () => [] }; } });
    await transport.listConflicts();
    expect(seen).toEqual([['https://abc.supabase.co/rest/v1/rpc/sync_list_conflicts', 'POST', JSON.stringify({ p_limit: 100 })]]);
  });
});

describe('supabase transport refusals (R-08)', () => {
  const make = (response) => createSupabaseTransport({ url: 'https://abc.supabase.co', publishableKey: 'k', getToken: async () => 'tok', fetchImpl: async () => response });
  it('turns a refusal returned as data into a status error with the server message', async () => {
    const transport = make({ ok: false, status: 429, json: async () => ({ error: 'daily sync download budget used', code: 'PT429', status: 429 }) });
    await expect(transport.push('dev', [])).rejects.toMatchObject({ status: 429, message: 'daily sync download budget used' });
  });
  it('treats an empty refused read page as an error, not as "no changes"', async () => {
    const transport = make({ ok: false, status: 429, json: async () => [] });
    await expect(transport.pull(0, 500)).rejects.toMatchObject({ status: 429 });
  });
});


import { batchesWithinBytes, MAX_PUSH_BYTES } from '../lib/sync/syncEngine.js';

describe('push batches (#277 review P2)', () => {
  it('splits by serialized bytes as well as item count', () => {
    const big = (i) => ({ entry: { key: `prompt:${i}` }, wire: { item_id: String(i), payload: 'x'.repeat(200 * 1024) } });
    const batches = batchesWithinBytes(Array.from({ length: 12 }, (_, i) => big(i)));
    expect(batches.length).toBeGreaterThan(1);
    for (const batch of batches) expect(new TextEncoder().encode(JSON.stringify(batch.map((item) => item.wire))).length).toBeLessThanOrEqual(MAX_PUSH_BYTES + 64 * 1024);
    expect(batches.flat().length).toBe(12);
    const small = batchesWithinBytes(Array.from({ length: 250 }, (_, i) => ({ entry: {}, wire: { i } })));
    expect(small.map((batch) => batch.length)).toEqual([100, 100, 50]);
  });
});
