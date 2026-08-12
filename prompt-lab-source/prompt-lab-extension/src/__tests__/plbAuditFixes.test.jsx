/**
 * Regression coverage for the P1 fixes from the behavioral audit
 * (PLB-001 … PLB-006): embedded-browser pad naming, transport-level
 * cancellation, acknowledged persistence, multi-tab pad sync, and
 * truthful billing-disabled UI.
 */
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PadTab from '../PadTab.jsx';
import BillingModal from '../modals/BillingModal.jsx';
import usePromptLibrary from '../hooks/usePromptLibrary.js';
import useBillingState from '../hooks/useBillingState.js';
import { createProxyFetch } from '../lib/proxyFetch.js';
import { callModel } from '../lib/platform.js';
import { storageKeys } from '../lib/storage.js';
import { createPromptEntry } from '../lib/promptSchema.js';

// PadTab and BillingModal interpolate theme classes; an empty-string proxy
// stands in for the theme object.
const themeStub = new Proxy({}, { get: () => '' });

function makeQuotaError() {
  const error = new Error('QuotaExceededError: storage full');
  error.name = 'QuotaExceededError';
  return error;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

// ── PLB-001: pad naming must not use window.prompt ──────────────────────────

describe('PLB-001 — pad naming dialog', () => {
  it('creates a pad through the React dialog even when window.prompt is unavailable', async () => {
    // Emulate the embedded browser: any native prompt() call crashes.
    vi.spyOn(window, 'prompt').mockImplementation(() => {
      throw new Error('prompt() is not supported');
    });

    const notify = vi.fn();
    render(<PadTab m={themeStub} notify={notify} />);

    fireEvent.click(screen.getByTitle('New pad'));
    const input = await screen.findByLabelText('Pad name');
    fireEvent.change(input, { target: { value: 'Audit Pad' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(notify).toHaveBeenCalledWith('Created pad: Audit Pad');
    expect(JSON.parse(localStorage.getItem('pl2-pads')).pads.some((pad) => pad.name === 'Audit Pad')).toBe(true);
    expect(window.prompt).not.toHaveBeenCalled();
  });

  it('renames the active pad through the dialog', async () => {
    vi.spyOn(window, 'prompt').mockImplementation(() => {
      throw new Error('prompt() is not supported');
    });

    const notify = vi.fn();
    render(<PadTab m={themeStub} notify={notify} />);

    fireEvent.click(screen.getByTitle('Rename pad'));
    const input = await screen.findByLabelText('Pad name');
    fireEvent.change(input, { target: { value: 'Renamed Pad' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Rename' }));

    expect(notify).toHaveBeenCalledWith('Renamed pad: Renamed Pad');
    expect(JSON.parse(localStorage.getItem('pl2-pads')).pads[0].name).toBe('Renamed Pad');
    expect(window.prompt).not.toHaveBeenCalled();
  });
});

// ── PLB-004: notebook autosave must not report Saved on a rejected write ────

describe('PLB-004 — notebook autosave acknowledgement', () => {
  it('shows Save failed instead of Saved when the write is rejected', async () => {
    vi.useFakeTimers();
    try {
      render(<PadTab m={themeStub} notify={vi.fn()} />);
      const textarea = screen.getByLabelText('Scratchpad');

      const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw makeQuotaError();
      });

      fireEvent.change(textarea, { target: { value: 'quota test content' } });
      act(() => {
        vi.advanceTimersByTime(700);
      });

      expect(screen.getByText(/Save failed/)).toBeInTheDocument();
      expect(screen.queryByText('Saved')).not.toBeInTheDocument();
      // The buffer keeps the unsaved content for manual recovery.
      expect(textarea.value).toBe('quota test content');
      setItem.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── PLB-005: pads written in another tab must be adopted, not overwritten ───

describe('PLB-005 — multi-tab pad sync', () => {
  it('adopts another tab\'s write via the storage event when there are no pending edits', async () => {
    render(<PadTab m={themeStub} notify={vi.fn()} />);
    const textarea = screen.getByLabelText('Scratchpad');

    const external = {
      pads: [{ id: 'default', name: 'Scratchpad', content: 'AUDIT-MULTITAB-A', timestamp: Date.now() }],
      activePadId: 'default',
      revision: 7,
    };
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', {
        key: 'pl2-pads',
        newValue: JSON.stringify(external),
      }));
    });

    await waitFor(() => expect(textarea.value).toBe('AUDIT-MULTITAB-A'));
  });

  it('preserves edits to other pads when this tab saves (merge instead of last-writer-wins)', () => {
    vi.useFakeTimers();
    try {
      const seeded = {
        pads: [
          { id: 'default', name: 'Scratchpad', content: 'mine', timestamp: 1000 },
          { id: 'other', name: 'Other', content: 'stale', timestamp: 1000 },
        ],
        activePadId: 'default',
        revision: 1,
      };
      localStorage.setItem('pl2-pads', JSON.stringify(seeded));
      localStorage.setItem('pl2-pads-schema-version', '2');

      render(<PadTab m={themeStub} notify={vi.fn()} />);
      const textarea = screen.getByLabelText('Scratchpad');

      // Another tab updates the *other* pad behind this tab's back.
      const externalWrite = {
        ...seeded,
        pads: [
          seeded.pads[0],
          { id: 'other', name: 'Other', content: 'FRESH-FROM-TAB-B', timestamp: Date.now() },
        ],
        revision: 5,
      };
      localStorage.setItem('pl2-pads', JSON.stringify(externalWrite));

      // This tab autosaves its own pad; the other pad's newer content must survive.
      fireEvent.change(textarea, { target: { value: 'mine v2' } });
      act(() => {
        vi.advanceTimersByTime(700);
      });

      const persisted = JSON.parse(localStorage.getItem('pl2-pads'));
      expect(persisted.pads.find((pad) => pad.id === 'default').content).toBe('mine v2');
      expect(persisted.pads.find((pad) => pad.id === 'other').content).toBe('FRESH-FROM-TAB-B');
      expect(persisted.revision).toBeGreaterThan(5);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── PLB-003: library saves must fail visibly on storage rejection ───────────

describe('PLB-003 — acknowledged library saves', () => {
  function saveArgs(overrides = {}) {
    return {
      raw: 'Raw text',
      enhanced: 'Enhanced text',
      variants: [],
      notes: '',
      tags: [],
      title: 'Quota Prompt',
      collection: '',
      editingId: null,
      changeNote: '',
      ...overrides,
    };
  }

  it('reports failure and does not add the entry when the write is rejected', async () => {
    const notify = vi.fn();
    const { result } = renderHook(() => usePromptLibrary(notify));
    await waitFor(() => expect(result.current.libReady).toBe(true));
    const initialLength = result.current.library.length;

    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw makeQuotaError();
    });
    let saved;
    act(() => {
      saved = result.current.doSave(saveArgs());
    });
    setItem.mockRestore();

    expect(saved).toBeNull();
    expect(notify).not.toHaveBeenCalledWith('Saved!');
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('Save failed'));
    expect(result.current.library.length).toBe(initialLength);
  });

  it('does not claim "Prompt updated!" when the target prompt was deleted', async () => {
    const entry = createPromptEntry({
      title: 'Doomed',
      original: 'x',
      enhanced: 'x',
      useCount: 0,
      versions: [],
      testCases: [],
    });
    localStorage.setItem(storageKeys.library, JSON.stringify([entry]));

    const notify = vi.fn();
    const { result } = renderHook(() => usePromptLibrary(notify));
    await waitFor(() => expect(result.current.libReady).toBe(true));

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    act(() => {
      result.current.del(entry.id);
    });

    let saved;
    act(() => {
      saved = result.current.doSave(saveArgs({ editingId: entry.id, title: 'Doomed v2' }));
    });

    expect(saved).toBeNull();
    expect(notify).not.toHaveBeenCalledWith('Prompt updated!');
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('no longer exists'));
  });
});

// ── PLB-002: cancellation must reach the transport ──────────────────────────

describe('PLB-002 — transport-level cancellation', () => {
  it('proxyFetch forwards the AbortSignal to fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    const controller = new AbortController();
    const proxyFetch = createProxyFetch('/api/proxy');

    await proxyFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': 'k' },
      body: '{}',
      signal: controller.signal,
    });

    expect(fetchSpy).toHaveBeenCalledWith('/api/proxy', expect.objectContaining({
      signal: controller.signal,
    }));
  });

  it('extension callModel sends MODEL_ABORT and rejects with AbortError on cancel', async () => {
    const sent = [];
    let pendingResponse;
    globalThis.chrome.runtime.sendMessage = vi.fn((msg, cb) => {
      sent.push(msg);
      if (msg.type === 'MODEL_REQUEST') pendingResponse = cb;
      else if (typeof cb === 'function') cb({ ok: true });
    });

    const controller = new AbortController();
    const pending = callModel({ model: 'claude-test' }, { signal: controller.signal });

    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });

    const request = sent.find((msg) => msg.type === 'MODEL_REQUEST');
    const abort = sent.find((msg) => msg.type === 'MODEL_ABORT');
    expect(request.requestId).toBeTruthy();
    expect(abort).toBeTruthy();
    expect(abort.requestId).toBe(request.requestId);

    // A late success from the worker must not surface after cancellation.
    expect(() => pendingResponse({ data: { late: true } })).not.toThrow();
  });
});

// ── PLB-006: billing-disabled deployments must be truthful in the client ────

describe('PLB-006 — billingDisabled propagation', () => {
  const originalFetch = global.fetch;
  const originalOpen = window.open;

  afterEach(() => {
    global.fetch = originalFetch;
    window.open = originalOpen;
  });

  it('startCheckout surfaces the server message and flags state instead of a generic URL error', async () => {
    window.open = vi.fn();
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      error: 'Billing is disabled.',
      billingDisabled: true,
      retryable: false,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const clerkGetToken = vi.fn(async () => 'clerk-token');
    const { result } = renderHook(() => useBillingState({ notify: vi.fn(), clerkGetToken }));

    await act(async () => {
      await expect(result.current.startCheckout('monthly')).rejects.toThrow('Billing is disabled.');
    });

    expect(window.open).not.toHaveBeenCalled();
    expect(result.current.billingDisabled).toBe(true);
  });

  it('BillingModal hides checkout controls and shows the maintenance notice when billing is disabled', () => {
    const billing = {
      plan: 'free',
      status: 'free',
      planLabel: 'Free',
      statusCopy: 'Free plan active.',
      customerEmail: '',
      customerName: '',
      clerkUserId: '',
      customerId: '',
      validationError: '',
      busyAction: '',
      billingDisabled: true,
      ownerAccessAvailable: false,
      activateLicense: vi.fn(),
      refreshLicense: vi.fn(),
      deactivateLicense: vi.fn(),
      activateOwnerAccess: vi.fn(),
      startCheckout: vi.fn(),
      openManagePurchases: vi.fn(),
    };

    render(<BillingModal m={themeStub} billing={billing} onClose={vi.fn()} />);

    expect(screen.getByText('Purchases are temporarily unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Go Pro Monthly')).not.toBeInTheDocument();
    expect(screen.queryByText('Go Pro Annual')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Manage Purchases/ })).toBeDisabled();
  });

  it('BillingModal still offers checkout when billing is enabled', () => {
    const billing = {
      plan: 'free',
      status: 'free',
      planLabel: 'Free',
      statusCopy: 'Free plan active.',
      customerEmail: '',
      customerName: '',
      clerkUserId: '',
      customerId: '',
      validationError: '',
      busyAction: '',
      billingDisabled: false,
      ownerAccessAvailable: false,
      activateLicense: vi.fn(),
      refreshLicense: vi.fn(),
      deactivateLicense: vi.fn(),
      activateOwnerAccess: vi.fn(),
      startCheckout: vi.fn(),
      openManagePurchases: vi.fn(),
    };

    render(<BillingModal m={themeStub} billing={billing} onClose={vi.fn()} />);

    expect(screen.getByText('Go Pro Monthly')).toBeInTheDocument();
    expect(screen.getByText('Go Pro Annual')).toBeInTheDocument();
    expect(screen.queryByText('Purchases are temporarily unavailable')).not.toBeInTheDocument();
  });
});
