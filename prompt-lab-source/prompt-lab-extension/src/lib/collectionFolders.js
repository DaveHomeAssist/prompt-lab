import { safeArtwork } from './libraryPresentation.js';

// Collection strings remain the compatibility projection. IDs and parent links
// own folder identity; legacy names (including literal slashes) remain roots.
export function reconcileFolders(value = [], collections = []) {
  if (!Array.isArray(value)) throw new Error('Folders must be an array.');
  const ids = new Set(); const paths = new Set();
  const folders = value.map(folder => {
    if (!folder || typeof folder.id !== 'string' || !folder.id || typeof folder.name !== 'string'
      || !folder.name.trim() || typeof folder.collection !== 'string' || !folder.collection.trim()
      || ids.has(folder.id) || paths.has(folder.collection)) throw new Error('Folders require unique IDs and collection paths.');
    ids.add(folder.id); paths.add(folder.collection);
    return { id: folder.id, name: folder.name.trim(), parentId: folder.parentId || null,
      collection: folder.collection, artwork: safeArtwork(folder.artwork) };
  });
  const byId = new Map(folders.map(folder => [folder.id, folder]));
  for (const folder of folders) {
    const seen = new Set([folder.id]); let parent = folder.parentId;
    while (parent) {
      if (seen.has(parent) || !byId.has(parent)) throw new Error('Folder parent links must be present and acyclic.');
      seen.add(parent); parent = byId.get(parent).parentId;
    }
  }
  for (const name of collections) if (typeof name === 'string' && name.trim() && !paths.has(name)) {
    let id = `legacy:${encodeURIComponent(name)}`;
    while (ids.has(id)) id += ':root';
    folders.push({ id, name, parentId: null, collection: name, artwork: { icon: '', image: '' } });
    ids.add(id); paths.add(name);
  }
  return folders;
}

export function folderDescendants(folders, id) {
  const found = new Set([id]);
  let count;
  do { count = found.size; for (const folder of folders) if (found.has(folder.parentId)) found.add(folder.id); } while (count !== found.size);
  return found;
}

export function folderTree(folders) {
  const children = parentId => folders.filter(folder => folder.parentId === parentId).sort((a, b) => a.name.localeCompare(b.name));
  const rows = [];
  const visit = (parentId, depth) => { for (const folder of children(parentId)) { rows.push({ ...folder, depth, hasChildren: children(folder.id).length > 0 }); visit(folder.id, depth + 1); } };
  visit(null, 0); return rows;
}

export function changeFolder(folders, id, patch) {
  const source = folders.find(folder => folder.id === id);
  if (!source) throw new Error('Folder no longer exists.');
  const name = (patch.name ?? source.name).trim(); const parentId = patch.parentId === undefined ? source.parentId : patch.parentId;
  if (!name || name.includes('/')) throw new Error('Use a folder name without /. Choose its parent separately.');
  if (folderDescendants(folders, id).has(parentId)) throw new Error('A folder cannot be moved inside itself.');
  const parent = folders.find(folder => folder.id === parentId);
  if (parentId && !parent) throw new Error('Parent folder no longer exists.');
  if (folders.some(folder => folder.id !== id && folder.parentId === parentId && folder.name.toLowerCase() === name.toLowerCase())) throw new Error('That parent already has a folder with this name.');
  const paths = new Map();
  const next = folders.map(folder => folder.id === id ? { ...folder, ...patch, name, parentId, artwork: safeArtwork(patch.artwork ?? folder.artwork) } : { ...folder });
  const byId = new Map(next.map(folder => [folder.id, folder]));
  const pathFor = folder => { if (!paths.has(folder.id)) paths.set(folder.id, folder.parentId ? `${pathFor(byId.get(folder.parentId))}/${folder.name}` : folder.name); return paths.get(folder.id); };
  const affected = folderDescendants(folders, id);
  for (const folder of next) if (affected.has(folder.id)) folder.collection = pathFor(folder);
  if (new Set(next.map(folder => folder.collection)).size !== next.length) throw new Error('This move conflicts with an existing collection path.');
  return next;
}

export function mergeFolders(current, incoming, collections) {
  const imported = reconcileFolders(incoming);
  const byPath = new Map(current.map(folder => [folder.collection, folder]));
  const ids = new Set(current.map(folder => folder.id)); const mapping = new Map();
  for (const folder of imported) {
    let id = byPath.get(folder.collection)?.id || folder.id;
    if (!byPath.has(folder.collection) && ids.has(id)) id = crypto.randomUUID();
    ids.add(id); mapping.set(folder.id, id);
  }
  for (const folder of imported) byPath.set(folder.collection, { ...folder, id: mapping.get(folder.id), parentId: folder.parentId ? mapping.get(folder.parentId) : null });
  return reconcileFolders([...byPath.values()], collections);
}
