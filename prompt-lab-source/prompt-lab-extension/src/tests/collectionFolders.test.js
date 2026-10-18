import { describe, it, expect } from 'vitest';
import { reconcileFolders, changeFolder, mergeFolders, folderDescendants } from '../lib/collectionFolders.js';
import { safeArtwork } from '../lib/libraryPresentation.js';

describe('collection folder compatibility', () => {
  it('preserves literal legacy names and deterministic IDs', () => {
    const folders = reconcileFolders([], ['Ops', 'A/B']);
    expect(reconcileFolders([], ['Ops', 'A/B'])).toEqual(folders);
    expect(folders[1]).toMatchObject({ name: 'A/B', collection: 'A/B', parentId: null });
  });
  it('retains IDs and artwork across nested rename and move', () => {
    const root = { id: 'root', name: 'Ops', collection: 'Ops', parentId: null, artwork: { icon: 'Star' } };
    const child = { id: 'child', name: 'Shows', collection: 'Ops/Shows', parentId: 'root', artwork: {} };
    const folders = reconcileFolders([root, child]);
    const renamed = changeFolder(folders, 'root', { name: 'Production' });
    expect(renamed[1]).toMatchObject({ id: 'child', collection: 'Production/Shows', parentId: 'root' });
    expect(renamed[0].artwork.icon).toBe('Star');
    expect(folderDescendants(renamed, 'root')).toEqual(new Set(['root', 'child']));
    expect(() => changeFolder(renamed, 'root', { parentId: 'child' })).toThrow(/inside itself/);
  });
  it('rejects corrupt parents and cycles before import writes', () => {
    expect(() => reconcileFolders([{ id: 'a', name: 'A', collection: 'A', parentId: 'missing' }])).toThrow(/acyclic/);
    expect(() => reconcileFolders([{ id: 'a', name: 'A', collection: 'A', parentId: 'a' }])).toThrow(/acyclic/);
  });
  it('round-trips artwork and safely remaps colliding imported IDs', () => {
    const current = reconcileFolders([{ id: 'same', name: 'One', collection: 'One', parentId: null }]);
    const incoming = [{ id: 'same', name: 'Two', collection: 'Two', parentId: null, artwork: { icon: 'Star', image: 'data:image/png;base64,AAAA' } }];
    const merged = mergeFolders(current, JSON.parse(JSON.stringify(incoming)), ['One', 'Two']);
    expect(new Set(merged.map(folder => folder.id)).size).toBe(2);
    expect(merged.find(folder => folder.collection === 'Two').artwork).toEqual(incoming[0].artwork);
  });
  it('never loads external or executable image URLs', () => {
    expect(safeArtwork({ icon: 'arbitrary', image: 'https://example.com/tracker.png' })).toEqual({ icon: '', image: '' });
    expect(safeArtwork({ image: 'data:image/svg+xml;base64,AAAA' }).image).toBe('');
  });
});
