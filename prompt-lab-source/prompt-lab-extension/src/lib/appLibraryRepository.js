import { canonical, hash, LibraryError } from '../../../library-storage/contract.mjs';
import { createCommandOutbox } from '../../../library-storage/command-outbox.mjs';
import { recordIdField } from '../../../library-storage/record-request.mjs';
import { createIndexedCommandStore } from './libraryCommandOutbox.js';
import { APP_RECORD_VERSION } from './appRecordVersion.js';

export { APP_RECORD_VERSION } from './appRecordVersion.js';
const supported = new Set(['evaluations', 'test-cases', 'execution-traces', 'experiments']);
const address = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const object = value => value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
const fail = (code, message) => { throw new LibraryError(code, message, 409); };

function fieldUpdates(previous, next, prefix = []) {
  const result = [];
  for (const [key, value] of Object.entries(next)) {
    if (canonical(previous?.[key] ?? null) === canonical(value) && Object.hasOwn(previous ?? {}, key)) continue;
    const path = [...prefix, key];
    if (object(value) && object(previous?.[key]) && Object.keys(value).length) result.push(...fieldUpdates(previous[key], value, path));
    else if (object(value) && object(previous?.[key]) && !Object.keys(value).length) continue;
    else result.push({ path, value });
  }
  return result;
}

