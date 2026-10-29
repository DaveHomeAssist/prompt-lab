import { open, realpath, link, unlink, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, resolve, relative, isAbsolute, join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { MAX_BYTES, LibraryError } from './contract.mjs';
import { inspectTransfer, TRANSFER_FORMAT } from './transfer.mjs';

const MAX_RECORD_BYTES = MAX_BYTES + 65536;
export const MAX_BACKUP_BYTES = 256 * 1024 * 1024;
function validateLimit(maxBytes) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_BACKUP_BYTES) throw new LibraryError('INVALID_REQUEST', 'Backup byte limit must be a positive integer up to 256 MiB.', 400);
}
const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
const invalid = message => { throw new LibraryError('INVALID_BACKUP', message); };
const inside = (parent, child) => { const path = relative(parent, child); return !path || (!isAbsolute(path) && path !== '..' && !path.startsWith('../') && !path.startsWith('..\\')); };

function* frames(transfer) {
  yield { type: 'manifest', format: TRANSFER_FORMAT, schemaVersion: 1, manifest: transfer.manifest, manifestHash: transfer.manifestHash };
  yield { type: 'metadata', value: transfer.metadata };
  yield { type: 'checkpoints', value: transfer.checkpoints };
  for (const { hash } of transfer.manifest.objects) yield { type: 'object', hash, value: transfer.objects[hash] };
  for (const { operationId } of transfer.manifest.operations) yield { type: 'operation', operationId, value: transfer.operations[operationId] };
  yield { type: 'complete', manifestHash: transfer.manifestHash, records: 4 + transfer.manifest.objects.length + transfer.manifest.operations.length };
}

// Frames are individually bounded so a retained archive can exceed one object.
// Never return a truncated archive when EOF interrupts the final frame.
async function* readFrames(handle, observeChunk) {
  let parts = [], length = 0;
  for await (const chunk of handle.createReadStream({ autoClose: false })) {
    observeChunk(chunk);
    let start = 0;
    for (let end = chunk.indexOf(10); end >= 0; end = chunk.indexOf(10, start)) {
      const piece = chunk.subarray(start, end);
      length += piece.length;
      if (length > MAX_RECORD_BYTES) throw new LibraryError('PAYLOAD_TOO_LARGE', 'Backup record exceeds its limit.', 413);
      parts.push(piece);
      let value;
      try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts, length))); }
      catch { invalid('Backup record is not valid UTF-8 JSON.'); }
      yield value;
      parts = []; length = 0; start = end + 1;
    }
    const rest = chunk.subarray(start);
    if (rest.length) { parts.push(rest); length += rest.length; }
    if (length > MAX_RECORD_BYTES) throw new LibraryError('PAYLOAD_TOO_LARGE', 'Backup record exceeds its limit.', 413);
  }
  if (length) invalid('Backup ended during a record.');
}

