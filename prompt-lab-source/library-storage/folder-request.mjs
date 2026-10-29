import { canonical, LibraryError } from './contract.mjs';

const object = value => value && Object.getPrototypeOf(value) === Object.prototype;
const address = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const id = value => typeof value === 'string' && value.trim() && value.length <= 200;
const fail = message => { throw new LibraryError('INVALID_FOLDER_COMMAND', message, 409); };

/** Browser-safe validation shared by the command service and durable outbox. */
export function normalizeFolderRequest(value) {
  if (!object(value) || !id(value.libraryId) || !address(value.expectedRevision) || !address(value.sourceBinding)
    || !['create', 'change', 'remove'].includes(value.action)
    || typeof value.changedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.changedAt)
    || !Number.isFinite(Date.parse(value.changedAt)) || new Date(value.changedAt).toISOString() !== value.changedAt) {
    fail('Pin the library revision, source binding and exact UTC time, and choose a folder action.');
  }
  canonical(value);
  const allowed = ['libraryId', 'expectedRevision', 'sourceBinding', 'changedAt', 'action', ...(value.action === 'create'
    ? ['folder'] : ['folderId', 'expectedFolderHash', value.action === 'change' ? 'changes' : 'confirmRemoval'])];
  if (Object.keys(value).some(key => !allowed.includes(key))) fail('Unknown folder command fields are not supported.');
  if (value.action === 'create') {
    if (!object(value.folder) || !id(value.folder.id) || typeof value.folder.name !== 'string'
      || !Object.hasOwn(value.folder, 'parentId') || (value.folder.parentId !== null && !id(value.folder.parentId))
      || Object.hasOwn(value.folder, 'collection')) fail('Creation requires a stable ID, name and explicit parent; the path is derived.');
  } else {
    if (!id(value.folderId) || !address(value.expectedFolderHash)) fail('Pin the selected folder ID and record hash.');
    if (value.action === 'remove' && value.confirmRemoval !== true) fail('Confirm folder removal while keeping its prompts.');
    if (value.action === 'change' && (!object(value.changes) || !Object.keys(value.changes).length
      || Object.keys(value.changes).some(key => !['name', 'parentId', 'artwork'].includes(key))
      || (Object.hasOwn(value.changes, 'name') && typeof value.changes.name !== 'string')
      || (Object.hasOwn(value.changes, 'parentId') && value.changes.parentId !== null && !id(value.changes.parentId))
      || (Object.hasOwn(value.changes, 'artwork') && (!object(value.changes.artwork) || !Object.keys(value.changes.artwork).length
        || Object.entries(value.changes.artwork).some(([key, field]) => !['icon', 'image', 'emoji'].includes(key) || typeof field !== 'string'))))) {
      fail('Change the name, parent or displayed artwork explicitly; preserve identity and other metadata.');
    }
  }
  return structuredClone(value);
}
