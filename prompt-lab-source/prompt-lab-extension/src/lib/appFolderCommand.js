import { canonical, hash, LibraryError } from '../../../library-storage/contract.mjs';
import { planFolderTransaction } from '../../../library-storage/folder-transaction.mjs';
import { reconcileFolders } from './collectionFolders.js';

const fail = message => { throw new LibraryError('INVALID_FOLDER_CHANGE', message, 409); };
const equal = (a, b) => canonical(a ?? null) === canonical(b ?? null);

/** Convert one displayed edit into one atomic, revision-pinned folder command. */
export async function planAppFolderCommand(before, requested) {
  const folders = reconcileFolders(before.folders), next = reconcileFolders(requested);
  const current = new Map(folders.map(row => [row.id, row])), desired = new Map(next.map(row => [row.id, row]));
  const added = next.filter(row => !current.has(row.id)), removed = folders.filter(row => !desired.has(row.id));
  const changed = [];
  for (const folder of next) {
    const previous = current.get(folder.id);
    if (!previous) continue;
    const changes = {};
    for (const key of ['name', 'parentId']) if (!equal(previous[key], folder[key])) changes[key] = folder[key];
    const artwork = {};
    for (const key of ['icon', 'image', 'emoji']) {
      const value = folder.artwork[key] ?? '';
      if (!equal(previous.artwork[key] ?? '', value)) artwork[key] = value;
    }
    if (Object.keys(artwork).length) changes.artwork = artwork;
    if (Object.keys(changes).length) changed.push({ folder, changes });
  }
  if (added.length + removed.length + changed.length !== 1) fail('Save one folder change at a time. Keep the current folder details and retry.');
  let command;
  if (added.length) {
    const { collection, ...folder } = added[0];
    command = { action: 'create', folder };
  } else {
    const id = removed[0]?.id ?? changed[0].folder.id, original = before.folders.find(row => row.id === id);
    command = { action: removed.length ? 'remove' : 'change', folderId: id, expectedFolderHash: await hash(original),
      ...(removed.length ? { confirmRemoval: true } : { changes: changed[0].changes }) };
  }
  const workspace = { library: before.library, folders: before.folders, collections: before.collections };
  const plan = await planFolderTransaction(workspace, { ...command, expectedStateHash: await hash(workspace) });
  const expected = reconcileFolders(plan.workspace.folders);
  if (!equal(expected.map(row => row.id), next.map(row => row.id))) fail('Folder order or identities changed outside the selected operation.');
  for (const folder of next) {
    const planned = expected.find(row => row.id === folder.id);
    // Omitted future fields stay in storage. Supplied unrelated changes must
    // not be silently accepted as part of a structural or artwork edit.
    for (const [key, value] of Object.entries(folder)) {
      if (key === 'artwork') {
        for (const [field, item] of Object.entries(value)) if (!equal(planned.artwork[field], item)) fail('Artwork metadata changed outside the selected operation.');
      } else if (!equal(planned[key], value)) fail('Folder details changed outside the selected operation.');
    }
  }
  return { command, expectedRevision: before.revision, expectedFolders: plan.workspace.folders, expectedCollections: plan.workspace.collections };
}
