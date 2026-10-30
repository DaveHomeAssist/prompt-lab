import { describe, expect, it } from 'vitest';
import { readSyncConfig } from '../lib/sync/syncConfig.js';
import { hashValue, stableStringify } from '../lib/sync/syncHash.js';
import { backoffDelay, createSyncQueue, MAX_DELAY_MS } from '../lib/sync/syncQueue.js';
import { applyRemoteRows, duplicateKey, mergeStructure, readLocalItems } from '../lib/sync/syncModel.js';
import { createSupabaseTransport } from '../lib/sync/supabaseTransport.js';
import { createSyncEngine } from '../lib/sync/syncEngine.js';

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
  it('treats the same starter-pack prompt as a duplicate', () => {
    expect(duplicateKey({ id: '1', metadata: { packId: 'p', seedPromptId: 's' } })).toBe(duplicateKey({ id: '2', title: 'x', metadata: { packId: 'p', seedPromptId: 's' } }));
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
  it('reports signed-out status without a token and leaves local data alone', async () => {
    const storage = memory();
    storage.setItem('pl2-library', JSON.stringify([{ id: 'a', title: 'A' }]));
    const transport = createSupabaseTransport({ url: 'https://abc.supabase.co', publishableKey: 'k', getToken: async () => null, fetchImpl: async () => { throw new Error('should not fetch'); } });
    const result = await createSyncEngine({ storage, transport, userId: 'user_1', deviceId: 'd' }).syncOnce();
    expect(result.status).toBe('auth');
    expect(JSON.parse(storage.getItem('pl2-library'))).toEqual([{ id: 'a', title: 'A' }]);
  });
});

import { buildAuthorizeUrl, createKeychain, createPkcePair, parseCallback, resumeDesktopSession, signInWithBrowser } from '../lib/sync/desktopAuth.js';
import { readLocalSnapshot, restoreLocalSnapshot, takeLocalSnapshot } from '../lib/sync/syncBackup.js';
import { statusForError } from '../lib/sync/syncEngine.js';
import { publishAccountAuth, readAccountAuth, subscribeAccountAuth } from '../lib/sync/accountAuthBridge.js';

describe('desktop PKCE sign-in', () => {
  it('uses S256 over a high-entropy verifier and a random state', async () => {
    const { verifier, challenge, state } = await createPkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    const expected = btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(challenge).toBe(expected);
    expect(state).not.toBe((await createPkcePair()).state);
    const url = new URL(buildAuthorizeUrl({ clientId: 'cid', redirectUri: 'http://127.0.0.1:5000/callback', challenge, state }));
    expect(url.origin).toBe('https://clerk.promptlab.tools');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ response_type: 'code', code_challenge_method: 'S256', code_challenge: challenge, state });
  });
  it('rejects a callback with the wrong state or an error', () => {
    expect(parseCallback('?code=abc&state=s1', 's1')).toBe('abc');
    expect(() => parseCallback('?code=abc&state=evil', 's1')).toThrow(/did not match/);
    expect(() => parseCallback('?error=access_denied&state=s1', 's1')).toThrow(/cancelled/);
    expect(() => createKeychain(undefined)).toThrow(/keychain/);
  });
  it('keeps the refresh token in the keychain only, never in web storage', async () => {
    const keychain = new Map();
    let openedUrl = '';
    const invoke = async (command, args) => {
      if (command === 'account_oauth_listen') return 50123;
      if (command === 'account_oauth_wait') return `code=code1&state=${new URL(openedUrl).searchParams.get('state')}`;
      if (command === 'account_secret_set') { keychain.set(args.name, args.value); return null; }
      if (command === 'account_secret_get') return keychain.get(args.name) ?? null;
      if (command === 'account_secret_delete') { keychain.delete(args.name); return null; }
      throw new Error(command);
    };
    const bodies = [];
    const fetchImpl = async (url, init) => { bodies.push(Object.fromEntries(new URLSearchParams(init.body))); return { ok: true, json: async () => ({ access_token: 'at1', refresh_token: 'rt1', expires_in: 60 }) }; };
    const before = JSON.stringify({ ...localStorage });
    const session = await signInWithBrowser({ invoke, openUrl: async (url) => { openedUrl = url; }, clientId: 'cid', fetchImpl });
    expect(session.accessToken).toBe('at1');
    expect(keychain.get('clerk_refresh_token')).toBe('rt1');
    expect(bodies[0]).toMatchObject({ grant_type: 'authorization_code', code: 'code1', redirect_uri: 'http://127.0.0.1:50123/callback' });
    expect(bodies[0].code_verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify({ ...localStorage })).toBe(before);
    const revoked = await resumeDesktopSession({ invoke, clientId: 'cid', fetchImpl: async () => ({ ok: false, status: 400 }) });
    expect(revoked).toBeNull();
    expect(keychain.has('clerk_refresh_token')).toBe(false);
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
