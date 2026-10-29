import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { createPromptEntry, getPromptSnapshot, normalizeEntry, restorePromptVersion, updatePromptEntry } from '../lib/promptSchema.js';
import usePromptLibrary from '../hooks/usePromptLibrary.js';
import { storageKeys } from '../lib/storage.js';

const timestamp = '2026-10-29T00:00:00.000Z';
function fixture() {
  return {
    id: 'preserved', currentVersionId: 'current', title: 'Preservation fixture', original: 'Current input', enhanced: 'Current result',
    createdAt: timestamp, updatedAt: timestamp, future: { nested: ['keep', null, false] },
    variants: [{ label: 'Variant', content: 'Variant text', futureVariant: { preserved: true } }],
    versions: Array.from({ length: 41 }, (_, n) => ({ id: `history-${n}`, original: `Input ${n}`, enhanced: `Result ${n}`, savedAt: timestamp,
      variants: [], futureVersion: { index: n }, metadata: { future: `metadata ${n}` } })),
    testCases: [{ id: 'case', input: 'Test input', futureCase: { weight: 2 } }],
    inputs: [{ key: 'scope', type: 'select', options: [{ label: 'Option', value: 'option', futureOption: true }], futureInput: 'retained' }],
    goldenResponse: { text: 'Golden response '.repeat(2000), pinnedAt: timestamp, futureGolden: [1, 2] },
  };
}

describe('app prompt save preservation', () => {
  beforeEach(() => localStorage.clear());

  it('retains all earlier versions across save, reload and restore', () => {
    const original = fixture();
    const saved = updatePromptEntry(original, { enhanced: 'New result' }, { now: timestamp });
    expect(saved.versions).toHaveLength(42);
    expect(saved.versions.slice(0, 41).map(version => version.id)).toEqual(original.versions.map(version => version.id));
    const restored = restorePromptVersion(normalizeEntry(JSON.parse(JSON.stringify(saved))), saved.versions[0], { now: timestamp });
    expect(restored.versions).toHaveLength(43);
    expect(restored.enhanced).toBe('Result 0');
    expect(restored.versions.slice(0, 41).map(version => version.futureVersion)).toEqual(original.versions.map(version => version.futureVersion));
  });

  it('keeps unknown prompt, version, variant, case and input fields through normalization and save', () => {
    const original = fixture();
    const saved = updatePromptEntry(createPromptEntry(original), { enhanced: 'Edited' }, { now: timestamp });
    expect(saved.future).toEqual(original.future);
    expect(saved.variants[0].futureVariant).toEqual(original.variants[0].futureVariant);
    expect(saved.versions[0].futureVersion).toEqual(original.versions[0].futureVersion);
    expect(saved.versions[0].metadata).toEqual(original.versions[0].metadata);
    expect(saved.testCases[0].futureCase).toEqual(original.testCases[0].futureCase);
    expect(saved.inputs[0].futureInput).toBe('retained');
    expect(saved.inputs[0].options[0].futureOption).toBe(true);
    expect(original).toEqual(fixture());
  });

  it('preserves complete golden text and its extension fields', () => {
    const original = fixture(), saved = updatePromptEntry(original, { title: 'Renamed' });
    expect(saved.goldenResponse.text).toBe(original.goldenResponse.text);
    expect(saved.goldenResponse.futureGolden).toEqual(original.goldenResponse.futureGolden);
  });

  it('snapshots retain the complete prior record without recursively copying older history', () => {
    let current = createPromptEntry(fixture());
    for (let n = 0; n < 3; n++) current = updatePromptEntry(current, { enhanced: `Edit ${n}` });
    const snapshot = getPromptSnapshot(current);
    expect(snapshot).not.toHaveProperty('versions');
    expect(snapshot.future).toEqual(fixture().future);
    expect(current.versions.slice(-3).every(version => !Object.hasOwn(version, 'versions'))).toBe(true);
    expect(current.versions.at(-1).goldenResponse.text).toBe(fixture().goldenResponse.text);
  });

  it('the real app save hook acknowledges the complete history and reloads it unchanged', async () => {
    const original = fixture(); localStorage.setItem(storageKeys.library, JSON.stringify([original]));
    const first = renderHook(() => usePromptLibrary(() => {}));
    await waitFor(() => expect(first.result.current.libReady).toBe(true));
    let receipt;
    await act(async () => { receipt = await first.result.current.doSave({ editingId: original.id, expectedVersionId: original.currentVersionId,
      raw: original.original, enhanced: 'Saved from the editor', title: original.title, variants: original.variants, notes: '', tags: [], collection: '' }); });
    expect(receipt?.id).toBe(original.id);
    const stored = JSON.parse(localStorage.getItem(storageKeys.library))[0];
    expect(stored.versions).toHaveLength(42);
    expect(stored.future).toEqual(original.future);
    expect(stored.versions[0].futureVersion).toEqual(original.versions[0].futureVersion);
    first.unmount();
    const second = renderHook(() => usePromptLibrary(() => {}));
    await waitFor(() => expect(second.result.current.libReady).toBe(true));
    expect(second.result.current.library[0].versions).toEqual(stored.versions);
    expect(second.result.current.library[0].future).toEqual(original.future);
    second.unmount();
  });
});