export async function readBackup(path, { expectedManifestHash, expectedFileHash, maxBytes = MAX_BACKUP_BYTES } = {}) {
  validateLimit(maxBytes);
  if ((await lstat(path)).isSymbolicLink()) throw new LibraryError('UNSAFE_DIRECTORY', 'Backup cannot be a symbolic link.');
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) invalid('Backup must be a regular file.');
    if (stat.size > maxBytes) throw new LibraryError('PAYLOAD_TOO_LARGE', 'Backup exceeds the configured byte limit.', 413);
    const digest = createHash('sha256'); let bytes = 0;
    let transfer, count = 0, complete = false, phase = 0;
    for await (const frame of readFrames(handle, chunk => {
      bytes += chunk.length;
      if (bytes > maxBytes) throw new LibraryError('PAYLOAD_TOO_LARGE', 'Backup exceeds the configured byte limit.', 413);
      digest.update(chunk);
    })) {
      count++;
      if (!record(frame) || complete) invalid('Unexpected backup record.');
      const fields = { manifest: ['type', 'format', 'schemaVersion', 'manifest', 'manifestHash'], metadata: ['type', 'value'], checkpoints: ['type', 'value'],
        object: ['type', 'hash', 'value'], operation: ['type', 'operationId', 'value'], complete: ['type', 'manifestHash', 'records'] };
      if (!Object.hasOwn(fields, frame.type) || Object.keys(frame).some(key => !fields[frame.type].includes(key))) invalid('Unsupported backup record fields.');
      if (phase === 0) {
        if (frame.type !== 'manifest' || frame.format !== TRANSFER_FORMAT || frame.schemaVersion !== 1
          || !Array.isArray(frame.manifest?.objects) || !Array.isArray(frame.manifest?.operations)) invalid('Backup manifest is missing or unsupported.');
        if (expectedManifestHash != null && frame.manifestHash !== expectedManifestHash) throw new LibraryError('TRANSFER_CHANGED', 'Backup differs from its reviewed manifest.', 409);
        transfer = { format: frame.format, schemaVersion: frame.schemaVersion, manifest: frame.manifest, manifestHash: frame.manifestHash, objects: {}, operations: {} };
        phase = 1;
      } else if (phase === 1) {
        if (frame.type !== 'metadata') invalid('Backup metadata is missing.');
        transfer.metadata = frame.value; phase = 2;
      } else if (phase === 2) {
        if (frame.type !== 'checkpoints') invalid('Backup checkpoints are missing.');
        transfer.checkpoints = frame.value; phase = 3;
      } else if (frame.type === 'object') {
        if (Object.hasOwn(transfer.objects, frame.hash) || !transfer.manifest.objects.some(item => item.hash === frame.hash)) invalid('Unexpected or duplicate backup object.');
        Object.defineProperty(transfer.objects, frame.hash, { value: frame.value, enumerable: true });
      } else if (frame.type === 'operation') {
        if (Object.hasOwn(transfer.operations, frame.operationId) || !transfer.manifest.operations.some(item => item.operationId === frame.operationId)) invalid('Unexpected or duplicate operation receipt.');
        Object.defineProperty(transfer.operations, frame.operationId, { value: frame.value, enumerable: true });
      } else if (frame.type === 'complete') {
        if (frame.manifestHash !== transfer.manifestHash || frame.records !== count) invalid('Backup completion record disagrees.');
        complete = true;
      } else invalid('Unsupported backup record.');
    }
    if (!complete) invalid('Backup is incomplete; no complete transfer was published.');
    const fileSha256 = digest.digest('hex');
    if (expectedFileHash != null && expectedFileHash !== fileSha256) throw new LibraryError('TRANSFER_CHANGED', 'Backup bytes differ from the expected file hash.', 409);
    return { ...await inspectTransfer(transfer, { expectedManifestHash }), fileSha256, bytes };
  } finally { await handle.close(); }
}

export async function writeBackup(path, input, { liveDirectory, excludedDirectories = [], maxBytes = MAX_BACKUP_BYTES, fault = async () => {} } = {}) {
  validateLimit(maxBytes);
  if (typeof liveDirectory !== 'string' || !liveDirectory) throw new LibraryError('INVALID_BACKUP_LOCATION', 'Identify the live library directory before exporting a backup.');
  // Own the complete input before filesystem operations or validation yield.
  const transfer = structuredClone(input);
  const inspected = await inspectTransfer(transfer);
  const target = resolve(path), parent = dirname(target);
  if (await realpath(parent) !== parent) throw new LibraryError('UNSAFE_DIRECTORY', 'Backup destination cannot traverse symbolic links.');
  for (const directory of [liveDirectory, ...excludedDirectories]) {
    if (inside(await realpath(directory), target)) throw new LibraryError('INVALID_BACKUP_LOCATION', 'Choose a backup outside the live library and its excluded sync directories.');
  }
  const temporary = join(parent, `.promptlab-backup-${randomUUID()}.pending`);
  const handle = await open(temporary, 'wx', 0o600);
  const digest = createHash('sha256'); let written = 0;
  try {
    for (const frame of frames(transfer)) {
      const bytes = Buffer.from(JSON.stringify(frame) + '\n');
      if (bytes.length > MAX_RECORD_BYTES + 1) throw new LibraryError('PAYLOAD_TOO_LARGE', 'Backup record exceeds its limit.', 413);
      written += bytes.length;
      if (written > maxBytes) throw new LibraryError('PAYLOAD_TOO_LARGE', 'Backup exceeds the configured byte limit.', 413);
      digest.update(bytes);
      await handle.writeFile(bytes);
    }
    await fault('before-flush');
    await handle.sync();
  } finally { await handle.close(); }
  await fault('before-publication');
  // A hard link publishes atomically and fails if the destination already exists.
  // rename() would overwrite an existing backup on POSIX.
  await link(temporary, target);
  const directory = await open(parent, 'r');
  try { await directory.sync(); } finally { await directory.close(); }
  await fault('after-publication');
  const readback = await readBackup(target, { expectedManifestHash: inspected.manifestHash, expectedFileHash: digest.digest('hex'), maxBytes });
  await unlink(temporary);
  return { path: target, libraryId: readback.libraryId, revision: readback.revision, manifestHash: readback.manifestHash,
    counts: readback.counts, fileSha256: readback.fileSha256, bytes: readback.bytes, verified: true, outsideLiveDirectory: true, cloudReplication: 'unknown' };
}
