import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { Agent, get } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFolderAdapter } from './folder-adapter.mjs';

const workerPath = fileURLToPath(new URL('./service-worker.mjs', import.meta.url));
const credential = (id, overrides = {}) => ({ id, token: randomBytes(32).toString('base64url'), scopes: ['read', 'write'], expiresAt: Date.now() + 60_000, origin: null, ...overrides });
async function folder(t) {
  const root = await mkdtemp(join(tmpdir(), 'promptlab-worker-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
function worker(t) {
  const child = spawn(process.execPath, [workerPath], { stdio: ['pipe', 'pipe', 'pipe'] });
  const exited = once(child, 'exit');
  let buffer = '', sequence = 0, stdout = '', stderr = '';
  const waiters = new Map(), messages = [];
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    stdout += chunk; buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const message = JSON.parse(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1);
      messages.push(message); waiters.get(message.id)?.(message); waiters.delete(message.id);
    }
  });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdin.on('error', () => {});
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) { child.stdin.end(); child.kill(); }
    await exited;
  });
  return {
    child, exited, messages,
    output: () => ({ stdout, stderr }),
    request(command, args = {}) {
      const id = `request${++sequence}`;
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { waiters.delete(id); reject(new Error(`No response to ${command}`)); }, 5_000);
        waiters.set(id, message => { clearTimeout(timeout); resolve(message); });
        child.stdin.write(JSON.stringify({ protocol: 1, id, command, args }) + '\n');
      });
    },
  };
}
async function start(owner, directory, credentials, libraryId = 'worker-library') {
  const response = await owner.request('start', { directory, libraryId, credentials });
  assert.equal(response.ok, true, JSON.stringify(response));
  assert.equal(response.result.state, 'running');
  assert.match(response.result.baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
  return response.result.baseUrl;
}
const request = (base, auth, path = '/v1/library', options = {}) => fetch(base + path, {
  ...options, signal: AbortSignal.timeout(5_000), headers: { Authorization: `Bearer ${auth.token}`, ...options.headers },
});
async function commit(base, auth) {
  const preview = await request(base, auth, '/v1/library/previews', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ libraryId: 'worker-library', expectedRevision: null, sourceText: '{"library":[{"id":"p","original":"retained"}]}' }),
  });
  assert.equal(preview.status, 201);
  const response = await request(base, auth, '/v1/library/commits', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'owned-commit' }, body: JSON.stringify(await preview.json()) });
  assert.equal(response.status, 201);
  return response.json();
}
async function contents(root) {
  const result = {};
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isDirectory()) for (const [name, value] of Object.entries(await contents(join(root, entry.name)))) result[entry.name + '/' + name] = value;
    else result[entry.name] = await readFile(join(root, entry.name), 'utf8');
  }
  return result;
}

test('owned helper binds credentials to exact origins and survives an app client disconnect', { timeout: 15_000 }, async t => {
  const directory = await folder(t), owner = worker(t);
  const agent = credential('agent'), browser = credential('browser', { origin: 'https://promptlab.tools', scopes: ['read'] });
  const base = await start(owner, directory, [agent, browser]);
  assert.equal((await fetch(base + '/v1/library')).status, 401);
  assert.equal((await request(base, agent)).status, 200);
  assert.equal((await request(base, agent, '/v1/library', { headers: { Origin: browser.origin } })).status, 403);
  assert.equal((await request(base, browser)).status, 403);
  assert.equal((await request(base, browser, '/v1/library', { headers: { Origin: 'https://hostile.invalid' } })).status, 403);
  assert.equal((await request(base, browser, '/v1/library', { headers: { Origin: browser.origin } })).status, 200);
  assert.equal((await request(base, browser, '/v1/library/previews', { method: 'POST', headers: { Origin: browser.origin } })).status, 403);
  const appClient = new Agent({ keepAlive: true });
  await new Promise((resolve, reject) => get(base + '/v1/library', { agent: appClient, headers: { Authorization: `Bearer ${agent.token}` } }, res => { res.resume(); res.on('end', resolve); }).on('error', reject));
  appClient.destroy();
  assert.equal((await request(base, agent)).status, 200);
  const receipt = await commit(base, agent);
  assert.equal((await owner.request('stop')).result.state, 'stopped');
  assert.deepEqual(await owner.exited, [0, null]);
  await assert.rejects(fetch(base + '/v1/library', { signal: AbortSignal.timeout(1_000) }));
  const next = worker(t), replacement = credential('replacement');
  const restarted = await start(next, directory, [replacement]);
  assert.equal((await request(restarted, agent)).status, 401);
  assert.deepEqual(await (await request(restarted, replacement, '/v1/library/operations/owned-commit')).json(), receipt);
  const files = JSON.stringify(await contents(directory));
  for (const item of [agent, browser, replacement]) {
    assert.equal(files.includes(item.token), false);
    assert.equal(JSON.stringify(owner.output()).includes(item.token), false);
    assert.equal(JSON.stringify(next.child.spawnargs).includes(item.token), false);
  }
  assert.equal(owner.output().stderr, '');
  assert.equal((await next.request('stop')).ok, true);
  assert.deepEqual(await next.exited, [0, null]);
});

