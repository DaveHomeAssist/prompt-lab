import { canonical, LibraryError } from './contract.mjs';

export const recordDomains = Object.freeze({ evaluations: 'evaluations', 'test-cases': 'testCases',
  'execution-traces': 'traceRuns', experiments: 'experiments', packs: 'packs' });
export const recordIdField = domain => domain === 'execution-traces' ? 'run_id' : 'id';
const object = value => value && Object.getPrototypeOf(value) === Object.prototype;
const address = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const id = value => typeof value === 'string' && value.trim() && value.length <= 200;
const unsafe = new Set(['__proto__', 'prototype', 'constructor']);
const fail = message => { throw new LibraryError('INVALID_RECORD_COMMAND', message, 409); };

/** Browser-safe input validation shared by the service and durable outbox. */
export function normalizeRecordRequest(value) {
  if (!object(value) || !id(value.libraryId) || !address(value.expectedRevision)
    || !Object.hasOwn(recordDomains, value.domain) || !['create', 'update', 'delete'].includes(value.action)
    || typeof value.changedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.changedAt)
    || !Number.isFinite(Date.parse(value.changedAt)) || new Date(value.changedAt).toISOString() !== value.changedAt) {
    fail('A supported record domain, action, library revision and exact UTC timestamp are required.');
  }
  canonical(value);
  const allowed = ['libraryId', 'expectedRevision', 'domain', 'action', 'changedAt', ...(value.action === 'create'
    ? ['sourceBinding', 'record'] : ['groupId', 'expectedRecordHash', value.action === 'update' ? 'updates' : 'confirmPermanentDeletion'])];
  if (Object.keys(value).some(key => !allowed.includes(key))) fail('Unknown record command fields are not supported.');
  const request = structuredClone(value);
  if (request.action === 'create') {
    if (!address(request.sourceBinding) || !object(request.record) || !id(request.record[recordIdField(request.domain)])) {
      fail('Creation requires an explicit verified source binding and a complete record with a stable ID.');
    }
  } else {
    if (!address(request.groupId) || !address(request.expectedRecordHash)) fail('Update and deletion require the selected group and exact record hash.');
    if (request.action === 'delete' && request.confirmPermanentDeletion !== true) fail('Confirm permanent deletion from the current view; recovery content remains retained.');
    if (request.action === 'update') {
      if (!Array.isArray(request.updates) || !request.updates.length || request.updates.length > 100) fail('Provide between 1 and 100 explicit field updates.');
      const paths = [];
      for (const update of request.updates) {
        if (!object(update) || Object.keys(update).length !== 2 || !Object.hasOwn(update, 'value') || !Array.isArray(update.path)
          || !update.path.length || update.path.length > 32
          || update.path.some(key => typeof key !== 'string' || !key || key.length > 200 || unsafe.has(key))
          || [recordIdField(request.domain), 'createdAt', 'started_at'].includes(update.path[0])) fail('Update object fields explicitly and preserve the record identity and creation time.');
        if (paths.some(path => path.slice(0, update.path.length).every((key, i) => key === update.path[i])
          || update.path.slice(0, path.length).every((key, i) => key === path[i]))) fail('Field updates cannot overlap or repeat.');
        paths.push(update.path);
      }
    }
  }
  return request;
}
