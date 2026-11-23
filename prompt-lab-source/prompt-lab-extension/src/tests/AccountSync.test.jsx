import { describe, expect, it, vi, afterEach } from 'vitest';
import { act, fireEvent, render, renderHook, screen, waitFor, cleanup } from '@testing-library/react';
import { AccountSyncBar, AccountSyncPanel, describeSyncStatus } from '../AccountSync.jsx';
import { addUnseenConflicts, clearUnseenConflicts, readUnseenConflicts, restoreConflictCopy, readRestoredConflictIds } from '../lib/sync/syncConflicts.js';
import useAccountSync from '../hooks/useAccountSync.js';
import { T } from '../constants.js';

const m = T.dark;
const base = { enabled: true, signedIn: true, pending: 0, conflicts: 0, listConflicts: async () => [], restoreConflict: vi.fn(), syncNow: vi.fn() };
afterEach(() => { cleanup(); window.localStorage.clear(); });

describe('account sync UI', () => {
  it('renders nothing while the flag is off', () => {
    const { container } = render(<><AccountSyncBar sync={{ status: 'off', enabled: false }} m={m} onOpen={() => {}} /><AccountSyncPanel sync={{ status: 'off', enabled: false }} m={m} open onClose={() => {}} /></>);
    expect(container.innerHTML).toBe('');
  });

  it('shows a sign-in prompt when signed out', () => {
    const onSignIn = vi.fn();
    render(<AccountSyncBar sync={{ ...base, signedIn: false, status: 'signed-out' }} m={m} onOpen={() => {}} onSignIn={onSignIn} />);
    expect(screen.getByText('Sync is off on this device')).toBeTruthy();
    fireEvent.click(screen.getByText('Sign in to sync'));
    expect(onSignIn).toHaveBeenCalled();
  });

  it('shows status, pending changes and conflict counts', () => {
    render(<AccountSyncBar sync={{ ...base, status: 'synced', at: Date.now(), conflicts: 2 }} m={m} onOpen={() => {}} />);
    expect(screen.getByText('Synced just now')).toBeTruthy();
    expect(screen.getByTestId('sync-conflicts-link').textContent).toBe('2 conflict copies');
    expect(describeSyncStatus({ status: 'offline', pending: 3 }).detail).toMatch(/3 changes waiting/);
  });

  it('blocks a different account on this device and uploads nothing', async () => {
    const listConflicts = vi.fn(async () => []);
    render(<AccountSyncPanel sync={{ ...base, status: 'owner-mismatch', listConflicts }} m={m} open onClose={() => {}} onSignOut={() => {}} />);
    expect(screen.getByTestId('sync-owner-mismatch').textContent).toMatch(/different account/);
    expect(screen.queryByText('Sync now')).toBeNull();
    expect(listConflicts).not.toHaveBeenCalled();
  });

  it('lists conflict copies and restores one', async () => {
    const copy = { id: 7, kind: 'prompt', item_id: 'p1', losing_payload: { state: 'active', entry: { id: 'p1', title: 'Laptop edit', original: 'from the laptop' } }, losing_deleted: false, created_at: '2026-11-01T10:00:00Z' };
    const restoreConflict = vi.fn();
    render(<AccountSyncPanel sync={{ ...base, status: 'synced', listConflicts: async () => [copy], restoreConflict }} m={m} open onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('Laptop edit')).toBeTruthy());
    fireEvent.click(screen.getByText('Restore this copy'));
    expect(restoreConflict).toHaveBeenCalledWith(copy);
    expect(screen.getByText('Restored')).toBeTruthy();
  });

  it('keeps a visible "N conflict copies" link until the list is opened, and it opens the list', async () => {
    const onOpen = vi.fn();
    // Later syncs report 0 new conflicts, but the copies kept earlier still show.
    const { rerender } = render(<AccountSyncBar sync={{ ...base, status: 'offline', conflicts: 0, unseenConflicts: 1 }} m={m} onOpen={onOpen} />);
    const link = screen.getByTestId('sync-conflicts-link');
    expect(link.textContent).toBe('1 conflict copy');
    fireEvent.click(link);
    expect(onOpen).toHaveBeenCalledWith('conflicts');
    fireEvent.click(screen.getByText('Sync details'));
    expect(onOpen).toHaveBeenLastCalledWith();
    rerender(<AccountSyncBar sync={{ ...base, status: 'synced', conflicts: 0, unseenConflicts: 0 }} m={m} onOpen={onOpen} />);
    expect(screen.queryByTestId('sync-conflicts-link')).toBeNull();
    rerender(<AccountSyncBar sync={{ ...base, status: 'owner-mismatch', unseenConflicts: 3 }} m={m} onOpen={onOpen} />);
    expect(screen.queryByTestId('sync-conflicts-link')).toBeNull();
  });

  it('opened from the link, the panel focuses the conflict list and marks the copies seen', async () => {
    const copy = { id: 9, kind: 'prompt', item_id: 'p2', losing_payload: { state: 'active', entry: { id: 'p2', title: 'Desktop edit', original: 'x' } }, losing_deleted: false, created_at: '2026-11-01T10:00:00Z' };
    const markConflictsSeen = vi.fn();
    render(<AccountSyncPanel sync={{ ...base, status: 'synced', listConflicts: async () => [copy], markConflictsSeen }} m={m} open focus="conflicts" onClose={() => {}} />);
    expect(document.activeElement?.id).toBe('sync-conflicts-title');
    await waitFor(() => expect(screen.getByText('Desktop edit')).toBeTruthy());
    expect(markConflictsSeen).toHaveBeenCalled();
  });

  it('counts unseen conflict copies per account on the device', () => {
    const s = window.localStorage;
    expect(readUnseenConflicts(s, 'user_A')).toBe(0);
    expect(addUnseenConflicts(s, 'user_A', 2)).toBe(2);
    expect(addUnseenConflicts(s, 'user_A', 1)).toBe(3);
    expect(readUnseenConflicts(s, 'user_B')).toBe(0);
    clearUnseenConflicts(s, 'user_A');
    expect(readUnseenConflicts(s, 'user_A')).toBe(0);
  });

  it('never throws from the display-only counter when storage fails (Codex P2)', () => {
    const quota = () => { throw new DOMException('full', 'QuotaExceededError'); };
    const full = { getItem: () => '1', setItem: quota, removeItem: quota };
    expect(addUnseenConflicts(full, 'user_A', 2)).toBe(3);
    expect(() => clearUnseenConflicts(full, 'user_A')).not.toThrow();
    const broken = { getItem: quota, setItem: quota, removeItem: quota };
    expect(readUnseenConflicts(broken, 'user_A')).toBe(0);
    expect(addUnseenConflicts(broken, 'user_A', 1)).toBe(1);
  });

  it('keeps a different account separate without uploading or merging', () => {
    window.localStorage.setItem('pl2-library', JSON.stringify([{ id: 'p1', title: 'Stay' }]));
    window.localStorage.setItem('pl2-sync-owner', 'user_A');
    const keepSeparate = vi.fn();
    const listConflicts = vi.fn(async () => []);
    render(<AccountSyncPanel sync={{ ...base, status: 'owner-mismatch', keepSeparate, listConflicts }} m={m} open onClose={() => {}} onSignOut={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Keep separate' }));
    expect(keepSeparate).toHaveBeenCalledTimes(1);
    expect(listConflicts).not.toHaveBeenCalled();
    expect(JSON.parse(window.localStorage.getItem('pl2-library'))[0].title).toBe('Stay');
    expect(window.localStorage.getItem('pl2-sync-owner')).toBe('user_A');
    expect(screen.queryByText('Sync now')).toBeNull();
  });

  it('says the libraries stay separate after that choice', () => {
    render(<AccountSyncPanel sync={{ ...base, status: 'kept-separate', keptSeparate: true }} m={m} open onClose={() => {}} />);
    expect(screen.getByTestId('sync-kept-separate').textContent).toMatch(/not merged/);
    expect(screen.queryByTestId('sync-owner-mismatch')).toBeNull();
    expect(describeSyncStatus({ status: 'kept-separate' }).label).toBe('Libraries kept separate');
  });

  it('asks before deleting synced data and does not clear this device', async () => {
    window.localStorage.setItem('pl2-library', JSON.stringify([{ id: 'p1', title: 'Stay' }]));
    const deleteSyncedData = vi.fn(async () => ({ items: 1, conflicts: 0 }));
    render(<AccountSyncPanel sync={{ ...base, status: 'synced', deleteSyncedData }} m={m} open onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete my synced data' }));
    expect(deleteSyncedData).not.toHaveBeenCalled();
    expect(screen.getByTestId('sync-delete-confirm')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(deleteSyncedData).not.toHaveBeenCalled();
    expect(screen.queryByTestId('sync-delete-confirm')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Delete my synced data' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete synced data' }));
    await waitFor(() => expect(deleteSyncedData).toHaveBeenCalledTimes(1));
    expect(deleteSyncedData.mock.calls[0]).toEqual([]);
    expect(JSON.parse(window.localStorage.getItem('pl2-library'))[0].title).toBe('Stay');
    expect(screen.getByText(/This device's Library was not changed/)).toBeTruthy();
  });

  it('downloads the synced Library for the signed-in account', async () => {
    const exportSyncedLibrary = vi.fn(async () => ({ format: 'prompt-lab-account-export' }));
    render(<AccountSyncPanel sync={{ ...base, status: 'synced', exportSyncedLibrary }} m={m} open onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export synced Library' }));
    await waitFor(() => expect(exportSyncedLibrary).toHaveBeenCalledTimes(1));
  });

  it('hides the account actions while the flag is off', () => {
    render(<AccountSyncPanel sync={{ ...base, enabled: false, status: 'synced' }} m={m} open onClose={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Keep separate' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete my synced data' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Export synced Library' })).toBeNull();
  });

  it('signs out without touching local data', () => {
    window.localStorage.setItem('pl2-library', JSON.stringify([{ id: 'p1', title: 'Keep me' }]));
    const onSignOut = vi.fn();
    render(<AccountSyncPanel sync={{ ...base, status: 'synced' }} m={m} open onClose={() => {}} onSignOut={onSignOut} />);
    expect(screen.getByText(/Everything stays on this device/)).toBeTruthy();
    fireEvent.click(screen.getByText('Sign out, keep local data'));
    expect(onSignOut).toHaveBeenCalled();
    expect(JSON.parse(window.localStorage.getItem('pl2-library'))[0].title).toBe('Keep me');
  });
});

describe('conflict copy restore', () => {
  it('puts the copy back as the live prompt and remembers it', () => {
    window.localStorage.setItem('pl2-library', JSON.stringify([{ id: 'p1', title: 'Winner', updatedAt: '2026-11-01T09:00:00Z' }]));
    const copy = { id: 9, kind: 'prompt', item_id: 'p1', losing_payload: { state: 'trash', entry: { id: 'p1', title: 'Loser', updatedAt: '2026-11-01T08:00:00Z' } } };
    const { written } = restoreConflictCopy(window.localStorage, 'user_A', copy, { now: () => Date.parse('2026-11-01T11:00:00Z') });
    expect(written).toContain('pl2-library');
    const library = JSON.parse(window.localStorage.getItem('pl2-library'));
    expect(library.map((entry) => entry.title)).toEqual(['Loser']);
    expect(readRestoredConflictIds(window.localStorage, 'user_A').has('9')).toBe(true);
  });
});

describe('useAccountSync account binding (#277 review P1)', () => {
  it('never sends the new account\'s token for a run started by the previous account', async () => {
    const config = { enabled: true, url: 'https://abcd.supabase.co', publishableKey: 'sb_publishable_test' };
    const sent = [];
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const fetchMock = vi.fn(async (url, init) => {
      sent.push(init.headers.Authorization);
      if (sent.length === 1) await gate; // hold user A's first request open
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      // The device already belongs to A, so B's own engine stops at the owner
      // check and makes no request: any token-B request would come from A's run.
      window.localStorage.setItem('pl2-sync-owner', 'user_A');
      const tokens = { user_A: async () => 'token-A', user_B: async () => 'token-B' };
      const { rerender, unmount } = renderHook(({ id }) => useAccountSync({ clerkUser: { id }, clerkGetToken: tokens[id], config }), { initialProps: { id: 'user_A' } });
      await waitFor(() => expect(sent.length).toBe(1));
      rerender({ id: 'user_B' });
      await act(async () => { release(); await new Promise((resolve) => setTimeout(resolve, 50)); });
      expect(sent).toEqual(['Bearer token-A']);
      unmount();
    } finally { vi.unstubAllGlobals(); }
  });

  it('keeps libraries separate for the signed-in account without a merge request', async () => {
    const fetchMock = vi.fn(async () => new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    window.localStorage.setItem('pl2-sync-owner', 'user_A');
    window.localStorage.setItem('pl2-library', JSON.stringify([{ id: 'p1', title: 'Stay' }]));
    try {
      const { result } = renderHook(() => useAccountSync({
        clerkUser: { id: 'user_B' },
        clerkGetToken: async () => 'token-B',
        config: { enabled: true, url: 'https://abcd.supabase.co', publishableKey: 'sb_publishable_test' },
      }));
      await waitFor(() => expect(result.current.status).toBe('owner-mismatch'));
      expect(fetchMock).not.toHaveBeenCalled();
      act(() => { result.current.keepSeparate(); });
      expect(result.current.status).toBe('kept-separate');
      expect(window.localStorage.getItem('pl2-sync-kept-separate')).toBe('user_B');
      expect(window.localStorage.getItem('pl2-sync-owner')).toBe('user_A');
      expect(JSON.parse(window.localStorage.getItem('pl2-library'))[0].title).toBe('Stay');
      expect(fetchMock).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });

  it('delete sends no user id and leaves the device Library in place', async () => {
    const calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      calls.push({ url: String(url), body: init.body });
      const body = String(url).includes('sync_delete_my_data') ? '{"items":1,"conflicts":0}' : '[]';
      return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));
    window.localStorage.setItem('pl2-library', JSON.stringify([{ id: 'p1', title: 'Stay' }]));
    try {
      const { result } = renderHook(() => useAccountSync({
        clerkUser: { id: 'user_A' },
        clerkGetToken: async () => 'token-A',
        config: { enabled: true, url: 'https://abcd.supabase.co', publishableKey: 'sb_publishable_test' },
      }));
      await waitFor(() => expect(calls.length).toBeGreaterThan(0));
      await act(async () => { await result.current.deleteSyncedData(); });
      const deleted = calls.find((call) => call.url.includes('sync_delete_my_data'));
      expect(deleted.body).toBe('{}');
      expect(deleted.body).not.toContain('user_A');
      expect(window.localStorage.getItem('pl2-sync-uploads-suspended')).toBe('user_A');
      expect(JSON.parse(window.localStorage.getItem('pl2-library'))[0].title).toBe('Stay');
      const pushesBefore = calls.filter((call) => call.url.includes('sync_push')).length;
      act(() => { result.current.syncNow(); });
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
      expect(calls.filter((call) => call.url.includes('sync_push')).length).toBe(pushesBefore);
    } finally { vi.unstubAllGlobals(); }
  });

  it('waits for an in-flight sync, then deletes without a later upload', async () => {
    let releasePull = () => {};
    const pullGate = new Promise((resolve) => { releasePull = resolve; });
    const calls = [];
    let chain = Promise.resolve();
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: { request: (_name, callback) => { const run = chain.then(() => callback()); chain = run.then(() => {}, () => {}); return run; } },
    });
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      calls.push(String(url));
      if (String(url).includes('sync_pull')) await pullGate;
      const body = String(url).includes('sync_delete_my_data') ? '{"items":1,"conflicts":0}' : '[]';
      return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));
    window.localStorage.setItem('pl2-library', JSON.stringify([{ id: 'p1', title: 'Stay', updatedAt: '2026-11-23T00:00:00.000Z', original: 'keep' }]));
    try {
      const { result } = renderHook(() => useAccountSync({
        clerkUser: { id: 'user_A' },
        clerkGetToken: async () => 'token-A',
        config: { enabled: true, url: 'https://abcd.supabase.co', publishableKey: 'sb_publishable_test' },
      }));
      await waitFor(() => expect(calls.some((url) => url.includes('sync_pull'))).toBe(true));
      let deleted = false;
      const pending = act(async () => {
        await result.current.deleteSyncedData();
        deleted = true;
      });
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
      expect(deleted).toBe(false);
      expect(calls.some((url) => url.includes('sync_delete_my_data'))).toBe(false);
      expect(window.localStorage.getItem('pl2-sync-uploads-suspended')).toBe('user_A');
      releasePull();
      await pending;
      expect(calls.some((url) => url.includes('sync_delete_my_data'))).toBe(true);
      expect(calls.filter((url) => url.includes('sync_push'))).toEqual([]);
      expect(JSON.parse(window.localStorage.getItem('pl2-library'))[0].title).toBe('Stay');
    } finally { vi.unstubAllGlobals(); }
  });

  it('lifts the upload suspension when the erase fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url).includes('sync_delete_my_data')) return new Response('{"message":"nope"}', { status: 500, headers: { 'Content-Type': 'application/json' } });
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));
    try {
      const { result } = renderHook(() => useAccountSync({
        clerkUser: { id: 'user_A' },
        clerkGetToken: async () => 'token-A',
        config: { enabled: true, url: 'https://abcd.supabase.co', publishableKey: 'sb_publishable_test' },
      }));
      await waitFor(() => expect(result.current.status).not.toBe('syncing'));
      await expect(act(async () => { await result.current.deleteSyncedData(); })).rejects.toThrow();
      expect(window.localStorage.getItem('pl2-sync-uploads-suspended')).toBeNull();
    } finally { vi.unstubAllGlobals(); }
  });
});
