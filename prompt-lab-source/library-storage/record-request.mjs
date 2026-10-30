import { canonical, LibraryError } from './contract.mjs';

export const valueRecordDomains = Object.freeze(['drafts', 'assets', 'recovery', 'loaded-packs']);
export const recordDomains = Object.freeze({ evaluations: 'evaluations', 'test-cases': 'testCases',
  'execution-traces': 'traceRuns', experiments: 'experiments', packs: 'packs', 'scratch-notes': 'scratchNotes',
  ...Object.fromEntries(valueRecordDomains.map(domain => [domain, 'valueRecords'])) });
export const recordIdField = domain => domain === 'execution-traces' ? 'run_id' : 'id';
const object = value => value && Object.getPrototypeOf(value) === Object.prototype;
const address = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const id = value => typeof value === 'string' && value.trim() && value.length <= 200;
const unsafe = new Set(['__proto__', 'prototype', 'constructor']);
const fail = message => { throw new LibraryError('INVALID_RECORD_COMMAND', message, 409); };

/** Browser-safe input validation shared by the service and durable outbox. */
export function normalizeRecordRequest(value) {
  if (!object(value) || !id(value.libraryId) || !address(value.expectedRevision)
    || !Object.hasOwn(recordDomains, value.domain) || !['create', 'update', 'replace', 'delete'].includes(value.action)
    || typeof value.changedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.changedAt)
    || !Number.isFinite(Date.parse(value.changedAt)) || new Date(value.changedAt).toISOString() !== value.changedAt) {
    fail('A supported record domain, action, library revision and exact UTC timestamp are required.');
  }
  canonical(value);
  const valueRecord = valueRecordDomains.includes(value.domain);
  if ((value.action === 'replace' && !valueRecord)
    || (value.domain === 'loaded-packs' && !['create', 'delete'].includes(value.action))) {
    fail('Only value records support replacement; loaded-pack identities support creation and deletion.');
  }
  const allowed = ['libraryId', 'expectedRevision', 'domain', 'action', 'changedAt', ...(value.action === 'create'
    ? ['sourceBinding', 'record', ...(valueRecord ? ['recordId'] : [])]
    : ['groupId', 'expectedRecordHash', value.action === 'update' ? 'updates' : value.action === 'replace' ? 'value' : 'confirmPermanentDeletion'])];
  if (Object.keys(value).some(key => !allowed.includes(key))) fail('Unknown record command fields are not supported.');
  const request = structuredClone(value);
  if (request.action === 'create') {
    if (!address(request.sourceBinding) || !Object.hasOwn(request, 'record') || (valueRecord
      ? !id(request.recordId) : !object(request.record) || !id(request.record[recordIdField(request.domain)]))) {
      fail('Creation requires a verified source binding, complete value and stable record ID.');
    }
    if (request.domain === 'loaded-packs' && request.record !== request.recordId) fail('A loaded-pack marker must equal its stable pack ID.');
    if (request.domain === 'scratch-notes' && ['createdAt', 'updatedAt', 'timestamp'].some(key => Object.hasOwn(request.record, key))) {
      fail('Scratch creation times are supplied by the reviewed command time.');
    }
  } else {
    if (!address(request.groupId) || !address(request.expectedRecordHash)) fail('Update and deletion require the selected group and exact record hash.');
    if (request.action === 'delete' && request.confirmPermanentDeletion !== true) fail('Confirm permanent deletion from the current view; recovery content remains retained.');
    if (request.action === 'replace' && !Object.hasOwn(request, 'value')) fail('Replacement requires the complete next value.');
    if (request.action === 'update') {
      if (!Array.isArray(request.updates) || !request.updates.length || request.updates.length > 100) fail('Provide between 1 and 100 explicit field updates.');
      const paths = [];
      for (const update of request.updates) {
        if (!object(update) || Object.keys(update).length !== 2 || !Object.hasOwn(update, 'value') || !Array.isArray(update.path)
          || !update.path.length || update.path.length > 32
          || update.path.some(key => typeof key !== 'string' || !key || key.length > 200 || unsafe.has(key))
          || [recordIdField(request.domain), 'createdAt', 'started_at', ...(request.domain === 'scratch-notes' ? ['updatedAt', 'timestamp'] : [])].includes(update.path[0])) fail('Update object fields explicitly and preserve the record identity and creation time.');
        if (paths.some(path => path.slice(0, update.path.length).every((key, i) => key === update.path[i])
          || update.path.slice(0, path.length).every((key, i) => key === path[i]))) fail('Field updates cannot overlap or repeat.');
        paths.push(update.path);
      }
    }
  }
  return request;
}
