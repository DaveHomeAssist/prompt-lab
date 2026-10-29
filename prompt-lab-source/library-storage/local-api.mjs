import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { createCommandService, readObject, canonical, MAX_BYTES, LibraryError } from './contract.mjs';

export function createLocalApi({ adapter, libraryId, credentials, allowedOrigins = [], requestsPerMinute = 60 }) {
  if (!libraryId || !Array.isArray(credentials) || !credentials.length || credentials.some(c => typeof c.token !== 'string' || c.token.length < 32 || !Array.isArray(c.scopes) || !Number.isFinite(c.expiresAt))) throw new Error('A bound library and expiring scoped credentials are required.');
  const rootService = createCommandService(adapter), recoveryServices = new Map();
  const windows = new Map();
  function credential(authorization) {
    const candidate = Buffer.from((authorization ?? '').replace(/^Bearer /, ''));
    return credentials.find(c => {
      const expected = Buffer.from(c.token);
      return candidate.length === expected.length && timingSafeEqual(candidate, expected);
    });
  }
  async function body(req) {
    const chunks = []; let length = 0;
    for await (const chunk of req) {
      length += chunk.length;
      if (length > MAX_BYTES) throw new LibraryError('PAYLOAD_TOO_LARGE', 'Request exceeds 64 MiB.', 413);
      chunks.push(chunk);
    }
    let value;
    try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new LibraryError('INVALID_JSON', 'Request must be valid JSON.', 400); }
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new LibraryError('INVALID_REQUEST', 'Request must be a JSON object.', 400);
    return value;
  }
  const server = createServer(async (req, res) => {
    const send = (status, payload) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify(payload));
    };
    try {
      const address = server.address();
      if (!['127.0.0.1', '::ffff:127.0.0.1', '::1'].includes(req.socket.remoteAddress)) throw new LibraryError('FORBIDDEN', 'Loopback access only.', 403);
      if (req.headers.host !== `127.0.0.1:${address.port}`) throw new LibraryError('FORBIDDEN_HOST', 'Host is not the bound loopback address.', 403);
      const origin = req.headers.origin;
      if (origin && !allowedOrigins.includes(origin)) throw new LibraryError('FORBIDDEN_ORIGIN', 'Origin is not paired.', 403);
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
      }
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Idempotency-Key, X-Library-Branch');
        return send(200, { ok: true });
      }
      const user = credential(req.headers.authorization);
      if (!user || (user.expiresAt != null && Date.now() >= user.expiresAt) || user.revoked === true) throw new LibraryError('UNAUTHORIZED', 'Valid scoped authorization is required.', 401);
      const write = req.method !== 'GET';
      if (!user.scopes.includes(write ? 'write' : 'read')) throw new LibraryError('FORBIDDEN', 'Credential scope does not permit this operation.', 403);
      const window = windows.get(user) ?? { start: Date.now(), count: 0 };
      if (Date.now() - window.start >= 60_000) { window.start = Date.now(); window.count = 0; }
      windows.set(user, window);
      if (++window.count > requestsPerMinute) { res.setHeader('Retry-After', '60'); throw new LibraryError('RATE_LIMIT', 'Local request limit reached.', 429); }
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.searchParams.has('token') || url.searchParams.has('key')) throw new LibraryError('INVALID_REQUEST', 'Credentials cannot be supplied in URLs.', 400);
      if (req.method === 'GET' && url.pathname === '/v1/library/folder-branches') {
        if (!adapter.branches) throw new LibraryError('UNSUPPORTED_OPERATION', 'This backend has no folder branch inspection.', 409);
        const keys = [...url.searchParams.keys()];
        if (keys.some(key => !['graph', 'cursor', 'limit'].includes(key)) || keys.length !== new Set(keys).size) throw new LibraryError('INVALID_REQUEST', 'Invalid branch query.', 400);
        return send(200, await adapter.branches({ libraryId, expectedGraph: url.searchParams.get('graph') ?? undefined,
          cursor: url.searchParams.get('cursor') ?? '0', limit: Number(url.searchParams.get('limit') ?? 100) }));
      }
      const selectedBranch = req.headers['x-library-branch'];
      let service = rootService, selectedAdapter = adapter;
      if (selectedBranch !== undefined) {
        if (typeof selectedBranch !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(selectedBranch)) throw new LibraryError('INVALID_REQUEST', 'Select a verified folder branch.', 400);
        if (!adapter.selectBranch) throw new LibraryError('UNSUPPORTED_OPERATION', 'This backend has no folder recovery view.', 409);
        for (const [key, value] of recoveryServices) if (Date.now() - value.usedAt > 300_000) recoveryServices.delete(key);
        let recovery = recoveryServices.get(selectedBranch);
        if (!recovery) {
          if (recoveryServices.size >= 32) throw new LibraryError('RECOVERY_LIMIT', 'Too many active recovery views. Retain pending commands and retry later.', 429);
          const selected = await adapter.selectBranch(selectedBranch);
          if ((await selected.read()).libraryId !== libraryId) throw new LibraryError('WRONG_LIBRARY', 'Folder belongs to another library.', 409);
          recovery = { adapter: selected, service: createCommandService(selected) };
          recoveryServices.set(selectedBranch, recovery);
        }
        recovery.usedAt = Date.now(); service = recovery.service; selectedAdapter = recovery.adapter;
      }
      let state;
      try { state = await selectedAdapter.read(); }
      catch (error) { if (error.code === 'FOLDER_CHANGED' && selectedBranch) recoveryServices.delete(selectedBranch); throw error; }
      if (state.libraryId && state.libraryId !== libraryId) throw new LibraryError('WRONG_LIBRARY', 'Selected folder contains another library.', 409);
      if (selectedBranch && req.method !== 'GET' && !['/v1/library/reconciliations', '/v1/library/commits'].includes(url.pathname)) {
        throw new LibraryError('RECOVERY_ONLY', 'Recovery views accept reviewed reconciliation only.', 409);
      }
      if (req.method === 'GET' && url.pathname === '/v1/library') return send(200, { libraryId, revision: state.revision, backend: 'folder', cloudReplication: 'unknown', independentBackup: 'unknown',
        ...(selectedBranch ? { folderRecovery: await selectedAdapter.recoveryContext() } : {}) });
      if (req.method === 'GET' && url.pathname === '/v1/library/transfer') {
        if ([...url.searchParams.keys()].some(key => key !== 'revision') || url.searchParams.getAll('revision').length !== 1) throw new LibraryError('INVALID_REQUEST', 'Pin the complete transfer to one revision.', 400);
        const transfer = await service.transfer({ libraryId, expectedRevision: url.searchParams.get('revision') });
        if (Buffer.byteLength(canonical(transfer)) > MAX_BYTES) throw new LibraryError('PAYLOAD_TOO_LARGE', 'Complete transfer exceeds the bounded HTTP response limit.', 413);
        return send(200, transfer);
      }
      if (req.method === 'GET' && ['/v1/library/records', '/v1/library/current-records'].includes(url.pathname)) {
        const keys = [...url.searchParams.keys()];
        if (keys.some(key => !['revision', 'domain', 'cursor', 'limit'].includes(key)) || new Set(keys).size !== keys.length) throw new LibraryError('INVALID_REQUEST', 'Invalid record query.', 400);
        const read = url.pathname === '/v1/library/current-records' ? service.currentRecords : service.records;
        return send(200, await read({ libraryId, expectedRevision: url.searchParams.get('revision'),
          domain: url.searchParams.get('domain') ?? undefined,
          cursor: url.searchParams.get('cursor') ?? '0', limit: Number(url.searchParams.get('limit') ?? 100) }));
      }
      if (req.method === 'GET' && url.pathname === '/v1/library/backups') {
        return send(200, await service.backups({ libraryId, expectedRevision: url.searchParams.get('revision'),
          cursor: url.searchParams.get('cursor') ?? '0', limit: Number(url.searchParams.get('limit') ?? 100) }));
      }
      if (req.method === 'GET' && url.pathname === '/v1/library/snapshot') {
        if (url.searchParams.get('revision') !== state.revision) throw new LibraryError('REVISION_CONFLICT', 'Pin snapshot reads to the current revision.', 409);
        const limit = Number(url.searchParams.get('limit') ?? 100), offset = Number(url.searchParams.get('cursor') ?? 0);
        if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0) throw new LibraryError('INVALID_REQUEST', 'Invalid pagination.', 400);
        const ids = Object.keys(state.objects).sort();
        const commit = await readObject(state.objects, state.revision, 'commit');
        const stateKind = ['import', 'restore', 'reconcile', 'select', 'edit', 'create', 'lifecycle', 'record', 'folder', 'pack'].includes(commit.operation) ? 'library-state' : 'workspace';
        await readObject(state.objects, commit.state, stateKind);
        return send(200, { libraryId, revision: state.revision, stateHash: commit.state, stateKind, objects: ids.slice(offset, offset + limit), nextCursor: offset + limit < ids.length ? String(offset + limit) : null });
      }
      if (req.method === 'GET' && url.pathname.startsWith('/v1/library/objects/')) {
        const id = decodeURIComponent(url.pathname.slice('/v1/library/objects/'.length));
        if (!/^sha256:[a-f0-9]{64}$/.test(id)) throw new LibraryError('INVALID_REQUEST', 'Invalid object hash.', 400);
        const object = state.objects[id];
        if (!object) throw new LibraryError('NOT_FOUND', 'Unknown object.', 404);
        await readObject(state.objects, id, object.kind);
        return send(200, object);
      }
      if (req.method === 'GET' && url.pathname.startsWith('/v1/library/operations/')) {
        const receipt = await service.operation(decodeURIComponent(url.pathname.slice('/v1/library/operations/'.length)));
        if (!receipt) throw new LibraryError('NOT_FOUND', 'Unknown operation.', 404);
        return send(200, receipt);
      }
      if (req.method === 'GET' && url.pathname.startsWith('/v1/library/previews/')) {
        return send(200, await service.previewRead(decodeURIComponent(url.pathname.slice('/v1/library/previews/'.length))));
      }
      if (req.method === 'POST' && url.pathname === '/v1/library/previews') {
        if (!req.headers['content-type']?.startsWith('application/json')) throw new LibraryError('INVALID_REQUEST', 'Use application/json.', 400);
        const input = await body(req);
        if (input.libraryId !== libraryId) throw new LibraryError('WRONG_LIBRARY', 'Request targets another library.', 409);
        return send(201, await service.preview(input));
      }
      if (req.method === 'POST' && url.pathname === '/v1/library/commits') {
        const input = await body(req);
        if (input.libraryId !== libraryId) throw new LibraryError('WRONG_LIBRARY', 'Request targets another library.', 409);
        return send(201, await service.apply({ ...input, idempotencyKey: req.headers['idempotency-key'] }));
      }
      if (req.method === 'POST' && url.pathname === '/v1/library/reconciliations') {
        if (!req.headers['content-type']?.startsWith('application/json')) throw new LibraryError('INVALID_REQUEST', 'Use application/json.', 400);
        const input = await body(req);
        if (input.libraryId !== libraryId) throw new LibraryError('WRONG_LIBRARY', 'Request targets another library.', 409);
        return send(201, await service.previewReconcile(input));
      }
      if (req.method === 'POST' && url.pathname === '/v1/library/current-views') {
        if (!req.headers['content-type']?.startsWith('application/json')) throw new LibraryError('INVALID_REQUEST', 'Use application/json.', 400);
        const input = await body(req);
        if (input.libraryId !== libraryId) throw new LibraryError('WRONG_LIBRARY', 'Request targets another library.', 409);
        return send(201, await service.previewCurrentView(input));
      }
      if (req.method === 'POST' && url.pathname === '/v1/library/pack-mutations') {
        if (!req.headers['content-type']?.startsWith('application/json')) throw new LibraryError('INVALID_REQUEST', 'Use application/json.', 400);
        const input = await body(req);
        if (input.libraryId !== libraryId) throw new LibraryError('WRONG_LIBRARY', 'Request targets another library.', 409);
        return send(201, await service.previewPack(input));
      }
      if (req.method === 'POST' && url.pathname === '/v1/library/folder-mutations') {
        if (!req.headers['content-type']?.startsWith('application/json')) throw new LibraryError('INVALID_REQUEST', 'Use application/json.', 400);
        const input = await body(req);
        if (input.libraryId !== libraryId) throw new LibraryError('WRONG_LIBRARY', 'Request targets another library.', 409);
        return send(201, await service.previewFolder(input));
      }
      if (req.method === 'POST' && url.pathname === '/v1/library/record-mutations') {
        if (!req.headers['content-type']?.startsWith('application/json')) throw new LibraryError('INVALID_REQUEST', 'Use application/json.', 400);
        const input = await body(req);
        if (input.libraryId !== libraryId) throw new LibraryError('WRONG_LIBRARY', 'Request targets another library.', 409);
        return send(201, await service.previewRecord(input));
      }
      if (req.method === 'POST' && url.pathname === '/v1/library/lifecycles') {
        if (!req.headers['content-type']?.startsWith('application/json')) throw new LibraryError('INVALID_REQUEST', 'Use application/json.', 400);
        const input = await body(req);
        if (input.libraryId !== libraryId) throw new LibraryError('WRONG_LIBRARY', 'Request targets another library.', 409);
        return send(201, await service.previewLifecycle(input));
      }
      if (req.method === 'POST' && url.pathname === '/v1/library/creations') {
        if (!req.headers['content-type']?.startsWith('application/json')) throw new LibraryError('INVALID_REQUEST', 'Use application/json.', 400);
        const input = await body(req);
        if (input.libraryId !== libraryId) throw new LibraryError('WRONG_LIBRARY', 'Request targets another library.', 409);
        return send(201, await service.previewCreate(input));
      }
      if (req.method === 'POST' && url.pathname === '/v1/library/edits') {
        if (!req.headers['content-type']?.startsWith('application/json')) throw new LibraryError('INVALID_REQUEST', 'Use application/json.', 400);
        const input = await body(req);
        if (input.libraryId !== libraryId) throw new LibraryError('WRONG_LIBRARY', 'Request targets another library.', 409);
        return send(201, await service.previewEdit(input));
      }
      if (req.method === 'POST' && url.pathname === '/v1/library/restores') {
        if (!req.headers['content-type']?.startsWith('application/json')) throw new LibraryError('INVALID_REQUEST', 'Use application/json.', 400);
        const input = await body(req);
        if (input.libraryId !== libraryId) throw new LibraryError('WRONG_LIBRARY', 'Request targets another library.', 409);
        return send(201, await service.previewRestore(input));
      }
      throw new LibraryError('NOT_FOUND', 'Operation is not available in this contract candidate.', 404);
    } catch (error) {
      send(error instanceof LibraryError ? error.status : 503, { ok: false, code: error instanceof LibraryError ? error.code : 'STORAGE_UNAVAILABLE', error: error instanceof LibraryError ? error.message : 'Storage unavailable; keep your draft and retry.', retryable: false });
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  return {
    service: rootService,
    async listen(port = 0) { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); }); return `http://127.0.0.1:${server.address().port}`; },
    async close() { server.closeAllConnections(); await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); },
  };
}
