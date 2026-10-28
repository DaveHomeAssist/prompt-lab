import { mkdir, open, readdir, readFile, rename, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { canonical, hash, inspectPackage, FORMAT, VERSION, LibraryError } from './contract.mjs';

const writers = new Map();
const empty = () => ({ libraryId: null, revision: null, objects: {}, operations: {}, checkpoints: [] });

// Immutable journals reveal competing device heads. No iCloud lock is assumed.
// The caller supplies a disposable or explicitly selected directory, never a guessed personal path.
export async function createFolderAdapter(directory, { fault = async () => {} } = {}) {
  const root = resolve(directory);
  await mkdir(root, { recursive: true, mode: 0o700 });
  if ((await lstat(root)).isSymbolicLink()) throw new LibraryError('UNSAFE_DIRECTORY', 'Library directory cannot be a symbolic link.');
  const journal = join(root, 'transactions');
  await mkdir(journal, { mode: 0o700, recursive: true });
  if ((await lstat(journal)).isSymbolicLink()) throw new LibraryError('UNSAFE_DIRECTORY', 'Transaction directory cannot be a symbolic link.');
  async function load() {
    const files = (await readdir(journal)).filter(name => name.endsWith('.json'));
    if (!files.length) return { state: empty(), transaction: null };
    const rows = new Map(), parents = new Set();
    for (const name of files) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) throw new LibraryError('CLOUD_CONFLICT', 'Unexpected transaction or cloud conflict copy; review required.', 409);
      const file = join(journal, name);
      if ((await lstat(file)).isSymbolicLink()) throw new LibraryError('UNSAFE_DIRECTORY', 'Transaction cannot be a symbolic link.');
      let row;
      try { row = JSON.parse(await readFile(file, 'utf8')); } catch { throw new LibraryError('INCOMPLETE_STORE', 'Transaction is unreadable; preserve files and retry after recovery.', 503); }
      const id = 'sha256:' + name.slice(0, -5);
      if (await hash(row) !== id || row.schemaVersion !== VERSION) throw new LibraryError('HASH_MISMATCH', 'Transaction failed verification.', 503);
      if (row.parent !== null) parents.add(row.parent);
      rows.set(id, row);
    }
    for (const parent of parents) if (!rows.has(parent)) throw new LibraryError('MISSING_OBJECT', 'Transaction ancestry is incomplete; wait for cloud files.', 503);
    const heads = [...rows.keys()].filter(id => !parents.has(id));
    if (heads.length !== 1) throw new LibraryError('DIVERGENT_HEADS', 'Competing folder revisions require reviewed reconciliation.', 409);
    let current = heads[0];
    const seen = new Set();
    while (current) {
      if (seen.has(current)) throw new LibraryError('INVALID_ANCESTRY', 'Transaction cycle.');
      seen.add(current);
      current = rows.get(current).parent;
    }
    if (seen.size !== rows.size) throw new LibraryError('DIVERGENT_HEADS', 'Disconnected transaction history requires review.', 409);
    const state = rows.get(heads[0]).state;
    if (!state?.revision || !state.libraryId || !state.operations || !Array.isArray(state.checkpoints)) throw new LibraryError('INCOMPLETE_STORE', 'Transaction state is incomplete.', 503);
    await inspectPackage({ format: FORMAT, schemaVersion: VERSION, libraryId: state.libraryId, head: state.revision, objects: state.objects });
    return { state, transaction: heads[0] };
  }
  return {
    root,
    async read() { return structuredClone((await load()).state); },
    async transact(fn) {
      const previous = writers.get(root) ?? Promise.resolve();
      const pending = previous.then(async () => {
        const before = await load();
        const state = structuredClone(before.state);
        const result = await fn(state);
        if (canonical(state) === canonical(before.state)) return result;
        await inspectPackage({ format: FORMAT, schemaVersion: VERSION, libraryId: state.libraryId, head: state.revision, objects: state.objects });
        if ((await load()).transaction !== before.transaction) throw new LibraryError('REVISION_CONFLICT', 'Folder changed during commit.', 409);
        const row = { schemaVersion: VERSION, parent: before.transaction, state };
        const id = await hash(row);
        const target = join(journal, id.slice(7) + '.json');
        const temp = join(journal, globalThis.crypto.randomUUID() + '.pending');
        const handle = await open(temp, 'wx', 0o600);
        try {
          await handle.writeFile(canonical(row));
          await fault('before-flush');
          await handle.sync();
        } finally { await handle.close(); }
        await fault('before-publication');
        await rename(temp, target);
        const dir = await open(journal, 'r');
        try { await dir.sync(); } finally { await dir.close(); }
        await fault('after-publication');
        const after = await load();
        if (after.transaction !== id) throw new LibraryError('DIVERGENT_HEADS', 'Published commit needs conflict review.', 409);
        return result;
      });
      const settled = pending.catch(() => {});
      writers.set(root, settled);
      try { return await pending; } finally { if (writers.get(root) === settled) writers.delete(root); }
    },
  };
}
