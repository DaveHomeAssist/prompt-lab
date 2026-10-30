import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { StringDecoder } from 'node:string_decoder';
import { createFolderAdapter } from './folder-adapter.mjs';
import { createLocalApi } from './local-api.mjs';
import { LibraryError } from './contract.mjs';

const MAX_FRAME = 64 * 1024;
const MAX_PENDING = 16;
const fail = code => { throw new LibraryError(code, 'Invalid private service request.'); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).every(key => keys.includes(key));

function normalizeCredentials(value) {
  if (!Array.isArray(value) || value.length > 64) fail('INVALID_CREDENTIALS');
  const ids = new Set(), tokens = new Set();
  return value.map(item => {
    if (!exact(item, ['id', 'token', 'scopes', 'expiresAt', 'origin', 'revoked'])
      || typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(item.id)
      || typeof item.token !== 'string' || !/^[a-zA-Z0-9_-]{32,256}$/.test(item.token)
      || !Array.isArray(item.scopes) || !item.scopes.length || item.scopes.length > 2
      || item.scopes.some(scope => !['read', 'write'].includes(scope)) || new Set(item.scopes).size !== item.scopes.length
      || !Number.isSafeInteger(item.expiresAt) || item.expiresAt < 0 || item.expiresAt > Date.now() + 86_400_000
      || !Object.hasOwn(item, 'origin') || (item.revoked !== undefined && typeof item.revoked !== 'boolean')
      || ids.has(item.id) || tokens.has(item.token)) fail('INVALID_CREDENTIALS');
    if (item.origin !== null) {
      let url;
      try { url = new URL(item.origin); } catch { fail('INVALID_CREDENTIALS'); }
      if (typeof item.origin !== 'string' || item.origin.length > 2048
        || !['https:', 'http:', 'tauri:'].includes(url.protocol) || url.username || url.password
        || (url.protocol === 'tauri:' ? item.origin !== 'tauri://localhost' : url.origin !== item.origin)
        || (url.protocol === 'http:' && !['localhost', '127.0.0.1', 'tauri.localhost'].includes(url.hostname))) fail('INVALID_CREDENTIALS');
    }
    ids.add(item.id); tokens.add(item.token);
    return structuredClone(item);
  });
}

