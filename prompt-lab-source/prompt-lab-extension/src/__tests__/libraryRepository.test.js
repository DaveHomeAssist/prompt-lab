import { describe, expect, it, vi } from 'vitest';
import fixture from '../tests/fixtures/native-library-export.json';
import { storageKeys } from '../lib/storage.js';
import {
  createLocalLibraryRepository,
  LibraryRepositoryError,
} from '../lib/libraryRepository.js';
import { buildNativeLibraryExport, parseNativeLibraryExport } from '../lib/libraryExport.js';

class MemoryStorage {
  constructor(initial = {}) {
    this.values = new Map(Object.entries(initial));
  }

  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

describe('local library repository', () => {
  it('backs up and migrates legacy arrays without changing records', () => {
    const legacyRecords = fixture.library;
    const storage = new MemoryStorage({
      [storageKeys.library]: JSON.stringify(legacyRecords),
      [storageKeys.collections]: JSON.stringify(fixture.collections),
    });
    const repository = createLocalLibraryRepository({ storage, eventTarget: null, now: () => fixture.exportedAt });

    const loaded = repository.load();

    expect(loaded.migrated).toBe(true);
    expect(loaded.envelope.records).toEqual(legacyRecords);
    expect(JSON.parse(storage.getItem(storageKeys.libraryBackup)).reason).toBe('pre-envelope-migration');
    expect(JSON.parse(storage.getItem(storageKeys.library))).toEqual(legacyRecords);
  });

  it('prevents a stale revision from overwriting a newer tab', () => {
    const storage = new MemoryStorage();
    const first = createLocalLibraryRepository({ storage, eventTarget: null });
    const second = createLocalLibraryRepository({ storage, eventTarget: null });
    const initial = first.save({ records: [], collections: [] }, { expectedRevision: 0 });
    const staleRevision = initial.envelope.revision;

    first.save({ records: [{ id: 'newer' }], collections: [] }, { expectedRevision: staleRevision });

    expect(() => second.save({ records: [{ id: 'stale' }], collections: [] }, { expectedRevision: staleRevision }))
      .toThrowError(expect.objectContaining({ code: 'revision-conflict' }));
    expect(JSON.parse(storage.getItem(storageKeys.libraryEnvelope)).records).toEqual([{ id: 'newer' }]);
  });

  it('subscribes to versioned storage updates from another tab', () => {
    const listeners = new Map();
    const eventTarget = {
      addEventListener: vi.fn((name, handler) => listeners.set(name, handler)),
      removeEventListener: vi.fn((name) => listeners.delete(name)),
    };
    const repository = createLocalLibraryRepository({ storage: new MemoryStorage(), eventTarget });
    const listener = vi.fn();
    const unsubscribe = repository.subscribe(listener);
    const envelope = {
      schemaVersion: 1,
      revision: 4,
      savedAt: '2026-08-05T12:00:00.000Z',
      deviceId: 'other-tab',
      records: [{ id: 'external' }],
      collections: [],
    };

    listeners.get('storage')({ key: storageKeys.libraryEnvelope, newValue: JSON.stringify(envelope) });

    expect(listener).toHaveBeenCalledWith(envelope);
    unsubscribe();
    expect(eventTarget.removeEventListener).toHaveBeenCalledWith('storage', expect.any(Function));
  });

  it('recovers a malformed envelope from the compatibility mirror', () => {
    const storage = new MemoryStorage({
      [storageKeys.libraryEnvelope]: '{broken',
      [storageKeys.library]: JSON.stringify([{ id: 'mirrored', title: 'Mirrored prompt' }]),
      [storageKeys.collections]: JSON.stringify(['Recovery']),
    });
    const repository = createLocalLibraryRepository({ storage, eventTarget: null });

    const loaded = repository.load();

    expect(loaded.recoveryAvailable).toBe(true);
    expect(loaded.envelope.records).toEqual([{ id: 'mirrored', title: 'Mirrored prompt' }]);
    const recovered = repository.recoverBackup();
    expect(recovered.envelope.records).toEqual([{ id: 'mirrored', title: 'Mirrored prompt' }]);
    expect(recovered.envelope.revision).toBe(1);
  });

  it('surfaces quota failures as recoverable repository errors', () => {
    const storage = new MemoryStorage();
    storage.setItem = () => {
      const error = new Error('quota exceeded');
      error.name = 'QuotaExceededError';
      throw error;
    };
    const repository = createLocalLibraryRepository({ storage, eventTarget: null });

    try {
      repository.save({ records: [], collections: [] });
      throw new Error('Expected save to fail.');
    } catch (error) {
      expect(error).toBeInstanceOf(LibraryRepositoryError);
      expect(error).toMatchObject({
        code: 'storage-failed',
        message: 'Local storage is full. Export or remove data, then retry.',
      });
    }
  });
});

describe('native library export contract', () => {
  it('round-trips metadata and versions through the frozen fixture contract', () => {
    const parsed = parseNativeLibraryExport(fixture);
    const exported = buildNativeLibraryExport({
      library: parsed.library,
      collections: parsed.collections,
      exportedAt: fixture.exportedAt,
      appVersion: fixture.version,
    });
    const roundTrip = parseNativeLibraryExport(exported);

    expect(roundTrip.library[0].metadata).toMatchObject({
      owner: 'Dave',
      externalId: 'fixture-42',
      compatibility: ['openai', 'anthropic'],
    });
    expect(roundTrip.library[0].versions).toHaveLength(1);
    expect(roundTrip.collections).toEqual(['Operations']);
  });
});
