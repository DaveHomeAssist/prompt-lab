import { mkdir, open, readdir, lstat, link, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { canonical, hash, LibraryError, MAX_BYTES } from './contract.mjs';

const nameFor = id => {
  if (typeof id !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(id)) throw new LibraryError('INVALID_REQUEST', 'A complete content hash is required.');
  return id.slice(7) + '.json';
};
const freeze = value => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};

// Publication never replaces an existing file. A partial file is kept under a
// .pending name until flushed; an interrupted publication is safe to retry.
export async function createFolderFiles(directory, kind, fault) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const cache = new Map(), proofs = new Map();
  let cacheBytes = 0;
  async function directorySafe() {
    if ((await lstat(directory)).isSymbolicLink()) throw new LibraryError('UNSAFE_DIRECTORY', 'Library content directory cannot be a symbolic link.');
  }
  async function flushDirectory() {
    const dir = await open(directory, 'r');
    try { await dir.sync(); } finally { await dir.close(); }
  }
  async function names() {
    await directorySafe();
    const files = (await readdir(directory)).filter(name => name.endsWith('.json')).sort();
    if (files.some(name => !/^[a-f0-9]{64}\.json$/.test(name))) throw new LibraryError('CLOUD_CONFLICT', 'Unexpected library file or cloud conflict copy; review required.', 409);
    return files;
  }
  await directorySafe();
  async function read(id) {
    const name = nameFor(id), file = join(directory, name);
    let contents;
    try {
      const metadata = await lstat(file);
      if (metadata.isSymbolicLink()) throw new LibraryError('UNSAFE_DIRECTORY', 'Library content cannot be a symbolic link.');
      if (!metadata.isFile()) throw new LibraryError('INCOMPLETE_STORE', 'Library content must be a regular file.', 503);
      const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        if (!(await handle.stat()).isFile()) throw new LibraryError('INCOMPLETE_STORE', 'Library content must be a regular file.', 503);
        contents = await handle.readFile();
      } finally { await handle.close(); }
    } catch (error) {
      if (error instanceof LibraryError) throw error;
      throw new LibraryError(error.code === 'ENOENT' ? 'MISSING_OBJECT' : 'INCOMPLETE_STORE', 'Library content is unavailable; preserve files and retry after recovery.', 503);
    }
    const digest = createHash('sha256').update(contents).digest('hex');
    const known = cache.get(name);
    if (known?.digest === digest) return known.value;
    let value;
    try { value = JSON.parse(contents.toString('utf8')); }
    catch { throw new LibraryError('INCOMPLETE_STORE', 'Library content is unreadable; preserve files for recovery.', 503); }
    if (proofs.get(name) !== digest && await hash(value) !== id) throw new LibraryError('HASH_MISMATCH', 'Library content failed verification.', 503);
    freeze(value);
    if (proofs.size >= 4096) proofs.delete(proofs.keys().next().value);
    proofs.set(name, digest);
    if (known) { cacheBytes -= known.bytes; cache.delete(name); }
    // Parsed JSON can use more memory than its UTF-8 representation. Retain a
    // conservative byte estimate, and reread actual bytes even on cache hits.
    const bytes = contents.byteLength * 3;
    if (bytes <= MAX_BYTES) {
      while (cache.size >= 128 || cacheBytes + bytes > MAX_BYTES) {
        const oldest = cache.keys().next().value;
        cacheBytes -= cache.get(oldest).bytes; cache.delete(oldest);
      }
      cache.set(name, { digest, value, bytes }); cacheBytes += bytes;
    }
    return value;
  }
  async function publish(id, value) {
    await directorySafe();
    if (await hash(value) !== id) throw new LibraryError('HASH_MISMATCH', 'Cannot publish content under a different hash.', 503);
    const target = join(directory, nameFor(id));
    try {
      await lstat(target);
      await read(id);
      const existing = await open(target, 'r');
      try { await existing.sync(); } finally { await existing.close(); }
      await flushDirectory();
      return;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const temp = join(directory, globalThis.crypto.randomUUID() + '.pending');
    const handle = await open(temp, 'wx', 0o600);
    const phase = stage => fault(kind ? `${kind}-${stage}` : stage);
    try {
      await handle.writeFile(canonical(value));
      await phase('before-flush');
      await handle.sync();
    } finally { await handle.close(); }
    await phase('before-publication');
    await directorySafe();
    try { await link(temp, target); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      await read(id);
      const existing = await open(target, 'r');
      try { await existing.sync(); } finally { await existing.close(); }
    }
    await flushDirectory();
    await phase('after-publication');
    await unlink(temp);
  }
  return { names, read, publish };
}