// Private inherited pipes only. The native owner supplies secure-store values;
// this channel never retrieves credentials from arguments, environment or disk.
export function runLibraryServiceChannel(input, output) {
  let api, identity, started = false, accepting = true, finished = false;
  let pending = 0, buffer = '', chain = Promise.resolve();
  const credentials = [], allowedOrigins = [], decoder = new StringDecoder('utf8');
  let resolveDone;
  const done = new Promise(resolve => { resolveDone = resolve; });
  const startupTimer = setTimeout(() => terminate('START_TIMEOUT'), 30_000);
  const emit = value => { if (!finished && !output.destroyed) output.write(JSON.stringify({ protocol: 1, ...value }) + '\n'); };
  const reply = (id, result) => emit({ id, ok: true, result });
  const rejected = (id, code) => emit({ id, ok: false, error: { code, message: 'Library service request failed; preserve pending work.' } });
  const state = () => identity ? { state: 'running', ...identity } : { state: 'stopped' };
  const close = async () => { if (api) { await api.close(); api = null; } identity = undefined; };
  function finish(code) {
    if (finished) return;
    finished = true; accepting = false; clearTimeout(startupTimer);
    input.destroy(); resolveDone(code);
  }
  function terminate(code) {
    if (!accepting) return;
    accepting = false; input.pause(); clearTimeout(startupTimer);
    chain = chain.then(async () => {
      await close().catch(() => {});
      rejected(null, code); finish(1);
    });
  }
  function installCredentials(next) {
    credentials.splice(0, credentials.length, ...next);
    allowedOrigins.splice(0, allowedOrigins.length, ...new Set(next.flatMap(item => item.origin === null ? [] : [item.origin])));
  }
  async function dispatch(frame) {
    if (!accepting || finished) return;
    const id = typeof frame?.id === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(frame.id) ? frame.id : null;
    try {
      if (id === null || !exact(frame, ['protocol', 'id', 'command', 'args']) || frame.protocol !== 1
        || !['inspect', 'start', 'status', 'credentials', 'stop'].includes(frame.command)) fail('INVALID_CONTROL');
      const args = frame.args ?? {};
      if (frame.command === 'inspect') {
        if (started) fail('ALREADY_STARTED');
        if (!exact(args, ['directory']) || typeof args.directory !== 'string' || !isAbsolute(args.directory)
          || args.directory.length > 4096 || args.directory.includes('\0')) fail('INVALID_CONTROL');
        const adapter = await createFolderAdapter(args.directory, { readOnly: true });
        reply(id, await adapter.inspect());
      } else if (frame.command === 'start') {
        if (started || !accepting) fail('ALREADY_STARTED');
        if (!exact(args, ['directory', 'libraryId', 'credentials']) || typeof args.directory !== 'string'
          || !isAbsolute(args.directory) || args.directory.length > 4096 || args.directory.includes('\0')
          || typeof args.libraryId !== 'string' || args.libraryId.length < 1 || args.libraryId.length > 200) fail('INVALID_CONTROL');
        const next = normalizeCredentials(args.credentials);
        if (!next.length) fail('INVALID_CREDENTIALS');
        clearTimeout(startupTimer); started = true;
        const adapter = await createFolderAdapter(args.directory);
        // Branch inspection permits recovery startup while checking library identity.
        await adapter.branches({ libraryId: args.libraryId });
        if (!accepting) return;
        installCredentials(next);
        const candidate = createLocalApi({ adapter, libraryId: args.libraryId, credentials, allowedOrigins });
        const baseUrl = await candidate.listen(); api = candidate;
        if (!accepting) { await close(); return; }
        identity = { libraryId: args.libraryId, baseUrl };
        reply(id, state());
      } else if (frame.command === 'credentials') {
        if (!api) fail('NOT_RUNNING');
        if (!exact(args, ['credentials'])) fail('INVALID_CONTROL');
        installCredentials(normalizeCredentials(args.credentials));
        reply(id, { state: 'running', credentialIds: credentials.map(item => item.id) });
      } else if (frame.command === 'status') {
        if (!exact(args, [])) fail('INVALID_CONTROL');
        reply(id, state());
      } else {
        if (!exact(args, [])) fail('INVALID_CONTROL');
        accepting = false; clearTimeout(startupTimer); input.pause();
        await close(); reply(id, state()); finish(0);
      }
    } catch (error) {
      rejected(id, error instanceof LibraryError ? error.code : 'SERVICE_UNAVAILABLE');
      // A failed start is terminal so no caller can rebind this process by accident.
      if (frame?.command === 'start' && started) { await close().catch(() => {}); finish(1); }
    }
  }
  input.on('data', chunk => {
    if (!accepting) return;
    buffer += decoder.write(chunk);
    while (accepting) {
      const newline = buffer.indexOf('\n');
      const line = newline === -1 ? buffer : buffer.slice(0, newline);
      if (Buffer.byteLength(line) > MAX_FRAME) { terminate('CONTROL_TOO_LARGE'); return; }
      if (newline === -1) return;
      buffer = buffer.slice(newline + 1);
      let frame;
      try { frame = JSON.parse(line); } catch { terminate('INVALID_CONTROL'); return; }
      if (++pending > MAX_PENDING) { terminate('CONTROL_QUEUE_FULL'); return; }
      chain = chain.then(() => dispatch(frame)).finally(() => { pending--; });
    }
  });
  input.once('end', () => {
    if (!accepting) return;
    if (buffer.length || decoder.end()) { terminate('INVALID_CONTROL'); return; }
    accepting = false; clearTimeout(startupTimer);
    chain = chain.then(async () => { await close().catch(() => {}); finish(0); });
  });
  input.once('error', () => terminate('OWNER_UNAVAILABLE'));
  output.once('error', () => { accepting = false; clearTimeout(startupTimer); chain = chain.then(async () => { await close().catch(() => {}); finish(1); }); });
  return done;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 2 || process.stdin.isTTY) process.exitCode = 2;
  else process.exitCode = await runLibraryServiceChannel(process.stdin, process.stdout);
}
