import { canonical, LibraryError } from './contract.mjs';

const object = value => value && Object.getPrototypeOf(value) === Object.prototype;
const address = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const protectedFields = new Set(['id', 'versions', 'currentVersionId', 'createdAt', 'updatedAt', 'updated_at',
  'schema_version', 'schemaVersion', 'version', 'deletedAt', 'tombstoneVersion']);
const unsafeKeys = new Set(['__proto__', 'prototype', 'constructor']);
const fail = (code, message) => { throw new LibraryError(code, message, 409); };

export function normalizeEditRequest(value) {
  if (!object(value) || Object.keys(value).some(key => !['libraryId', 'expectedRevision', 'groupId', 'expectedRecordHash', 'updates', 'editedAt'].includes(key))
    || typeof value.libraryId !== 'string' || !value.libraryId || value.libraryId.length > 200
    || !address(value.expectedRevision) || !address(value.groupId) || !address(value.expectedRecordHash)
    || typeof value.editedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.editedAt)
    || !Number.isFinite(Date.parse(value.editedAt)) || new Date(value.editedAt).toISOString() !== value.editedAt
    || !Array.isArray(value.updates) || value.updates.length < 1 || value.updates.length > 100) {
    fail('INVALID_EDIT', 'An edit requires a selected prompt, exact revision and record hash, timestamp and field updates.');
  }
  canonical(value);
  const request = structuredClone(value), paths = [];
  for (const update of request.updates) {
    if (!object(update) || Object.keys(update).length !== 2 || !Object.hasOwn(update, 'value') || !Array.isArray(update.path)
      || !update.path.length || update.path.length > 32
      || update.path.some(key => typeof key !== 'string' || !key || key.length > 200 || unsafeKeys.has(key))
      || protectedFields.has(update.path[0])) fail('INVALID_EDIT', 'Update object fields explicitly; identity and version history are service-owned.');
    if (paths.some(path => path.slice(0, update.path.length).every((key, i) => key === update.path[i])
      || update.path.slice(0, path.length).every((key, i) => key === path[i]))) fail('INVALID_EDIT', 'Field updates cannot overlap or repeat.');
    paths.push(update.path);
  }
  return request;
}
