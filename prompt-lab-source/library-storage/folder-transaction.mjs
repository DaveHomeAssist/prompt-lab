import { assertWorkspace, canonical, hash, LibraryError } from './contract.mjs';
import { changeFolder } from '../prompt-lab-extension/src/lib/collectionFolders.js';
import { assertFolderProjection } from './folder-projection.mjs';

const object = value => value && Object.getPrototypeOf(value) === Object.prototype;
const address = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const identity = value => typeof value === 'string' && value.trim() && value.length <= 200;
const fail = (code, message) => { throw new LibraryError(code, message, 409); };

/** Browser-safe planning only. The command service must archive and publish it. */
export async function planFolderTransaction(workspace, value) {
  assertWorkspace(workspace); canonical(value);
  workspace = structuredClone(workspace); value = structuredClone(value);
  if (!object(value) || !address(value.expectedStateHash) || !['create', 'change', 'remove'].includes(value.action)) {
    fail('INVALID_FOLDER_COMMAND', 'Pin the reviewed workspace and choose a folder action.');
  }
  const allowed = ['action', 'expectedStateHash', ...(value.action === 'create' ? ['folder']
    : ['folderId', 'expectedFolderHash', value.action === 'change' ? 'changes' : 'confirmRemoval'])];
  if (Object.keys(value).some(key => !allowed.includes(key))) fail('INVALID_FOLDER_COMMAND', 'Unknown folder command options are not supported.');
  const beforeHash = await hash(workspace);
  if (beforeHash !== value.expectedStateHash) fail('REVISION_CONFLICT', 'The reviewed workspace changed. Review the folder operation again.');
  const folders = workspace.folders, collections = workspace.collections;
  assertFolderProjection(workspace);
  const byId = new Map(folders.map(folder => [folder.id, folder]));
  let nextFolders, target;
  if (value.action === 'create') {
    const folder = value.folder;
    if (!object(folder) || !identity(folder.id) || typeof folder.name !== 'string'
      || !Object.hasOwn(folder, 'parentId') || (folder.parentId !== null && !identity(folder.parentId))
      || Object.hasOwn(folder, 'collection')) fail('INVALID_FOLDER_COMMAND', 'Creation requires an ID, name and explicit parent; the collection path is derived.');
    if (byId.has(folder.id)) fail('IDENTITY_CONFLICT', 'This folder ID already exists.');
    target = { ...folder, collection: `__new__${folder.id}` };
    try {
      const draft = [...folders, { ...target, name: '__new__', parentId: null }];
      const changed = changeFolder(draft, target.id, { name: folder.name, parentId: folder.parentId });
      const created = changed.find(row => row.id === target.id);
      nextFolders = [...folders, { ...folder, name: created.name, parentId: created.parentId, collection: created.collection }];
    } catch (error) { fail('INVALID_FOLDER_GRAPH', error.message); }
  } else {
    if (!identity(value.folderId) || !address(value.expectedFolderHash)) fail('INVALID_FOLDER_COMMAND', 'Pin the selected folder ID and exact record hash.');
    target = byId.get(value.folderId);
    if (!target) fail('FOLDER_TARGET_UNAVAILABLE', 'The selected folder is unavailable.');
    if (await hash(target) !== value.expectedFolderHash) fail('RECORD_CONFLICT', 'The selected folder changed. Review it again.');
    if (value.action === 'remove') {
      if (value.confirmRemoval !== true) fail('INVALID_FOLDER_COMMAND', 'Confirm removal of this folder while keeping its prompts.');
      if (folders.some(folder => folder.parentId === target.id)) fail('FOLDER_HAS_CHILDREN', 'Move this folder’s subfolders before removing it. Prompts will be kept.');
      nextFolders = folders.filter(folder => folder.id !== target.id);
    } else {
      const changes = value.changes;
      if (!object(changes) || !Object.keys(changes).length || Object.keys(changes).some(key => !['name', 'parentId', 'artwork'].includes(key))
        || (Object.hasOwn(changes, 'name') && typeof changes.name !== 'string')
        || (Object.hasOwn(changes, 'parentId') && changes.parentId !== null && !identity(changes.parentId))
        || (Object.hasOwn(changes, 'artwork') && (!object(changes.artwork) || !Object.keys(changes.artwork).length
          || Object.entries(changes.artwork).some(([key, field]) => !['icon', 'image', 'emoji'].includes(key) || typeof field !== 'string')))) {
        fail('INVALID_FOLDER_COMMAND', 'Change the folder name, parent or displayed artwork explicitly; other metadata is retained.');
      }
      if (changes.artwork && target.artwork != null && !object(target.artwork)) {
        fail('INVALID_FOLDER_COMMAND', 'This folder has unrecognized artwork metadata. Keep it intact and review it before editing artwork.');
      }
      try {
        const structural = Object.hasOwn(changes, 'name') || Object.hasOwn(changes, 'parentId');
        const changed = structural ? changeFolder(folders, target.id, changes) : folders;
        // The UI helper sanitizes presentation fields. A storage transaction
        // changes only reviewed fields, retaining all unmentioned artwork bytes.
        nextFolders = folders.map((folder, index) => ({ ...folder, ...(structural ? { name: changed[index].name,
          ...(Object.hasOwn(folder, 'parentId') || folder.id === target.id ? { parentId: changed[index].parentId ?? null } : {}),
          collection: changed[index].collection } : {}),
          ...(folder.id === target.id && changes.artwork ? { artwork: { ...folder.artwork, ...changes.artwork } } : {}) }));
      } catch (error) { fail('INVALID_FOLDER_GRAPH', error.message); }
    }
  }
  const nextById = new Map(nextFolders.map(folder => [folder.id, folder]));
  const pathChanges = folders.flatMap(folder => {
    const next = nextById.get(folder.id)?.collection ?? '';
    return next === folder.collection ? [] : [{ folderId: folder.id, from: folder.collection, to: next }];
  });
  const changedPaths = new Map(pathChanges.map(change => [change.from, change.to]));
  const changedIds = new Set(pathChanges.map(change => change.folderId));
  const promptChanges = [];
  const library = workspace.library.map((prompt, index) => {
    const folder = byId.get(prompt.folderId);
    const path = folder?.collection ?? prompt.collection;
    if (!changedPaths.has(path) && !changedIds.has(prompt.folderId)) return prompt;
    const next = { ...prompt, collection: changedPaths.get(path) ?? path };
    if (value.action === 'remove' && prompt.folderId === target.id) next.folderId = '';
    if (canonical(next) !== canonical(prompt)) promptChanges.push({ index, id: prompt.id ?? null });
    return next;
  });
  // Keep compatibility ordering, including literal slash-containing root names.
  const nextCollections = collections.flatMap(name => {
    const next = changedPaths.has(name) ? changedPaths.get(name) : name;
    return next ? [next] : [];
  });
  if (value.action === 'create') nextCollections.push(nextById.get(target.id).collection);
  const next = { ...workspace, folders: nextFolders, collections: nextCollections, library };
  const afterHash = await hash(next);
  if (afterHash === beforeHash) fail('NO_CHANGE', 'This command does not change the folder projection.');
  const changes = { paths: pathChanges, prompts: promptChanges, folders: [] };
  for (const id of new Set([...byId.keys(), ...nextById.keys()])) {
    const before = byId.get(id), after = nextById.get(id);
    if (canonical(before ?? null) !== canonical(after ?? null)) changes.folders.push({ id,
      beforeHash: before ? await hash(before) : null, afterHash: after ? await hash(after) : null });
  }
  return { format: 'promptlab-folder-transaction', schemaVersion: 1, request: value,
    beforeHash, afterHash, changes, workspace: next, activationReady: false };
}
