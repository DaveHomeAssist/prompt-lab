import { LibraryError } from './contract.mjs';
import { reconcileFolders } from '../prompt-lab-extension/src/lib/collectionFolders.js';

const fail = (code, message) => { throw new LibraryError(code, message, 409); };

/** Validate relationships without normalizing or discarding any stored fields. */
export function assertFolderProjection({ library, folders, collections }) {
  if (!Array.isArray(folders) || !Array.isArray(collections) || collections.some(name => typeof name !== 'string' || !name.trim())
    || new Set(collections).size !== collections.length) fail('FOLDER_PROJECTION_INCOMPLETE', 'Review complete folders and unique collection paths before changing them.');
  try { reconcileFolders(folders); } catch { fail('INVALID_FOLDER_GRAPH', 'Folder IDs, paths and parent links must be unique, present and acyclic.'); }
  const paths = new Set(folders.map(folder => folder.collection)), byId = new Map(folders.map(folder => [folder.id, folder]));
  if (paths.size !== collections.length || collections.some(name => !paths.has(name))) {
    fail('FOLDER_PROJECTION_INCOMPLETE', 'Folder records and collection paths differ. Review their migration before changing them.');
  }
  const siblings = new Set();
  for (const folder of folders) {
    const sibling = JSON.stringify([folder.parentId || null, folder.name.trim().toLowerCase()]);
    if (siblings.has(sibling)) fail('INVALID_FOLDER_GRAPH', 'Sibling folder names must be distinct. Review the branch choices together.');
    siblings.add(sibling);
    if (folder.parentId && folder.collection !== `${byId.get(folder.parentId).collection}/${folder.name}`) {
      fail('INVALID_FOLDER_GRAPH', 'A child folder path differs from its selected parent. Review the branch choices together.');
    }
  }
  for (const prompt of library) {
    if (!prompt || Object.getPrototypeOf(prompt) !== Object.prototype) fail('INVALID_FOLDER_REFERENCES', 'Prompt records must be preserved objects.');
    if (prompt.folderId !== undefined && prompt.folderId !== null && prompt.folderId !== '') {
      const folder = byId.get(prompt.folderId);
      if (!folder || (prompt.collection !== undefined && prompt.collection !== null && prompt.collection !== '' && prompt.collection !== folder.collection)) {
        fail('INVALID_FOLDER_REFERENCES', 'A prompt folder ID and collection path disagree. Review the source before changing it.');
      }
    }
    if (prompt.collection !== undefined && typeof prompt.collection !== 'string' && prompt.collection !== null) {
      fail('INVALID_FOLDER_REFERENCES', 'A prompt collection path has an unsupported value.');
    }
    if (prompt.collection && !paths.has(prompt.collection)) fail('INVALID_FOLDER_REFERENCES', 'A prompt collection has no reviewed folder record.');
  }
}

export function folderProjectionSources(inspected) {
  return new Set((inspected.derivedSources ?? []).flatMap(source => source.folderMutation ? [source.folderMutation.sourceIdentity]
    : source.packMutation?.folderPolicy === 'preserve-paths' ? [source.packMutation.sourceIdentity] : []));
}

/** Collection strings follow selected folder identities, including after restore. */
export function projectFolderCollections(groups, byKey, inspected, resolutions, blocked) {
  for (const sourceIdentity of folderProjectionSources(inspected)) {
    const selected = domain => groups.filter(group => group.domain === domain && group.sourceIdentity === sourceIdentity && group.selected !== null)
      .map(group => byKey.get(group.selected)?.value);
    const folders = selected('folders'), paths = new Set(folders.map(folder => folder?.collection));
    const collections = groups.filter(group => group.domain === 'collections' && group.sourceIdentity === sourceIdentity);
    for (const group of collections) {
      if (Object.hasOwn(resolutions, group.id)) throw new LibraryError('INVALID_RESOLUTIONS', 'Collection paths are derived from the selected folders.', 409);
      group.selected = group.candidates.find(key => paths.has(byKey.get(key)?.value)) ?? null;
      group.decision = 'folder-projection';
    }
    try { assertFolderProjection({ folders, collections: selected('collections'), library: selected('prompts') }); }
    catch (error) {
      if (!(error instanceof LibraryError)) throw error;
      blocked.push({ code: error.code, sourceIdentity });
    }
  }
}
