import { canonical, hash, inspectPackage, LibraryError, readObject } from './contract.mjs';
import { inspectSourceBinding } from './source-binding.mjs';
import { DELETION_PREFIXES } from './source-inventory.mjs';

const object = value => value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
const id = value => typeof value === 'string' && value.length > 0;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const localDomains = new Map([
  ['pl2-library', ['prompts', 'list']], ['pl2-library-trash', ['trash', 'list']],
  ['pl2-collections', ['collections', 'list']], ['pl2-collection-folders', ['folders', 'list']],
  ['pl2-packs', ['packs', 'dictionary']], ['pl2-loaded-packs', ['loaded-packs', 'list']],
  ['pl2-pads', ['scratch', 'scratch']], ['pl2-experiment-history', ['experiments', 'list']],
  ['pl2-experiment-fallback', ['experiments', 'list']], ['pl2-eval-run-fallback', ['evaluations', 'list']],
  ['pl2-test-case-fallback', ['test-cases', 'list']], ['pl2-run-fallback', ['execution-traces', 'list']],
  ['pl2-recent-artwork', ['assets', 'list']], ['pl2-draft-reset-recovery-v1', ['recovery', 'single']],
  ['pl2-session-pl2-session', ['drafts', 'single']], ['pl2-session-pl2-dual-draft', ['drafts', 'single']],
]);
const workspaceDomains = new Map([
  ['library', ['prompts', 'list']], ['trash', ['trash', 'list']],
  ['collections', ['collections', 'list']], ['folders', ['folders', 'list']],
  ['packs', ['packs', 'dictionary']], ['loadedPacks', ['loaded-packs', 'list']],
  ['scratch', ['scratch', 'scratch']], ['runs', ['evaluations', 'list']],
  ['evaluations', ['evaluations', 'list']], ['testCases', ['test-cases', 'list']],
  ['experiments', ['experiments', 'list']], ['traceRuns', ['execution-traces', 'list']],
  ['assets', ['assets', 'dictionary']], ['backups', ['backups', 'list']],
  ['markers', ['deletion-markers', 'single']],
]);
const indexedDomains = new Map([['experiments', 'experiments'], ['evaluations', 'evaluations'],
  ['test-cases', 'test-cases'], ['execution-traces', 'execution-traces']]);