test('private credential replacement is atomic and revokes prior access', { timeout: 15_000 }, async t => {
  const directory = await folder(t), owner = worker(t), original = credential('first');
  const base = await start(owner, directory, [original]);
  const next = credential('next', { origin: 'https://approved.invalid' });
  assert.equal((await owner.request('credentials', { credentials: [next, { ...next, id: 'duplicate' }] })).error.code, 'INVALID_CREDENTIALS');
  assert.equal((await request(base, original)).status, 200);
  assert.equal((await owner.request('credentials', { credentials: [next] })).ok, true);
  assert.equal((await request(base, original)).status, 401);
  assert.equal((await request(base, next)).status, 403);
  assert.equal((await request(base, next, '/v1/library', { headers: { Origin: next.origin } })).status, 200);
  assert.equal((await owner.request('credentials', { credentials: [{ ...next, revoked: true }] })).ok, true);
  assert.equal((await request(base, next, '/v1/library', { headers: { Origin: next.origin } })).status, 401);
  assert.equal((await owner.request('credentials', { credentials: [] })).ok, true);
  assert.equal((await request(base, original)).status, 401);
  assert.equal((await request(base, next, '/v1/library', { headers: { Origin: next.origin } })).status, 403);
  assert.equal((await owner.request('stop')).ok, true);
});

test('owner EOF stops the service and wrong-library startup preserves every file', { timeout: 15_000 }, async t => {
  const directory = await folder(t), owner = worker(t), auth = credential('agent');
  const base = await start(owner, directory, [auth]), receipt = await commit(base, auth);
  owner.child.stdin.end();
  assert.deepEqual(await owner.exited, [0, null]);
  await assert.rejects(fetch(base + '/v1/library', { signal: AbortSignal.timeout(1_000) }));
  const before = await contents(directory), wrong = worker(t);
  const response = await wrong.request('start', { directory, libraryId: 'wrong-library', credentials: [auth] });
  assert.equal(response.ok, false); assert.equal(response.error.code, 'WRONG_LIBRARY');
  assert.deepEqual(await wrong.exited, [1, null]);
  assert.deepEqual(await contents(directory), before);
  assert.deepEqual((await (await createFolderAdapter(directory)).read()).operations['owned-commit'], receipt);
});

for (const [name, input, code] of [
  ['invalid JSON', 'private-not-json\n', 'INVALID_CONTROL'],
  ['oversized frame', 'private' + 'x'.repeat(65_536), 'CONTROL_TOO_LARGE'],
  ['queue overflow', Array.from({ length: 17 }, (_, i) => JSON.stringify({ protocol: 1, id: `r${i}`, command: 'status' }) + '\n').join(''), 'CONTROL_QUEUE_FULL'],
]) test(`helper rejects ${name} without reflecting private input`, { timeout: 10_000 }, async t => {
  const owner = worker(t);
  owner.child.stdin.write(input);
  assert.deepEqual(await owner.exited, [1, null]);
  assert.equal(owner.messages.at(-1).error.code, code);
  assert.equal(owner.output().stdout.includes('private'), false);
  assert.equal(owner.output().stderr, '');
});

test('queued requests cannot restart or mutate a stopped owner', { timeout: 10_000 }, async t => {
  const root = await folder(t), owner = worker(t), directory = join(root, 'must-not-exist');
  owner.child.stdin.write([
    { protocol: 1, id: 'stop', command: 'stop' },
    { protocol: 1, id: 'start', command: 'start', args: { directory, libraryId: 'unexpected', credentials: [credential('agent')] } },
  ].map(item => JSON.stringify(item) + '\n').join(''));
  assert.deepEqual(await owner.exited, [0, null]);
  assert.deepEqual(owner.messages.map(item => item.id), ['stop']);
  assert.deepEqual(await readdir(root), []);
});

test('closed owner output stops the listener without logging credentials', { timeout: 10_000 }, async t => {
  const directory = await folder(t), owner = worker(t), auth = credential('agent');
  const base = await start(owner, directory, [auth]);
  owner.child.stdout.destroy();
  owner.child.stdin.write(JSON.stringify({ protocol: 1, id: 'status', command: 'status' }) + '\n');
  assert.deepEqual(await owner.exited, [1, null]);
  await assert.rejects(fetch(base + '/v1/library', { signal: AbortSignal.timeout(1_000) }));
  assert.equal(owner.output().stderr, '');
});

test('invalid startup configuration cannot create a library or leak credentials', { timeout: 10_000 }, async t => {
  const root = await folder(t), owner = worker(t), auth = credential('agent');
  const args = { directory: join(root, 'must-not-exist'), libraryId: 'worker-library', credentials: [auth] };
  for (const invalid of [
    { ...args, directory: 'relative-folder' },
    { ...args, credentials: [{ ...auth, origin: 'http://remote.invalid' }] },
    { ...args, credentials: [{ ...auth, origin: 'https://approved.invalid/path' }] },
    { ...args, credentials: [{ ...auth, expiresAt: Date.now() + 172_800_000 }] },
    { ...args, credentials: [{ ...auth, scopes: ['admin'] }] },
    { ...args, credentials: [{ ...auth, token: 'short' }] },
    { ...args, credentials: [] },
  ]) assert.equal((await owner.request('start', invalid)).ok, false);
  assert.deepEqual(await readdir(root), []);
  assert.equal(owner.output().stdout.includes(auth.token), false);
  assert.equal((await owner.request('stop')).ok, true);
  assert.deepEqual(await owner.exited, [0, null]);
});
