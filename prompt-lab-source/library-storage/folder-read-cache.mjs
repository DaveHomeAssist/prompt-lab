import { canonical, hash, ownObjectTable, LibraryError, MAX_BYTES } from './contract.mjs';

const record = value => value && Object.getPrototypeOf(value) === Object.prototype;

// Private parsed-file cache. The caller verifies actual file bytes on every
// access and verifies the canonical file address before remembering new bytes.
export function createFolderReadCache({ kind, maxBytes = MAX_BYTES, maxEntries = 128 } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_BYTES
    || !Number.isInteger(maxEntries) || maxEntries < 0 || maxEntries > 128) throw new LibraryError('INVALID_CACHE', 'Cache limits must stay within the folder read budget.');
  const entries = new Map(), shared = new Map(), frozen = new WeakSet();
  let bytes = 0;
  function freeze(value) {
    if (!value || typeof value !== 'object' || frozen.has(value)) return value;
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value); frozen.add(value);
    return value;
  }
  function remove(name) {
    const entry = entries.get(name);
    if (!entry) return;
    entries.delete(name); bytes -= entry.bytes;
    for (const id of entry.references.keys()) {
      const item = shared.get(id);
      if (--item.references === 0) { bytes -= item.bytes; shared.delete(id); }
    }
  }
  async function prepare(value, rawBytes) {
    freeze(value);
    const references = new Map();
    if (kind !== '' || !record(value) || ![1, 2].includes(value.schemaVersion)
      || !record(value.state) || !record(value.state.objects)) {
      return { value, references, bytes: rawBytes * (kind === 'object' ? 5 : 3) + 256 };
    }
    const objects = [];
    for (const [id, object] of Object.entries(value.state.objects)) {
      let item = shared.get(id);
      if (item) {
        if (canonical(object) !== canonical(item.value)) throw new LibraryError('HASH_MISMATCH', 'Retained content differs at the same object address.', 503);
      } else {
        const owned = ownObjectTable({ object }).object;
        if (await hash(owned) !== id) throw new LibraryError('HASH_MISMATCH', 'Retained object failed verification.', 503);
        item = { value: owned, bytes: Buffer.byteLength(canonical(owned)) * 5 + 256, references: 0 };
      }
      references.set(id, item); objects.push([id, item.value]);
    }
    // Count every transaction field and reference, but each shared object's
    // parsed value and canonical string only once while any entry retains it.
    const envelope = { ...value, state: { ...value.state,
      objects: Object.fromEntries(objects.map(([id]) => [id, null])) } };
    return { value: freeze({ ...value, state: { ...value.state, objects: Object.fromEntries(objects) } }),
      references, bytes: Buffer.byteLength(canonical(envelope)) * 3 + 256 };
  }
  return {
    get(name, digest) {
      const entry = entries.get(name);
      if (!entry || entry.digest !== digest) return undefined;
      entries.delete(name); entries.set(name, entry);
      return entry.value;
    },
    async remember(name, digest, value, rawBytes) {
      const entry = { ...await prepare(value, rawBytes), digest };
      const total = entry.bytes + [...entry.references.values()].reduce((sum, item) => sum + item.bytes, 0);
      if (total > maxBytes || maxEntries < 1) return entry.value;
      for (const [id, item] of entry.references) {
        const current = shared.get(id);
        if (current && canonical(current.value) !== canonical(item.value)) throw new LibraryError('HASH_MISMATCH', 'Retained content changed during cache preparation.', 503);
      }
      remove(name);
      const additional = () => entry.bytes + [...entry.references]
        .reduce((sum, [id, item]) => sum + (shared.has(id) ? 0 : item.bytes), 0);
      while (entries.size >= maxEntries || bytes + additional() > maxBytes) remove(entries.keys().next().value);
      for (const [id, item] of entry.references) {
        if (!shared.has(id)) { shared.set(id, item); bytes += item.bytes; }
        const current = shared.get(id);
        current.references++; entry.references.set(id, current);
      }
      // Another read may have prepared the same content during an awaited hash.
      // Point every retained entry at the value whose memory is counted now.
      if (entry.references.size) entry.value = freeze({ ...entry.value, state: { ...entry.value.state,
        objects: Object.fromEntries([...entry.references].map(([id, item]) => [id, item.value])) } });
      entries.set(name, entry); bytes += entry.bytes;
      return entry.value;
    },
    usage() { return { bytes, entries: entries.size, sharedObjects: shared.size }; },
  };
}