// This is a preserved-data read model. It does not choose active replicas or
// authorize migration. Values and addresses come only from verified objects.
export async function buildDomainMap(pkg) {
  pkg = structuredClone(pkg);
  const verified = await inspectPackage(pkg);
  const records = [], issues = [], stores = [], scopes = new Map();
  const pendingReferences = [], sourcePairs = new Map();
  const issue = (code, origin, key = null) => issues.push({ code, origin, key });
  const address = (context, objectHash, path = [], decodedPath = null) => ({ ...context, object: objectHash, path, decodedPath });
  const child = (origin, ...path) => origin.decodedPath === null
    ? { ...origin, path: [...origin.path, ...path] }
    : { ...origin, decodedPath: [...origin.decodedPath, ...path] };
  const groupDomain = domain => domain === 'trash' ? 'prompts' : domain;
  const namespace = origin => origin.binding ?? `unbound:${origin.object}`;
  function reference(row, path, domain, sourceId, parentId = null) {
    if (sourceId === null || sourceId === undefined || sourceId === '') return;
    pendingReferences.push({ row, path, domain, sourceId, parentId });
  }
  async function add(domain, value, origin, { parent = null, sourceId, primaryKey } = {}) {
    if (records.length >= 100_000) throw new LibraryError('PAYLOAD_TOO_LARGE', 'Domain index exceeds 100,000 occurrences; no records were omitted.', 413);
    const embeddedId = object(value) ? value[domain === 'execution-traces' ? 'run_id' : 'id'] : undefined;
    sourceId = sourceId ?? embeddedId ?? (['collections', 'loaded-packs'].includes(domain) && typeof value === 'string' ? value : null);
    const key = await hash({ domain, origin });
    const row = { key, domain, origin, parent: parent?.key ?? null, sourceId,
      ...(primaryKey === undefined ? {} : { primaryKey }), valueHash: await hash(value), value,
      references: [], identity: null };
    records.push(row);
    if (sourceId !== null && !id(sourceId)) issue('INVALID_RECORD_ID', origin, key);
    if (sourceId !== null && id(sourceId)) {
      const parentScoped = ['prompt-versions', 'evaluation-candidates'].includes(domain);
      const owner = parentScoped ? parent?.sourceId : null;
      // A version without a named parent cannot join another prompt's history.
      const parentScope = parentScoped ? owner ?? parent?.key
        : ['prompt-variants', 'embedded-test-cases', 'experiment-variants'].includes(domain) ? parent?.key : null;
      row.identity = await hash([namespace(origin), groupDomain(domain), parentScope, sourceId]);
      if (!scopes.has(row.identity)) scopes.set(row.identity, []);
      scopes.get(row.identity).push(row);
    }
    if (domain === 'loaded-packs') reference(row, [], 'packs', value);
    if (!object(value)) return row;
    if (['prompts', 'trash'].includes(domain)) {
      if (value.versions !== undefined) await collection('prompt-versions', value.versions, child(origin, 'versions'), 'list', row);
      reference(row, ['currentVersionId'], 'prompt-versions', value.currentVersionId, value.id);
      reference(row, ['folderId'], 'folders', value.folderId);
      reference(row, ['collection'], 'collections', value.collection);
      reference(row, ['metadata', 'packId'], 'packs', value.metadata?.packId);
      if (value.testCases !== undefined) await collection('embedded-test-cases', value.testCases, child(origin, 'testCases'), 'list', row);
      const followUp = value.metadata?.followUpOrigin;
      if (object(followUp)) {
        const prefix = ['metadata', 'followUpOrigin'];
        reference(row, [...prefix, 'sourcePromptId'], 'prompts', followUp.sourcePromptId);
        reference(row, [...prefix, 'sourcePromptVersionId'], 'prompt-versions', followUp.sourcePromptVersionId, followUp.sourcePromptId);
        reference(row, [...prefix, 'sourceRunId'], 'evaluations', followUp.sourceRunId);
        reference(row, [...prefix, 'sourceCandidateId'], 'evaluation-candidates', followUp.sourceCandidateId, followUp.sourceRunId);
      }
    }
    if (['prompts', 'trash', 'prompt-versions'].includes(domain)) {
      if (value.variants !== undefined) await collection('prompt-variants', value.variants, child(origin, 'variants'), 'list', row);
      reference(row, ['resultMeta', 'runId'], 'evaluations', value.resultMeta?.runId);
      reference(row, ['goldenResponse', 'pinnedFromRunId'], 'evaluations', value.goldenResponse?.pinnedFromRunId);
    }
    if (domain === 'folders') reference(row, ['parentId'], 'folders', value.parentId);
    if (domain === 'experiments' && value.variants !== undefined) await collection('experiment-variants', value.variants, child(origin, 'variants'), 'list', row);
    if (['evaluations', 'test-cases', 'execution-traces'].includes(domain)) {
      const promptId = value.promptId ?? value.prompt_id;
      reference(row, [Object.hasOwn(value, 'promptId') ? 'promptId' : 'prompt_id'], 'prompts', promptId);
      reference(row, ['promptVersionId'], 'prompt-versions', value.promptVersionId, promptId);
      reference(row, ['testCaseId'], 'test-cases', value.testCaseId);
      reference(row, ['runId'], 'evaluations', value.runId);
    }
    if (domain === 'execution-traces') {
      reference(row, ['parent_run_id'], 'execution-traces', value.parent_run_id);
      reference(row, ['fork_of_run_id'], 'execution-traces', value.fork_of_run_id);
    }
    if (domain === 'evaluations') {
      if (value.candidates !== undefined) await collection('evaluation-candidates', value.candidates, child(origin, 'candidates'), 'list', row);
      reference(row, ['selectedCandidateId'], 'evaluation-candidates', value.selectedCandidateId, value.id);
      reference(row, ['primaryId'], 'evaluation-candidates', value.primaryId, value.id);
    }
    if (domain === 'scratch-notes') {
      reference(row, ['linkedPromptId'], 'prompts', value.linkedPromptId);
      if (Array.isArray(value.linkedPrompts)) for (const [i, link] of value.linkedPrompts.entries()) reference(row, ['linkedPrompts', i, 'id'], 'prompts', link?.id);
    }
    if (domain === 'scratch') {
      if (value.pads !== undefined) await collection('scratch-notes', value.pads, child(origin, 'pads'), 'list', row);
      if (value.tombstones !== undefined) await collection('scratch-tombstones', value.tombstones, child(origin, 'tombstones'), 'dictionary', row);
      reference(row, ['activePadId'], 'scratch-notes', value.activePadId);
    }
    // The complete owner value retains arbitrary variants, source metadata,
    // usage and unknown nested fields. Artwork is additionally addressable.
    if (Object.hasOwn(value, 'artwork')) await add('assets', value.artwork, child(origin, 'artwork'), { parent: row });
    return row;
  }
  async function collection(domain, value, origin, shape, parent = null, primaryKeys) {
    if (shape === 'single' || shape === 'scratch') {
      if (shape === 'scratch' && !object(value)) issue('INVALID_STORE_SHAPE', origin);
      await add(domain, value, origin, { parent });
    } else if ((shape === 'list' && Array.isArray(value)) || (shape === 'dictionary' && object(value))) {
      const entries = shape === 'list' ? [...value.entries()] : Object.entries(value).sort(([a], [b]) => compare(a, b));
      for (const [entryKey, entry] of entries) {
        const row = await add(domain, entry, child(origin, entryKey), {
          parent, ...(shape === 'dictionary' ? { sourceId: entryKey } : {}),
          ...(Array.isArray(primaryKeys) ? { primaryKey: primaryKeys[entryKey] } : {}),
        });
        if (!object(entry) && !['collections', 'loaded-packs', 'scratch-tombstones', 'assets', 'backups'].includes(domain)) issue('INVALID_RECORD_SHAPE', row.origin, row.key);
      }
    } else {
      const row = await add('unmapped', value, origin, { parent });
      issue('INVALID_STORE_SHAPE', origin, row.key);
    }
  }
  async function localEntries(entries, context, root, path) {
    if (!object(entries)) { issue('INVALID_STORE_SHAPE', address(context, root, path)); return; }
    for (const [key, raw] of Object.entries(entries).sort(([a], [b]) => compare(a, b))) {
      const origin = address({ ...context, replica: `${context.replica}/${key}` }, root, [...path, key]);
      const mapping = localDomains.get(key);
      stores.push({ origin, state: raw === null ? 'absent' : 'present', domain: mapping?.[0] ?? 'source-metadata' });
      if (raw === null) continue;
      // The container always retains the exact string, even for corrupt JSON.
      const container = await add('source-stores', raw, origin);
      if (mapping) {
        let parsed;
        try { parsed = JSON.parse(raw); } catch { issue('INVALID_STORE_JSON', origin, container.key); continue; }
        await collection(mapping[0], parsed, { ...origin, decodedPath: [] }, mapping[1], container);
      } else {
        const domain = DELETION_PREFIXES.some(prefix => key.startsWith(prefix)) ? 'deletion-markers'
          : ['pl2-pad', 'pl-pad', 'pl2-pad_meta', 'pl-pad_meta'].includes(key) ? 'scratch-legacy' : 'source-metadata';
        await add(domain, raw, origin, { parent: container, sourceId: key });
      }
    }
  }
  async function workspace(pair, bindingHash = null, inspected = null) {
    const context = { binding: bindingHash, sourceIdentity: inspected?.manifest.sourceIdentity ?? null,
      surface: inspected?.manifest.surface ?? null, replica: 'workspace' };
    const origin = address(context, pair.workspace), value = await readObject(pkg.objects, pair.workspace, 'workspace');
    const container = await add('source-stores', value, origin);
    stores.push({ origin, state: 'present', domain: 'workspace' });
    for (const [key, [domain, shape]] of workspaceDomains) if (Object.hasOwn(value, key)) {
      await collection(domain, value[key], child(origin, key), shape, container);
    }
    if (!bindingHash) issue('UNBOUND_WORKSPACE', origin, container.key);
  }
  // Traverse only retained ancestry; unrelated objects cannot invent a source.
  const visited = new Set();
  async function ancestry(revision) {
    if (visited.has(revision)) return;
    visited.add(revision);
    const commit = await readObject(pkg.objects, revision, 'commit');
    for (const parent of commit.parents) await ancestry(parent);
    if (commit.operation === 'restore') return;
    const pair = { source: commit.source, workspace: commit.inputState ?? commit.state };
    sourcePairs.set(canonical(pair), pair);
  }
  await ancestry(pkg.head);
  const boundPairs = new Set();
  for (const bindingHash of verified.sourceBindings) {
    const inspected = await inspectSourceBinding(pkg.objects, bindingHash);
    const { binding, manifest, captures } = inspected;
    const pair = { source: binding.source, workspace: binding.workspace };
    boundPairs.add(canonical(pair));
    await workspace(pair, bindingHash, inspected);
    for (const source of manifest.sources) {
      const context = { binding: bindingHash, sourceIdentity: manifest.sourceIdentity, surface: manifest.surface, replica: source.id };
      const origin = address(context, source.hash ?? binding.inventory);
      stores.push({ origin, state: source.state, domain: indexedDomains.get(source.id) ?? source.id });
      if (['unavailable', 'changed', 'unreviewed'].includes(source.state)) issue('SOURCE_NOT_COMPLETE', origin);
      const capture = captures[source.id];
      if (!capture) continue;
      await add('source-stores', capture, origin);
      if (source.id === 'local-content') await localEntries(capture.entries, context, source.hash, ['entries']);
      else if (source.id === 'durable-journal' && capture.state === 'present') {
        for (const [i, entry] of capture.records.entries()) {
          const journalContext = { ...context, replica: `${source.id}/${i}` };
          const recordOrigin = address(journalContext, source.hash, ['records', i]);
          const journal = await add('journal-records', entry, recordOrigin);
          if (!object(entry) || !['library', 'scratch'].includes(entry.id)) issue('UNKNOWN_JOURNAL_RECORD', recordOrigin, journal.key);
          else await localEntries(entry.entries, journalContext, source.hash, ['records', i, 'entries']);
        }
      } else if (indexedDomains.has(source.id) && capture.state === 'present') {
        const validKeys = Array.isArray(capture.primaryKeys) && capture.primaryKeys.length === capture.records.length;
        if (capture.primaryKeys !== undefined && !validKeys) issue('INVALID_PRIMARY_KEYS', origin);
        await collection(indexedDomains.get(source.id), capture.records, child(origin, 'records'), 'list', null, validKeys ? capture.primaryKeys : undefined);
      } else if (source.id === 'selected-archives') await collection('backups', capture.records, child(origin, 'records'), 'list');
      else if (source.id === 'extension-drafts') for (const [key, value] of Object.entries(capture.entries)) {
        if (value !== null) await add('drafts', value, child(origin, 'entries', key), { sourceId: key });
      }
    }
  }
  for (const [key, pair] of [...sourcePairs].sort(([a], [b]) => compare(a, b))) if (!boundPairs.has(key)) await workspace(pair);

  for (const { row, path, domain, sourceId, parentId } of pendingReferences) {
    let candidates = [];
    if (id(sourceId) && (!['prompt-versions', 'evaluation-candidates'].includes(domain) || id(parentId))) {
      const identity = await hash([namespace(row.origin), domain, parentId, sourceId]);
      candidates = (scopes.get(identity) ?? []).map(candidate => candidate.key);
      if (domain === 'prompt-versions') {
        // The current version can live on the prompt itself, outside history.
        for (const prompt of scopes.get(await hash([namespace(row.origin), 'prompts', null, parentId])) ?? []) {
          if (prompt.value.currentVersionId === sourceId) candidates.push(prompt.key);
        }
      }
    }
    candidates = [...new Set(candidates)].sort();
    row.references.push({ path, domain, sourceId, candidates,
      status: !id(sourceId) ? 'invalid' : candidates.length === 0 ? 'missing' : candidates.length === 1 ? 'resolved' : 'ambiguous' });
  }
  const identities = [...scopes.entries()].map(([key, rows]) => ({ key, candidates: rows.map(row => row.key).sort(),
    divergent: new Set(rows.map(row => row.valueHash)).size > 1 }));
  records.sort((a, b) => compare(a.key, b.key)); identities.sort((a, b) => compare(a.key, b.key));
  const counts = {};
  for (const row of records) Object.defineProperty(counts, row.domain, { value: (counts[row.domain] ?? 0) + 1, enumerable: true, configurable: true });
  return { format: 'promptlab-domain-map', schemaVersion: 1, libraryId: pkg.libraryId, revision: pkg.head,
    view: 'preserved', activationReady: false, records, identities, stores, issues, counts };
}

export function validateDomainPage({ domain, cursor = '0', limit = 100 } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || typeof cursor !== 'string'
    || !/^(0|[1-9][0-9]*)$/.test(cursor) || !Number.isSafeInteger(Number(cursor))
    || (domain !== undefined && (typeof domain !== 'string' || !domain))) throw new LibraryError('INVALID_REQUEST', 'Invalid domain pagination.', 400);
}

export function pageDomainMap(map, { domain, cursor = '0', limit = 100 } = {}) {
  validateDomainPage({ domain, cursor, limit });
  const rows = domain === undefined ? map.records : map.records.filter(row => row.domain === domain);
  const offset = Number(cursor), items = rows.slice(offset, offset + limit), keys = new Set(items.map(item => item.key));
  return { format: 'promptlab-domain-page', schemaVersion: 1, libraryId: map.libraryId, revision: map.revision,
    view: map.view, activationReady: false, domain: domain ?? null, total: rows.length, counts: map.counts,
    stores: map.stores,
    items, identities: map.identities.filter(identity => identity.candidates.some(key => keys.has(key))),
    issues: map.issues.filter(issue => issue.key === null || keys.has(issue.key)),
    nextCursor: offset + limit < rows.length ? String(offset + limit) : null };
}
