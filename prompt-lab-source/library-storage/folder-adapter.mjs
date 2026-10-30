import { mkdir, lstat, open, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { canonical, hash, LibraryError } from './contract.mjs';
import { createFolderFiles } from './folder-files.mjs';
import { createTransfer } from './transfer.mjs';

const writers = new Map();
const empty = () => ({ libraryId: null, revision: null, objects: {}, operations: {}, checkpoints: [] });
const address = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const fail = (code, message) => { throw new LibraryError(code, message, 409); };
const parentsOf = row => row.schemaVersion === 1 ? (row.parent === null ? [] : [row.parent]) : row.parents;
const metadataOf = state => Object.fromEntries(Object.entries(state).filter(([key]) => !['objects', 'operations', 'checkpoints'].includes(key)));
function sameState(left, right) {
  if (canonical(metadataOf(left)) !== canonical(metadataOf(right)) || canonical(left.checkpoints) !== canonical(right.checkpoints)) return false;
  for (const section of ['objects', 'operations']) {
    const keys = Object.keys(left[section]);
    if (keys.length !== Object.keys(right[section]).length) return false;
    for (const key of keys) if (!Object.hasOwn(right[section], key) || canonical(left[section][key]) !== canonical(right[section][key])) return false;
  }
  return true;
}
function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

function preserves(next, previous) {
  if (next.libraryId !== previous.libraryId) fail('WRONG_LIBRARY', 'Folder transactions belong to different libraries.');
  for (const section of ['objects', 'operations']) for (const [key, value] of Object.entries(previous[section])) {
    if (!Object.hasOwn(next[section], key) || (next[section][key] !== value && canonical(next[section][key]) !== canonical(value))) fail('HISTORY_LOSS', 'A folder transaction cannot replace or omit retained history.');
  }
  if (previous.checkpoints.some(id => !next.checkpoints.includes(id))) fail('HISTORY_LOSS', 'A folder transaction cannot omit recovery checkpoints.');
}

// Immutable journals reveal competing device heads. No iCloud lock is assumed.
// The caller supplies a disposable or explicitly selected directory, never a guessed personal path.
export async function createFolderAdapter(directory, { fault = async () => {}, readOnly = false } = {}) {
  const root = resolve(directory);
  if (!readOnly) await mkdir(root, { recursive: true, mode: 0o700 });
  const metadata = await lstat(root);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new LibraryError('UNSAFE_DIRECTORY', 'Library directory must be a real directory.');
  const transactions = await createFolderFiles(join(root, 'transactions'), '', fault, { readOnly });
  const objects = await createFolderFiles(join(root, 'objects'), 'object', fault, { readOnly });
  const receipts = await createFolderFiles(join(root, 'receipts'), 'receipt', fault, { readOnly });
  if (!readOnly) {
    const directoryHandle = await open(root, 'r');
    try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
  }
  let verifiedSignature;
  const verifiedTransactions = new Set();
  const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
  function inherited(parents, rows) {
    const objects = new Map(), operations = new Map();
    for (const parent of parents) for (const [key, target] of [['objects', objects], ['operations', operations]]) {
      for (const [id, value] of Object.entries(rows.get(parent).state[key])) {
        if (target.has(id) && target.get(id) !== value && canonical(target.get(id)) !== canonical(value)) fail('HISTORY_LOSS', 'Parent histories disagree on retained content.');
        target.set(id, value);
      }
    }
    return { objects, operations };
  }
  async function graph() {
    if ((await lstat(root)).isSymbolicLink()) throw new LibraryError('UNSAFE_DIRECTORY', 'Library directory cannot be a symbolic link.');
    const files = await transactions.names();
    await objects.names(); await receipts.names();
    if (!files.length) return { rows: new Map(), heads: [], libraryId: null };
    const rows = new Map(), parents = new Set();
    for (const name of files) {
      const id = 'sha256:' + name.slice(0, -5), row = await transactions.read(id);
      if (![1, 2, 3].includes(row?.schemaVersion)) fail('UNSUPPORTED_TRANSACTION', 'Preserve this journal generation for explicit recovery.');
      const ancestry = parentsOf(row);
      if (!Array.isArray(ancestry) || ancestry.some(parent => !address(parent)) || new Set(ancestry).size !== ancestry.length
        || (row.schemaVersion !== 1 && Object.hasOwn(row, 'parent'))) fail('INVALID_ANCESTRY', 'Transaction parents are invalid.');
      if (row.schemaVersion === 3) {
        if (Object.keys(row).some(key => !['schemaVersion', 'parents', 'metadata', 'objects', 'operations', 'checkpoints'].includes(key))) fail('UNSUPPORTED_TRANSACTION', 'Unknown manifest fields require explicit recovery.');
        if (!record(row.metadata) || ['objects', 'operations', 'checkpoints'].some(key => Object.hasOwn(row.metadata, key))
          || !Array.isArray(row.objects) || row.objects.some(id => !address(id)) || new Set(row.objects).size !== row.objects.length
          || !record(row.operations) || Object.values(row.operations).some(id => !address(id)) || !Array.isArray(row.checkpoints)) fail('INCOMPLETE_STORE', 'Transaction manifest is incomplete.');
      } else if (!address(row.state?.revision) || typeof row.state?.libraryId !== 'string' || !row.state.libraryId
        || !record(row.state.objects) || !record(row.state.operations) || !Array.isArray(row.state.checkpoints)) fail('INCOMPLETE_STORE', 'Transaction state is incomplete.');
      for (const parent of ancestry) parents.add(parent);
      rows.set(id, row);
    }
    for (const parent of parents) if (!rows.has(parent)) throw new LibraryError('MISSING_OBJECT', 'Transaction ancestry is incomplete; wait for cloud files.', 503);
    const heads = [...rows.keys()].filter(id => !parents.has(id)).sort();
    if (!heads.length) fail('INVALID_ANCESTRY', 'Transaction history has no head.');
    const signature = files.length <= 4096 ? files.join('\n') : null;
    const proven = signature !== null && signature === verifiedSignature;
    const seen = new Set(), visiting = new Set(), content = new Map(), operations = new Map();
    async function load(store, cache, id) {
      if (!cache.has(id)) cache.set(id, await store.read(id));
      return cache.get(id);
    }
    async function visit(id) {
      if (visiting.has(id)) fail('INVALID_ANCESTRY', 'Transaction cycle.');
      if (seen.has(id)) return;
      visiting.add(id);
      let row = rows.get(id);
      for (const parent of parentsOf(row)) await visit(parent);
      if (row.schemaVersion === 3) {
        const retained = inherited(row.parents, rows);
        for (const objectId of row.objects) {
          const value = await load(objects, content, objectId);
          if (retained.objects.has(objectId) && canonical(retained.objects.get(objectId)) !== canonical(value)) fail('HISTORY_LOSS', 'Object history cannot be replaced.');
          retained.objects.set(objectId, value);
        }
        for (const [operationId, receiptId] of Object.entries(row.operations)) {
          const value = await load(receipts, operations, receiptId);
          if (retained.operations.has(operationId) && canonical(retained.operations.get(operationId)) !== canonical(value)) fail('HISTORY_LOSS', 'Operation history cannot be replaced.');
          retained.operations.set(operationId, value);
        }
        const state = freeze({ ...row.metadata, objects: Object.fromEntries(retained.objects), operations: Object.fromEntries(retained.operations), checkpoints: row.checkpoints });
        if (!address(state.revision) || typeof state.libraryId !== 'string' || !state.libraryId) fail('INCOMPLETE_STORE', 'Transaction identity is incomplete.');
        row = { ...row, state }; rows.set(id, row);
      }
      if (!proven) for (const parent of parentsOf(row)) preserves(row.state, rows.get(parent).state);
      visiting.delete(id); seen.add(id);
    }
    for (const id of heads) await visit(id);
    if (seen.size !== rows.size) fail('INVALID_ANCESTRY', 'Unreachable transaction history requires recovery.');
    const libraryId = rows.get(heads[0]).state.libraryId;
    for (const row of rows.values()) if (row.state.libraryId !== libraryId) fail('WRONG_LIBRARY', 'The folder contains transactions from another library.');
    // All required object and receipt bytes are read above, including on a
    // warm graph. Only the unchanged manifest ancestry proof can be reused.
    verifiedSignature = signature;
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
      return { state: freeze(empty()), transaction: null };
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
    if (!verifiedTransactions.has(transaction)) {
      await createTransfer(state);
      if (verifiedTransactions.size >= 128) verifiedTransactions.delete(verifiedTransactions.values().next().value);
      verifiedTransactions.add(transaction);
    }
    return { state, transaction };
  }
  function access(context = null) { return {
    root,
    async inspect() {
      const names = (await readdir(root)).sort();
      if (names.some(name => !['transactions', 'objects', 'receipts', '.DS_Store'].includes(name))) {
        fail('UNRECOGNIZED_FOLDER', 'Choose an empty folder or an existing PromptLab library. Keep other files intact.');
      }
      const value = await graph(), revision = await graphRevision(value), heads = [];
      // Verify every head even when the response must be bounded.
      for (const transactionId of value.heads) {
        const state = value.rows.get(transactionId).state, transfer = await createTransfer(state);
        if (heads.length < 100) heads.push({ transactionId, revision: state.revision, counts: transfer.manifest.counts });
      }
      if (!value.heads.length) {
        for (const directory of ['transactions', 'objects', 'receipts']) {
          const entries = await readdir(join(root, directory)).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
          if (entries.some(name => name !== '.DS_Store')) fail('INCOMPLETE_STORE', 'Uncommitted content needs recovery before creating a library.');
        }
      }
      const after = await lstat(root);
      if (after.isSymbolicLink() || after.dev !== metadata.dev || after.ino !== metadata.ino
        || canonical(names) !== canonical((await readdir(root)).sort()) || revision !== await graphRevision(await graph())) {
        fail('FOLDER_CHANGED', 'The selected folder changed during inspection. Select it again.');
      }
      return { format: 'promptlab-folder-inspection', schemaVersion: 1, libraryId: value.libraryId,
        graphRevision: revision, headCount: value.heads.length, heads, recoveryRequired: value.heads.length > 1,
        directoryIdentity: { device: String(after.dev), inode: String(after.ino) } };
    },
    async read() { return structuredClone((await selected(await graph(), context)).state); },
    // Internal read stages may share immutable content. This still rebuilds
    // the graph from freshly read bytes, including recovery branch checks.
    async readSnapshot() { return (await selected(await graph(), context)).state; },
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
      if (readOnly) throw new LibraryError('READ_ONLY', 'Folder inspection cannot change the library.', 403);
      const previous = writers.get(root) ?? Promise.resolve();
      const pending = previous.then(async () => {
        const beforeGraph = await graph(), before = await selected(beforeGraph, context);
        const draft = structuredClone(before.state);
        const result = await fn(draft);
        // The callback cannot alter the bytes after verification starts.
        const state = freeze(structuredClone(draft));
        if (sameState(state, before.state)) return result;
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
        const retained = inherited(consumed, beforeGraph.rows);
        const addedObjects = Object.keys(state.objects).filter(id => !retained.objects.has(id)).sort();
        const addedReceipts = {};
        for (const operationId of Object.keys(state.operations).filter(id => !retained.operations.has(id)).sort()) {
          Object.defineProperty(addedReceipts, operationId, { value: await hash(state.operations[operationId]), enumerable: true });
        }
        const metadata = metadataOf(state);
        const row = { schemaVersion: 3, parents: consumed.sort(), metadata, objects: addedObjects, operations: addedReceipts, checkpoints: state.checkpoints };
        const id = await hash(row);
        for (const objectId of addedObjects) await objects.publish(objectId, state.objects[objectId]);
        for (const [operationId, receiptId] of Object.entries(addedReceipts)) await receipts.publish(receiptId, state.operations[operationId]);
        // Object publication may be slow or interrupted. Recheck the heads
        // before exposing the manifest that makes these files authoritative.
        if (canonical((await graph()).heads) !== canonical(beforeGraph.heads)) throw new LibraryError('REVISION_CONFLICT', 'Folder changed during content publication.', 409);
        await transactions.publish(id, row);
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
