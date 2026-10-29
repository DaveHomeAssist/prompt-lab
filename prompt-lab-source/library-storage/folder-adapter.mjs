import { mkdir, open, readdir, readFile, rename, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { canonical, hash, LibraryError } from './contract.mjs';
import { createTransfer } from './transfer.mjs';

const writers = new Map();
const empty = () => ({ libraryId: null, revision: null, objects: {}, operations: {}, checkpoints: [] });
const address = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const fail = (code, message) => { throw new LibraryError(code, message, 409); };
const parentsOf = row => row.schemaVersion === 1 ? (row.parent === null ? [] : [row.parent]) : row.parents;

function preserves(next, previous) {
  if (next.libraryId !== previous.libraryId) fail('WRONG_LIBRARY', 'Folder transactions belong to different libraries.');
  for (const section of ['objects', 'operations']) for (const [key, value] of Object.entries(previous[section])) {
    if (!Object.hasOwn(next[section], key) || canonical(next[section][key]) !== canonical(value)) fail('HISTORY_LOSS', 'A folder transaction cannot replace or omit retained history.');
  }
  if (previous.checkpoints.some(id => !next.checkpoints.includes(id))) fail('HISTORY_LOSS', 'A folder transaction cannot omit recovery checkpoints.');
}

// Immutable journals reveal competing device heads. No iCloud lock is assumed.
// The caller supplies a disposable or explicitly selected directory, never a guessed personal path.
export async function createFolderAdapter(directory, { fault = async () => {} } = {}) {
  const root = resolve(directory);
  await mkdir(root, { recursive: true, mode: 0o700 });
  if ((await lstat(root)).isSymbolicLink()) throw new LibraryError('UNSAFE_DIRECTORY', 'Library directory cannot be a symbolic link.');
  const journal = join(root, 'transactions');
  await mkdir(journal, { mode: 0o700, recursive: true });
  if ((await lstat(journal)).isSymbolicLink()) throw new LibraryError('UNSAFE_DIRECTORY', 'Transaction directory cannot be a symbolic link.');
  async function graph() {
    const files = (await readdir(journal)).filter(name => name.endsWith('.json'));
    if (!files.length) return { rows: new Map(), heads: [], libraryId: null };
    const rows = new Map(), parents = new Set();
    for (const name of files) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) throw new LibraryError('CLOUD_CONFLICT', 'Unexpected transaction or cloud conflict copy; review required.', 409);
      const file = join(journal, name);
      if ((await lstat(file)).isSymbolicLink()) throw new LibraryError('UNSAFE_DIRECTORY', 'Transaction cannot be a symbolic link.');
      let row;
      try { row = JSON.parse(await readFile(file, 'utf8')); } catch { throw new LibraryError('INCOMPLETE_STORE', 'Transaction is unreadable; preserve files and retry after recovery.', 503); }
      const id = 'sha256:' + name.slice(0, -5);
      if (await hash(row) !== id) throw new LibraryError('HASH_MISMATCH', 'Transaction failed verification.', 503);
      if (![1, 2].includes(row.schemaVersion)) fail('UNSUPPORTED_TRANSACTION', 'Preserve this journal generation for explicit recovery.');
      const ancestry = parentsOf(row);
      if (!Array.isArray(ancestry) || ancestry.some(parent => !address(parent)) || new Set(ancestry).size !== ancestry.length
        || (row.schemaVersion === 2 && Object.hasOwn(row, 'parent'))) fail('INVALID_ANCESTRY', 'Transaction parents are invalid.');
      if (!address(row.state?.revision) || typeof row.state?.libraryId !== 'string' || !row.state.libraryId
        || !row.state.objects || !row.state.operations || !Array.isArray(row.state.checkpoints)) fail('INCOMPLETE_STORE', 'Transaction state is incomplete.');
      for (const parent of ancestry) parents.add(parent);
      rows.set(id, row);
    }
    for (const parent of parents) if (!rows.has(parent)) throw new LibraryError('MISSING_OBJECT', 'Transaction ancestry is incomplete; wait for cloud files.', 503);
    const heads = [...rows.keys()].filter(id => !parents.has(id)).sort();
    if (!heads.length) fail('INVALID_ANCESTRY', 'Transaction history has no head.');
    const seen = new Set(), visiting = new Set();
    function visit(id) {
      if (visiting.has(id)) fail('INVALID_ANCESTRY', 'Transaction cycle.');
      if (seen.has(id)) return;
      visiting.add(id);
      const row = rows.get(id);
      for (const parent of parentsOf(row)) { visit(parent); preserves(row.state, rows.get(parent).state); }
      visiting.delete(id); seen.add(id);
    }
    for (const id of heads) visit(id);
    if (seen.size !== rows.size) fail('INVALID_ANCESTRY', 'Unreachable transaction history requires recovery.');
    const libraryId = rows.get(heads[0]).state.libraryId;
    for (const row of rows.values()) if (row.state.libraryId !== libraryId) fail('WRONG_LIBRARY', 'The folder contains transactions from another library.');
    return { rows, heads, libraryId };
  }
  const graphRevision = value => hash(value.heads);
  function descends(value, head, ancestor) {
    const pending = [head], seen = new Set();
    while (pending.length) {
      const id = pending.pop(); if (id === ancestor) return true;
      if (seen.has(id)) continue; seen.add(id); pending.push(...parentsOf(value.rows.get(id)));
    }
    return false;
  }
  async function selected(value, context) {
    if (!value.heads.length) {
      if (context) fail('BRANCH_NOT_FOUND', 'The selected recovery branch is unavailable.');
      return { state: empty(), transaction: null };
    }
    let transaction;
    if (!context) {
      if (value.heads.length !== 1) fail('DIVERGENT_HEADS', 'Competing folder revisions require reviewed reconciliation.');
      [transaction] = value.heads;
    } else {
      if (!value.rows.has(context.anchorTransaction)) fail('BRANCH_NOT_FOUND', 'The selected recovery branch is unavailable.');
      const candidates = value.heads.filter(head => descends(value, head, context.anchorTransaction));
      if (candidates.length !== 1) fail('DIVERGENT_HEADS', 'This recovery branch has competing descendants. Choose a verified head.');
      [transaction] = candidates;
      if (context.transaction === transaction && canonical(context.heads) !== canonical(value.heads)) fail('FOLDER_CHANGED', 'Folder heads changed. Inspect and review them again.');
      // A causal descendant permits operation readback after response loss.
      // The shared command service still rejects stale mutation revisions.
      context.transaction = transaction; context.heads = [...value.heads];
    }
    const state = value.rows.get(transaction).state;
    await createTransfer(state);
    return { state: structuredClone(state), transaction };
  }
  function access(context = null) { return {
    root,
    async read() { return (await selected(await graph(), context)).state; },
    ...(context ? { async recoveryContext() {
      await selected(await graph(), context);
      return { anchorTransaction: context.anchorTransaction, graphRevision: await hash(context.heads) };
    } } : {}),
    async branches({ libraryId, expectedGraph, cursor = '0', limit = 100 } = {}) {
      if (typeof libraryId !== 'string' || !libraryId || typeof cursor !== 'string' || !/^(0|[1-9][0-9]*)$/.test(cursor)
        || !Number.isSafeInteger(Number(cursor)) || !Number.isInteger(limit) || limit < 1 || limit > 100
        || (expectedGraph !== undefined && !address(expectedGraph)) || (cursor !== '0' && expectedGraph === undefined)) fail('INVALID_REQUEST', 'Pin bounded branch pages to their folder graph.');
      const value = await graph(), revision = await graphRevision(value);
      if (value.libraryId && value.libraryId !== libraryId) fail('WRONG_LIBRARY', 'Folder belongs to another library.');
      if (expectedGraph !== undefined && expectedGraph !== revision) fail('FOLDER_CHANGED', 'Folder heads changed. Inspect them again.');
      const items = [];
      for (const transactionId of value.heads.slice(Number(cursor), Number(cursor) + limit)) {
        const state = value.rows.get(transactionId).state, transfer = await createTransfer(state);
        items.push({ transactionId, revision: state.revision, counts: transfer.manifest.counts });
      }
      if (await graphRevision(await graph()) !== revision) fail('FOLDER_CHANGED', 'Folder changed during branch inspection.');
      return { format: 'promptlab-folder-branches', schemaVersion: 1, libraryId, graphRevision: revision,
        recoveryRequired: value.heads.length > 1, total: value.heads.length, items,
        nextCursor: Number(cursor) + limit < value.heads.length ? String(Number(cursor) + limit) : null };
    },
    async selectBranch(transactionId) {
      if (!address(transactionId)) fail('INVALID_REQUEST', 'Select a verified folder transaction.');
      const value = await graph(), next = { anchorTransaction: transactionId, transaction: null, heads: [...value.heads] };
      await selected(value, next);
      return access(next);
    },
    async transact(fn) {
      const previous = writers.get(root) ?? Promise.resolve();
      const pending = previous.then(async () => {
        const beforeGraph = await graph(), before = await selected(beforeGraph, context);
        const state = structuredClone(before.state);
        const result = await fn(state);
        if (canonical(state) === canonical(before.state)) return result;
        await createTransfer(state);
        const commit = state.objects[state.revision].data;
        if (context && commit.operation !== 'reconcile') fail('RECOVERY_ONLY', 'A recovery branch permits reviewed reconciliation only.');
        const consumed = before.transaction ? [before.transaction] : [];
        if (commit.operation === 'reconcile') {
          for (const id of beforeGraph.heads) if (id !== before.transaction && beforeGraph.rows.get(id).state.revision === commit.parents[1]) consumed.push(id);
          if (context && beforeGraph.heads.length > 1 && consumed.length < 2) fail('RECOVERY_ONLY', 'Reconcile another verified head in this folder.');
        }
        for (const id of consumed) preserves(state, beforeGraph.rows.get(id).state);
        if (canonical((await graph()).heads) !== canonical(beforeGraph.heads)) throw new LibraryError('REVISION_CONFLICT', 'Folder changed during commit.', 409);
        const row = { schemaVersion: 2, parents: consumed.sort(), state };
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
        const afterGraph = await graph(), expectedHeads = [...beforeGraph.heads.filter(head => !consumed.includes(head)), id].sort();
        if (canonical(afterGraph.heads) !== canonical(expectedHeads)) throw new LibraryError('DIVERGENT_HEADS', 'Published commit needs conflict review.', 409);
        const after = await selected(afterGraph, context);
        if (after.transaction !== id) throw new LibraryError('DIVERGENT_HEADS', 'Published commit needs conflict review.', 409);
        return result;
      });
      const settled = pending.catch(() => {});
      writers.set(root, settled);
      try { return await pending; } finally { if (writers.get(root) === settled) writers.delete(root); }
    },
  }; }
  return access();
}
