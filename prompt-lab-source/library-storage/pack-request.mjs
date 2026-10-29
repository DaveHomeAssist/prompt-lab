import { canonical, LibraryError } from './contract.mjs';

const object = value => value && Object.getPrototypeOf(value) === Object.prototype;
const address = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const id = value => typeof value === 'string' && value.trim() && value.length <= 200;
const fail = () => { throw new LibraryError('INVALID_PACK_COMMAND', 'Pin the source, revision and pack identity; review every member and confirm removal explicitly.', 409); };

export function normalizePackRequest(value) {
  if (!object(value) || !id(value.libraryId) || !address(value.expectedRevision) || !address(value.sourceBinding)
    || !id(value.packId) || !['publish', 'remove', 'install'].includes(value.action)
    || typeof value.changedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.changedAt)
    || !Number.isFinite(Date.parse(value.changedAt)) || new Date(value.changedAt).toISOString() !== value.changedAt) fail();
  canonical(value);
  const allowed = ['libraryId', 'expectedRevision', 'sourceBinding', 'packId', 'changedAt', 'action',
    ...(value.action === 'publish' ? ['pack', 'members'] : value.action === 'install' ? ['sourceText', 'choices'] : ['confirmRemoval'])];
  if (Object.keys(value).some(key => !allowed.includes(key))) fail();
  if (value.action === 'remove') { if (value.confirmRemoval !== true) fail(); }
  else if (value.action === 'install') {
    if (typeof value.sourceText !== 'string' || !value.sourceText.length || value.sourceText.length > 20_000_000
      || !Array.isArray(value.choices) || value.choices.length > 1000) fail();
    const indexes = new Set(), targets = new Set(), identities = new Set();
    for (const choice of value.choices) {
      if (!object(choice) || !Number.isSafeInteger(choice.index) || choice.index < 0 || indexes.has(choice.index)
        || !['add', 'skip', 'replace'].includes(choice.action)) fail();
      indexes.add(choice.index);
      const keys = ['index', 'action', ...(choice.action === 'add' ? ['promptId'] : choice.action === 'replace' ? ['groupId', 'expectedRecordHash'] : [])];
      if (Object.keys(choice).length !== keys.length || Object.keys(choice).some(key => !keys.includes(key))) fail();
      if (choice.action === 'add') { if (!id(choice.promptId) || identities.has(choice.promptId)) fail(); identities.add(choice.promptId); }
      if (choice.action === 'replace') {
        if (!address(choice.groupId) || !address(choice.expectedRecordHash) || targets.has(choice.groupId)) fail();
        targets.add(choice.groupId);
      }
    }
  } else {
    if (!object(value.pack) || value.pack.id !== value.packId || typeof value.pack.title !== 'string' || !value.pack.title.trim()
      || typeof value.pack.source !== 'string' || typeof value.pack.version !== 'string'
      || !Array.isArray(value.members) || value.members.length > 1000
      || value.members.some(member => !object(member) || Object.keys(member).length !== 2
        || !address(member.groupId) || !address(member.expectedRecordHash))
      || new Set(value.members.map(member => member.groupId)).size !== value.members.length) fail();
  }
  return structuredClone(value);
}
