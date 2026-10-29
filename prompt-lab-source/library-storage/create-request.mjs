import { canonical, LibraryError } from './contract.mjs';

const object = value => value && Object.getPrototypeOf(value) === Object.prototype;
const address = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const ownedFields = new Set(['id', 'versions', 'currentVersionId', 'createdAt', 'updatedAt', 'updated_at',
  'schema_version', 'schemaVersion', 'version', 'deletedAt', 'tombstoneVersion']);
const fail = () => { throw new LibraryError('INVALID_CREATE', 'Creation requires a bound source, exact revision, stable identity, timestamp and draft fields; record identity and history are service-owned.', 409); };

export function normalizeCreateRequest(value) {
  if (!object(value) || Object.keys(value).some(key => !['libraryId', 'expectedRevision', 'sourceBinding', 'creationId', 'createdAt', 'record'].includes(key))
    || typeof value.libraryId !== 'string' || !value.libraryId || value.libraryId.length > 200
    || !address(value.expectedRevision) || !address(value.sourceBinding)
    || typeof value.creationId !== 'string' || !value.creationId || value.creationId.length > 200
    || typeof value.createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.createdAt)
    || !Number.isFinite(Date.parse(value.createdAt)) || new Date(value.createdAt).toISOString() !== value.createdAt
    || !object(value.record) || Object.keys(value.record).some(key => ownedFields.has(key))
    || (object(value.record.metadata) && Object.hasOwn(value.record.metadata, 'libraryGeneration'))) fail();
  canonical(value);
  return structuredClone(value);
}
