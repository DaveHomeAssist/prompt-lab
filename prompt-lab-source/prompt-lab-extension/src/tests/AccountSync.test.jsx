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
});
