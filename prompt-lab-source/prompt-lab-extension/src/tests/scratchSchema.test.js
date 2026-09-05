import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SCRATCH_KEY,
  SCRATCH_SCHEMA_VERSION,
  SCRATCH_SCHEMA_VERSION_KEY,
  mergeScratchPayloads,
  migrateScratchStorage,
  normalizeScratchPayload,
  persistScratchState,
} from '../lib/scratchSchema.js';

beforeEach(() => localStorage.clear());

describe('scratch schema v4', () => {
  it('migrates the legacy single note only after a successful v4 write', () => {
    localStorage.setItem('pl2-pad', 'legacy note');
    localStorage.setItem('pl2-pad_meta', '2026-01-02T03:04:05.000Z');

    const result = migrateScratchStorage(localStorage, 1000);

    expect(result.error).toBeNull();
    expect(localStorage.getItem(SCRATCH_SCHEMA_VERSION_KEY)).toBe(SCRATCH_SCHEMA_VERSION);
    expect(localStorage.getItem('pl2-pad')).toBeNull();
    expect(result.payload.pads[0]).toMatchObject({
      id: 'default',
      content: 'legacy note',
      createdAt: new Date('2026-01-02T03:04:05.000Z').getTime(),
      updatedAt: new Date('2026-01-02T03:04:05.000Z').getTime(),
      color: 'orange',
      linkedPrompts: [],
    });
  });

  it('retains unknown future fields while normalizing all v4 cross-tab fields', () => {
    const normalized = normalizeScratchPayload({
      pads: [{
        id: 'one', name: 'One', content: 'text', timestamp: 10,
        status: 'ready', color: 'amber', tags: ['x'], customFutureField: 'keep-me',
        linkedPrompts: [{ id: 'prompt-1', title: 'Prompt', kind: 'template', linkedAt: 11 }],
      }],
      activePadId: 'one',
      revision: 4,
      tombstones: {},
      payloadFutureField: 'also-keep',
    }, 99);

    expect(normalized.payloadFutureField).toBe('also-keep');
    expect(normalized.pads[0]).toMatchObject({
      customFutureField: 'keep-me',
      status: 'ready', color: 'amber', tags: ['x'], createdAt: 10, updatedAt: 10,
    });
    expect(normalized.pads[0].linkedPrompts[0]).toMatchObject({ id: 'prompt-1', kind: 'template' });
  });

  it('merges concurrent edits by note and uses tombstones to prevent resurrection', () => {
    const local = normalizeScratchPayload({
      pads: [
        { id: 'one', name: 'One', content: 'local', timestamp: 30, color: 'green' },
        { id: 'two', name: 'Two', content: 'delete me', timestamp: 20 },
      ],
      activePadId: 'one', revision: 3, tombstones: { two: 40 },
    });
    const stored = normalizeScratchPayload({
      pads: [
        { id: 'one', name: 'One', content: 'external', timestamp: 50, color: 'rose' },
        { id: 'two', name: 'Two', content: 'stale copy', timestamp: 20 },
        { id: 'three', name: 'Three', content: 'other tab', timestamp: 60, status: 'working' },
      ],
      activePadId: 'three', revision: 4, tombstones: {},
    });

    const merged = mergeScratchPayloads(local, stored);
    expect(merged.pads.map((pad) => pad.id)).toEqual(['one', 'three']);
    expect(merged.pads.find((pad) => pad.id === 'one')).toMatchObject({ content: 'external', color: 'rose' });
    expect(merged.pads.find((pad) => pad.id === 'three')).toMatchObject({ content: 'other tab', status: 'working' });
  });

  it('retains the caller state when storage rejects a write', () => {
    const state = normalizeScratchPayload({
      pads: [{ id: 'one', name: 'One', content: 'unsaved', timestamp: 10 }],
      activePadId: 'one', revision: 1, tombstones: {},
    });
    const storage = {
      getItem: vi.fn((key) => key === SCRATCH_KEY ? null : null),
      setItem: vi.fn(() => { throw new DOMException('quota', 'QuotaExceededError'); }),
    };

    const result = persistScratchState(state, { storage });
    expect(result.ok).toBe(false);
    expect(result.state.pads[0].content).toBe('unsaved');
  });

  it('keeps readable notes and the old schema marker when the migration write fails', () => {
    const original = JSON.stringify({
      pads: [{ id: 'one', name: 'Research', content: 'RECOVER ME', timestamp: 10 }],
      activePadId: 'one',
    });
    const values = new Map([[SCRATCH_KEY, original], [SCRATCH_SCHEMA_VERSION_KEY, '3']]);
    const storage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: vi.fn(() => { throw new DOMException('quota', 'QuotaExceededError'); }),
      removeItem: vi.fn(),
    };

    const failed = migrateScratchStorage(storage, 1000);
    expect(failed.error?.name).toBe('QuotaExceededError');
    expect(failed.payload.pads[0].content).toBe('RECOVER ME');
    expect(values.get(SCRATCH_KEY)).toBe(original);
    expect(values.get(SCRATCH_SCHEMA_VERSION_KEY)).toBe('3');
    expect(storage.removeItem).not.toHaveBeenCalled();

    storage.setItem.mockImplementation((key, value) => values.set(key, value));
    const retried = migrateScratchStorage(storage, 1000);
    expect(retried.error).toBeNull();
    expect(retried.payload.pads[0].id).toBe('one');
    expect(JSON.parse(values.get(SCRATCH_KEY)).pads[0].content).toBe('RECOVER ME');
    expect(values.get(SCRATCH_SCHEMA_VERSION_KEY)).toBe(SCRATCH_SCHEMA_VERSION);
  });

  it('loads current notes without requiring another write', () => {
    const payload = normalizeScratchPayload({ pads: [{ id: 'one', content: 'saved', timestamp: 10 }] });
    const storage = {
      getItem: (key) => key === SCRATCH_KEY ? JSON.stringify(payload) : SCRATCH_SCHEMA_VERSION,
      setItem: vi.fn(() => { throw new Error('writes unavailable'); }),
    };
    const result = migrateScratchStorage(storage);
    expect(result.payload).toEqual(payload);
    expect(result.error).toBeNull();
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('retains readable legacy content if the schema marker write fails', () => {
    const values = new Map([['pl2-pad', 'legacy recovery']]);
    const storage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        if (key === SCRATCH_SCHEMA_VERSION_KEY) throw new Error('marker failed');
        values.set(key, value);
      },
      removeItem: vi.fn(),
    };
    const result = migrateScratchStorage(storage, 10);
    expect(result.payload.pads[0].content).toBe('legacy recovery');
    expect(result.error.message).toBe('marker failed');
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('reports unreadable storage without throwing again or overwriting it', () => {
    for (const getItem of [() => '{broken', () => { throw new Error('storage disabled'); }]) {
      const storage = { getItem, setItem: vi.fn(), removeItem: vi.fn() };
      const result = migrateScratchStorage(storage, 10);
      expect(result.error).toBeTruthy();
      expect(result.errorStage).toBe('read');
      expect(storage.setItem).not.toHaveBeenCalled();
    }
  });
});