/** Explicit connection dependency. Constructing it never activates app storage. */
export function createAppLibraryRepository({ libraryId, sourceBinding, transport,
  outbox = createCommandOutbox(createIndexedCommandStore()), now = () => Date.now(), pageSize = 100,
} = {}) {
  if (typeof libraryId !== 'string' || !libraryId || libraryId.length > 200 || !address(sourceBinding)
    || !transport || ['identity', 'currentRecords', 'preview', 'apply', 'operation'].some(key => typeof transport[key] !== 'function')
    || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new TypeError('A selected library, source and complete transport are required.');
  let snapshot = null, closed = false, queue = Promise.resolve();
  const assertConnected = () => { if (closed) fail('DISCONNECTED', 'The library is disconnected. Pending changes are retained.'); };
  function serial(operation) {
    const result = queue.then(() => { assertConnected(); return operation(); });
    queue = result.catch(() => {}); return result;
  }
  function domainCheck(domain) {
    if (!supported.has(domain)) fail('UNSUPPORTED_APP_DOMAIN', 'This app record connection does not own that data.');
  }
  async function refresh() {
    assertConnected();
    const identity = await transport.identity();
    assertConnected();
    if (identity.libraryId !== libraryId || !address(identity.revision)) fail('WRONG_LIBRARY', 'Reconnect to the selected, reviewed library.');
    // The cache owns validated clones. Always check the service revision first.
    if (snapshot?.revision === identity.revision) return snapshot;
    let cursor = '0', total, groups, groupText;
    const items = [], keys = new Set();
    do {
      const page = await transport.currentRecords({ expectedRevision: identity.revision, cursor, limit: pageSize });
      assertConnected();
      if (page?.format !== 'promptlab-current-view-page' || page.schemaVersion !== 1 || page.view !== 'reviewed'
        || page.libraryId !== libraryId || page.revision !== identity.revision || page.domain !== null
        || !Number.isSafeInteger(page.total) || page.total < 0 || page.total > 100_000
        || !Array.isArray(page.items) || page.items.length > pageSize || !Array.isArray(page.groups)
        || (total !== undefined && total !== page.total)) fail('INVALID_RESPONSE', 'The library read was incomplete or changed during paging.');
      total = page.total;
      const text = canonical(page.groups);
      if (groupText !== undefined && groupText !== text) fail('INVALID_RESPONSE', 'The library selection changed during paging.');
      groups ??= structuredClone(page.groups); groupText = text;
      for (const row of page.items) {
        if (!address(row?.key) || keys.has(row.key) || !address(row.valueHash) || await hash(row.value) !== row.valueHash
          || typeof row.domain !== 'string' || (row.parent !== null && !address(row.parent))) {
          fail('INVALID_RESPONSE', 'A library record failed its identity or content check.');
        }
        keys.add(row.key); items.push(structuredClone(row));
      }
      const expectedNext = items.length < total ? String(items.length) : null;
      if (items.length > total || page.nextCursor !== expectedNext || (expectedNext !== null && !page.items.length)) {
        fail('INVALID_RESPONSE', 'The library read omitted or repeated records.');
      }
      cursor = page.nextCursor;
    } while (cursor !== null);
    const byKey = new Map(items.map(row => [row.key, row])), roots = new Map();
    const groupIds = new Set();
    for (const group of groups) {
      if (!address(group?.id) || groupIds.has(group.id) || (group.selected !== null
        && (!byKey.has(group.selected) || byKey.get(group.selected).domain !== group.domain))) {
        fail('INVALID_RESPONSE', 'The library selection omitted or repeated a record.');
      }
      groupIds.add(group.id);
      if (group.selected !== null) roots.set(group.selected, group);
    }
    for (const row of items) {
      const seen = new Set(); let owner = row;
      while (owner && !roots.has(owner.key)) {
        if (seen.has(owner.key)) fail('INVALID_RESPONSE', 'The library record ancestry is invalid.');
        seen.add(owner.key); owner = byKey.get(owner.parent);
      }
      if (!owner) fail('INVALID_RESPONSE', 'The library returned a record outside its reviewed selection.');
    }
    const after = await transport.identity(); assertConnected();
    if (after.libraryId !== libraryId || after.revision !== identity.revision) fail('REVISION_CONFLICT', 'The library changed during readback. Retry the read.');
    snapshot = { libraryId, revision: identity.revision, items, groups };
    return snapshot;
  }
  function selected(domain, id) {
    const rows = snapshot.items.filter(row => row.domain === domain && row.sourceId === id);
    if (rows.length > 1) fail('AMBIGUOUS_RECORD_IDENTITY', 'More than one retained record has this ID. Review its source before editing.');
    return rows[0] ?? null;
  }
  function valueOf(row) {
    if (!row) return null;
    const value = structuredClone(row.value), group = snapshot.groups.find(group => group.selected === row.key && group.domain === row.domain);
    if (!object(value) || !group || !address(group.id)) fail('INVALID_RESPONSE', 'The selected app record needs recovery.');
    value[APP_RECORD_VERSION] = Object.freeze({ libraryId, revision: snapshot.revision, domain: row.domain,
      sourceId: row.sourceId, groupId: group.id, valueHash: row.valueHash });
    return value;
  }
  async function replayPending() {
    for (const entry of await outbox.list(libraryId)) {
      assertConnected();
      if (entry.state !== 'committed') await outbox.replay(libraryId, entry.operationId, transport);
    }
  }
  async function publish(request, operationId) {
    const retained = await outbox.read(libraryId, operationId);
    if (!retained) {
      if ((await outbox.list(libraryId)).some(row => row.state !== 'committed')) {
        fail('LIBRARY_WRITES_PENDING', 'Resolve the retained pending change before saving another change.');
      }
      await outbox.stage({ request, operationId });
    }
    assertConnected();
    const committed = await outbox.replay(libraryId, operationId, transport);
    assertConnected();
    await refresh();
    return committed;
  }
  return Object.freeze({
    libraryId,
    async open() { return serial(async () => { await replayPending(); await refresh(); return { libraryId, revision: snapshot.revision }; }); },
    async readDomain(domain) {
      domainCheck(domain);
      return serial(async () => { await refresh(); return snapshot.items.filter(row => row.domain === domain).map(valueOf); });
    },
    async readRecord(domain, id) {
      domainCheck(domain);
      return serial(async () => { await refresh(); return valueOf(selected(domain, id)); });
    },
    async readObservedRecord(domain, id) {
      domainCheck(domain);
      return serial(() => {
        if (!snapshot) fail('LIBRARY_NOT_OPEN', 'Open the library before editing its records.');
        // This is an editing base, not a claim that the service is current.
        // The durable intent retains its revision and must pass service review.
        return valueOf(selected(domain, id));
      });
    },
    async saveRecord(domain, record) {
      domainCheck(domain);
      const version = record?.[APP_RECORD_VERSION];
      const { [APP_RECORD_VERSION]: ignored, ...value } = record ?? {};
      const input = structuredClone(value); canonical(input);
      const idKey = recordIdField(domain), id = input[idKey];
      if (typeof id !== 'string' || !id || id.length > 200) fail('INVALID_RECORD_COMMAND', 'A stable record identity is required.');
      return serial(async () => {
        if (!snapshot) await refresh();
        const row = selected(domain, id);
        const mutable = Object.fromEntries(Object.entries(input).filter(([key]) => ![idKey, 'createdAt', 'started_at'].includes(key)));
        const updates = row ? fieldUpdates(row.value, mutable) : null;
        if (row && !updates.length) {
          const identity = await transport.identity(); assertConnected();
          if (identity.libraryId !== libraryId || identity.revision !== snapshot.revision) {
            fail('REVISION_CONFLICT', 'The library changed. Reload its current version before saving.');
          }
          if ((await outbox.list(libraryId)).some(entry => entry.state !== 'committed')) {
            fail('LIBRARY_WRITES_PENDING', 'Recover the retained pending change before acknowledging another save.');
          }
          return valueOf(row);
        }
        if (row && (!version || version.libraryId !== libraryId || version.domain !== domain || version.sourceId !== id
          || version.revision !== snapshot.revision || version.valueHash !== row.valueHash
          || !snapshot.groups.some(group => group.id === version.groupId && group.selected === row.key))) {
          fail('RECORD_CONFLICT', 'This record changed or has no saved version. Keep the edit and reload its current version.');
        }
        if (!row && version) fail('RECORD_TARGET_UNAVAILABLE', 'The edited record is no longer active. Keep the edit for recovery.');
        const baseRevision = snapshot.revision;
        const operationId = 'app-record:' + (await hash({ libraryId, domain, baseRevision, input })).slice(7);
        const request = { mode: 'record', libraryId, expectedRevision: baseRevision, domain,
          changedAt: new Date(now()).toISOString(), ...(row
            ? { action: 'update', groupId: version.groupId, expectedRecordHash: row.valueHash, updates }
            : { action: 'create', sourceBinding, record: input }) };
        await publish(request, operationId);
        const saved = selected(domain, id);
        if (!saved || fieldUpdates(saved.value, mutable).length) {
          fail('RECORD_CONFLICT', 'Another edit followed this save. Your committed change is retained; review the current record.');
        }
        return valueOf(saved);
      });
    },
    async deleteRecord(domain, id, version) {
      domainCheck(domain);
      return serial(async () => {
        if (!snapshot) await refresh();
        const row = selected(domain, id);
        if (!row) {
          const identity = await transport.identity(); assertConnected();
          if (identity.libraryId !== libraryId || identity.revision !== snapshot.revision) {
            fail('REVISION_CONFLICT', 'The library changed. Reload before deleting this record.');
          }
          if ((await outbox.list(libraryId)).some(entry => entry.state !== 'committed')) {
            fail('LIBRARY_WRITES_PENDING', 'Recover the retained pending change before acknowledging deletion.');
          }
          return;
        }
        if (!version || version.libraryId !== libraryId || version.domain !== domain || version.sourceId !== id
          || version.revision !== snapshot.revision || version.valueHash !== row.valueHash
          || !snapshot.groups.some(group => group.id === version.groupId && group.selected === row.key)) {
          fail('RECORD_CONFLICT', 'Reload this record before deleting it. Pending edits are retained.');
        }
        const operationId = 'app-delete:' + (await hash(version)).slice(7);
        await publish({ mode: 'record', libraryId, expectedRevision: snapshot.revision, domain, action: 'delete',
          groupId: version.groupId, expectedRecordHash: row.valueHash, changedAt: new Date(now()).toISOString(),
          confirmPermanentDeletion: true }, operationId);
      });
    },
    async pending() { return outbox.list(libraryId); },
    async resume() { return serial(async () => { await replayPending(); await refresh(); return { libraryId, revision: snapshot.revision }; }); },
    disconnect() { closed = true; transport.disconnect?.(); },
  });
}
