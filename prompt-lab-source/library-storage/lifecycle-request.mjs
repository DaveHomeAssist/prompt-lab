import { canonical, LibraryError } from './contract.mjs';

const object = value => value && Object.getPrototypeOf(value) === Object.prototype;
const address = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);

export function normalizeLifecycleRequest(value) {
  if (!object(value) || Object.keys(value).some(key => !['libraryId', 'expectedRevision', 'groupId', 'expectedRecordHash',
    'action', 'changedAt', 'confirmPermanentDeletion'].includes(key))
    || typeof value.libraryId !== 'string' || !value.libraryId || value.libraryId.length > 200
    || !address(value.expectedRevision) || !address(value.groupId) || !address(value.expectedRecordHash)
    || !['trash', 'restore', 'delete'].includes(value.action)
    || value.confirmPermanentDeletion !== (value.action === 'delete')
    || typeof value.changedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.changedAt)
    || !Number.isFinite(Date.parse(value.changedAt)) || new Date(value.changedAt).toISOString() !== value.changedAt) {
    throw new LibraryError('INVALID_LIFECYCLE', 'Lifecycle changes require an exact selected record, action, timestamp and explicit permanent-deletion confirmation.', 409);
  }
  canonical(value);
  return structuredClone(value);
}
