import { canonical, LibraryError, MAX_BYTES } from './contract.mjs';
import { normalizeCommandRequest } from './command-outbox.mjs';

export function createServiceTransport(service, { libraryId }) {
  return {
    async identity() { const state = await service.read(); return { libraryId: state.libraryId ?? libraryId, revision: state.revision }; },
    operation: operationId => service.operation(operationId),
    preview(value) {
      const { mode, ...input } = normalizeCommandRequest(value);
      if (input.libraryId !== libraryId) throw new LibraryError('WRONG_LIBRARY', 'Command targets another library.', 409);
      return mode === 'create' ? service.previewCreate(input) : mode === 'edit' ? service.previewEdit(input) : mode === 'select' ? service.previewCurrentView(input) : mode === 'restore' ? service.previewRestore(input)
        : mode === 'reconcile' ? service.previewReconcile(input) : service.preview({ ...input, mode });
    },
    apply(input) {
      if (input?.libraryId !== libraryId) throw new LibraryError('WRONG_LIBRARY', 'Command targets another library.', 409);
      return service.apply(input);
    },
    currentRecords: input => service.currentRecords({ ...input, libraryId }),
  };
}

/** Tokens are obtained at send time and never enter command or outbox records. */
export function createLoopbackTransport({ baseUrl, libraryId, getToken, folderBranch, fetchImpl = globalThis.fetch, timeoutMs = 30_000 }) {
  const base = new URL(baseUrl);
  if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || !base.port || base.pathname !== '/'
    || base.username || base.password || base.search || base.hash || typeof libraryId !== 'string' || !libraryId
    || typeof getToken !== 'function' || typeof fetchImpl !== 'function'
    || (folderBranch !== undefined && (typeof folderBranch !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(folderBranch)))
    || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new LibraryError('INVALID_TRANSPORT', 'A selected loopback service and scoped credential provider are required.');
  const pending = new Set(); let disconnected = false;
  async function request(path, { payload, operationId, missing = false } = {}) {
    if (disconnected) throw new LibraryError('DISCONNECTED', 'The library connection is disconnected.', 503);
    const controller = new AbortController(); pending.add(controller);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    function wait(value) {
      return new Promise((resolve, reject) => {
        const abort = () => reject(new LibraryError(disconnected ? 'DISCONNECTED' : 'SERVICE_UNAVAILABLE', 'Library request was interrupted. The pending command is retained.', 503));
        // Observe the supplied promise even when cancellation has already arrived.
        Promise.resolve(value).then(result => { controller.signal.removeEventListener('abort', abort); resolve(result); },
          error => { controller.signal.removeEventListener('abort', abort); reject(error); });
        if (controller.signal.aborted) abort();
        else controller.signal.addEventListener('abort', abort, { once: true });
      });
    }
    try {
      const token = await wait(getToken());
      if (disconnected) throw new LibraryError('DISCONNECTED', 'The library connection is disconnected.', 503);
      if (typeof token !== 'string' || token.length < 32) throw new LibraryError('UNAUTHORIZED', 'Pair this library connection before sending commands.', 401);
      const body = payload === undefined ? undefined : canonical(payload);
      if (body && new TextEncoder().encode(body).length > MAX_BYTES) throw new LibraryError('PAYLOAD_TOO_LARGE', 'Command exceeds the transport limit.', 413);
      const response = await wait(fetchImpl(new URL(path, base), { method: payload === undefined ? 'GET' : 'POST',
        headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(folderBranch ? { 'X-Library-Branch': folderBranch } : {}),
          ...(operationId ? { 'Idempotency-Key': operationId } : {}) },
        body, signal: controller.signal, redirect: 'error', cache: 'no-store', credentials: 'omit' }));
      const reader = response.body?.getReader();
      if (!reader) throw new LibraryError('INVALID_RESPONSE', 'Library service returned no response.', 503);
      let size = 0, text = ''; const decoder = new TextDecoder('utf-8', { fatal: true });
      try {
        while (true) {
          const chunk = await wait(reader.read()); if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > MAX_BYTES) { await reader.cancel(); throw new LibraryError('PAYLOAD_TOO_LARGE', 'Service response exceeds the transport limit.', 413); }
          text += decoder.decode(chunk.value, { stream: true });
        }
        text += decoder.decode();
      } finally { reader.releaseLock(); }
      let value;
      try { value = JSON.parse(text); } catch { throw new LibraryError('INVALID_RESPONSE', 'Library service returned unreadable data.', 503); }
      if (!response.ok) {
        if (missing && response.status === 404 && value?.code === 'NOT_FOUND') return null;
        const code = typeof value?.code === 'string' && /^[A-Z_]{1,64}$/.test(value.code) ? value.code : 'SERVICE_UNAVAILABLE';
        throw new LibraryError(code, 'Library request was not acknowledged. Keep the pending command and retry or review it.', response.status);
      }
      return value;
    } catch (error) {
      if (error instanceof LibraryError) throw error;
      throw new LibraryError(disconnected ? 'DISCONNECTED' : 'SERVICE_UNAVAILABLE', 'Library service is unavailable. The pending command is retained.', 503);
    } finally { clearTimeout(timer); pending.delete(controller); }
  }
  function bound(input) {
    if (input?.libraryId !== libraryId) throw new LibraryError('WRONG_LIBRARY', 'Command targets another paired library.', 409);
  }
  return {
    async identity() { const result = await request('/v1/library'); bound(result); return result; },
    operation: operationId => request(`/v1/library/operations/${encodeURIComponent(operationId)}`, { missing: true }),
    branches({ expectedGraph, cursor = '0', limit = 100 } = {}) {
      const query = new URLSearchParams({ cursor, limit: String(limit), ...(expectedGraph ? { graph: expectedGraph } : {}) });
      return request(`/v1/library/folder-branches?${query}`);
    },
    transfer(expectedRevision) { return request(`/v1/library/transfer?revision=${encodeURIComponent(expectedRevision)}`); },
    preview(value) {
      const command = normalizeCommandRequest(value); bound(command);
      const { mode, ...input } = command;
      const path = ({ create: 'creations', edit: 'edits', select: 'current-views', restore: 'restores', reconcile: 'reconciliations' })[mode];
      return request(`/v1/library/${path ?? 'previews'}`, { payload: path ? input : command });
    },
    apply(input) {
      bound(input); const { idempotencyKey, ...payload } = input;
      return request('/v1/library/commits', { payload, operationId: idempotencyKey });
    },
    currentRecords({ expectedRevision, domain, cursor = '0', limit = 100 }) {
      const query = new URLSearchParams({ revision: expectedRevision, cursor, limit: String(limit), ...(domain ? { domain } : {}) });
      return request(`/v1/library/current-records?${query}`);
    },
    disconnect() { disconnected = true; for (const controller of pending) controller.abort(); },
  };
}
