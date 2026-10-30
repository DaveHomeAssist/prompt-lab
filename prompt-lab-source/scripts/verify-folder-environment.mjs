import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { once } from 'node:events';
import { chmod, lstat, mkdtemp, open, readdir, readFile, statfs, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertSupportedNode } from './require-node.mjs';

// This acceptance must never fill a user's normal filesystem or change a real
// library's permissions. Require an empty, small tmpfs and an unprivileged user.
assertSupportedNode();
assert.equal(process.platform, 'linux');
assert.ok(process.getuid() > 0, 'Permission acceptance must not run as root');
assert.equal(process.argv.length, 3, 'Supply the explicitly mounted acceptance root');
const root = resolve(process.argv[2]);
assert.ok(!(await lstat(root)).isSymbolicLink());
const filesystem = await statfs(root, { bigint: true });
assert.equal(filesystem.type, 0x01021994n, 'Acceptance root must be tmpfs');
assert.ok(filesystem.blocks * filesystem.bsize <= 32n * 1024n * 1024n, 'Filesystem must be at most 32 MiB');
assert.deepEqual(await readdir(root), [], 'Acceptance root must be empty');

const worker = fileURLToPath(new URL('../library-storage/service-worker.mjs', import.meta.url));
const token = randomBytes(32).toString('hex');
async function start(directory) {
  const child = spawn(process.execPath, [worker], { stdio: ['pipe', 'pipe', 'pipe'] });
  const exited = once(child, 'exit');
  let sequence = 0, buffer = '', stderr = '';
  const pending = new Map();
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdout.on('data', chunk => {
    buffer += chunk;
    while (buffer.includes('\n')) {
      const end = buffer.indexOf('\n'), message = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1); pending.get(message.id)?.(message); pending.delete(message.id);
    }
  });
  child.stdin.on('error', () => {});
  function control(command, args = {}) {
    const id = `acceptance${++sequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Private helper response timed out')); }, 10_000);
      pending.set(id, response => { clearTimeout(timer); resolve(response); });
      child.stdin.write(JSON.stringify({ protocol: 1, id, command, args }) + '\n');
    });
  }
  const response = await control('start', { directory, libraryId: 'environment-acceptance',
    credentials: [{ id: 'disposable', token, scopes: ['read', 'write'], origin: null, expiresAt: Date.now() + 180_000 }] });
  assert.equal(response.ok, true, 'Disposable helper must start');
  const responseBase = response.result.baseUrl;
  return {
    async request(path, body, operationId) {
      const response = await fetch(responseBase + path, {
        method: body === undefined ? 'GET' : 'POST', signal: AbortSignal.timeout(10_000),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(operationId ? { 'Idempotency-Key': operationId } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    },
    async stop() {
      if (child.exitCode === null) {
        assert.equal((await control('stop')).ok, true);
        await exited;
      }
      assert.equal(child.exitCode, 0);
      assert.ok(!stderr.includes(token), 'No credential may enter diagnostics');
    },
    get baseUrl() { return response.result.baseUrl; },
  };
}

async function files(directory, prefix = '') {
  const result = {};
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name), name = prefix + item.name;
    if (item.isDirectory()) Object.assign(result, await files(path, name + '/'));
    else result[name] = createHash('sha256').update(await readFile(path)).digest('hex');
  }
  return result;
}
const source = text => JSON.stringify({ library: [{ id: 'retained', original: text,
  versions: Array.from({ length: 41 }, (_, index) => ({ id: `version${index}`, original: `Retain ${index}` })), future: { keep: true } }],
  scratch: [{ opaque: true }], unknown: { preserved: 'exact source' } });
const reviewInput = (revision, text) => ({ libraryId: 'environment-acceptance', expectedRevision: revision, sourceText: source(text) });
const report = [];
for (const scenario of ['full-filesystem', 'denied-objects', 'denied-receipts', 'denied-transactions', 'denied-read']) {
  const directory = await mkdtemp(join(root, scenario + '-'));
  let owner = await start(directory), restore = async () => {};
  try {
    const seed = await owner.request('/v1/library/previews', reviewInput(null, 'Before failure'));
    assert.equal(seed.status, 201);
    const committed = await owner.request('/v1/library/commits', seed.body, 'seed');
    assert.equal(committed.status, 201);
    const originalFiles = await files(directory), revision = committed.body.revision;
    const input = reviewInput(revision, 'Retained pending change');
    const preview = await owner.request('/v1/library/previews', input);
    assert.equal(preview.status, 201);
    let filesystemError;
    if (scenario === 'full-filesystem') {
      const filler = join(root, 'disposable-fill');
      const handle = await open(filler, 'wx', 0o600);
      restore = () => unlink(filler);
      try {
        const chunk = Buffer.alloc(64 * 1024, 1);
        for (let index = 0; index < 1024; index++) await handle.writeFile(chunk);
        assert.fail('Bounded filesystem did not become full');
      } catch (error) { assert.equal(error.code, 'ENOSPC'); filesystemError = error.code; }
      finally { await handle.close(); }
    } else if (scenario === 'denied-read') {
      const target = join(directory, Object.keys(originalFiles).find(name => name.startsWith('objects/')));
      await chmod(target, 0o000); restore = () => chmod(target, 0o600);
      await assert.rejects(readFile(target), { code: 'EACCES' }); filesystemError = 'EACCES';
      const read = await owner.request('/v1/library');
      assert.equal(read.status, 503); assert.equal(read.body.code, 'INCOMPLETE_STORE');
      await restore(); restore = async () => {};
    } else {
      const target = join(directory, scenario.slice('denied-'.length));
      await chmod(target, 0o500); restore = () => chmod(target, 0o700);
      await assert.rejects(open(join(target, 'disposable-permission-probe'), 'wx'), { code: 'EACCES' }); filesystemError = 'EACCES';
    }
    if (scenario !== 'denied-read') {
      const failed = await owner.request('/v1/library/commits', preview.body, 'retained-operation');
      assert.equal(failed.status, 503); assert.equal(failed.body.code, 'STORAGE_UNAVAILABLE');
      assert.ok(!JSON.stringify(failed.body).includes(token));
      assert.equal((await owner.request('/v1/library')).body.revision, revision);
      assert.equal((await owner.request('/v1/library/operations/retained-operation')).status, 404);
      await restore(); restore = async () => {};
    }
    const retainedFiles = await files(directory);
    for (const [name, digest] of Object.entries(originalFiles)) assert.equal(retainedFiles[name], digest, name);
    await owner.stop(); owner = await start(directory);
    assert.equal((await owner.request('/v1/library')).body.revision, revision);
    assert.deepEqual((await owner.request('/v1/library/operations/seed')).body, committed.body);
    const repeatedPreview = await owner.request('/v1/library/previews', input);
    assert.equal(repeatedPreview.status, 201);
    assert.equal(repeatedPreview.body.fingerprint, preview.body.fingerprint);
    assert.equal(repeatedPreview.body.sourceHash, preview.body.sourceHash);
    const retry = await owner.request('/v1/library/commits', repeatedPreview.body, 'retained-operation');
    assert.equal(retry.status, 201);
    await owner.stop(); owner = await start(directory);
    const receipt = await owner.request('/v1/library/operations/retained-operation');
    assert.deepEqual(receipt.body, retry.body);
    assert.deepEqual((await owner.request('/v1/library/commits', repeatedPreview.body, 'retained-operation')).body, retry.body);
    const after = await files(directory);
    for (const [name, digest] of Object.entries(originalFiles)) assert.equal(after[name], digest, name);
    assert.equal(Object.keys(after).filter(name => name.startsWith('transactions/') && name.endsWith('.json')).length, 2);
    report.push({ scenario, result: 'passed', filesystemError, originalFiles: Object.keys(originalFiles).length, transactions: 2 });
  } finally { await restore(); await owner.stop(); }
}
console.log(JSON.stringify({ node: process.version, platform: process.platform, filesystemBytes: String(filesystem.blocks * filesystem.bsize), scenarios: report }, null, 2));
