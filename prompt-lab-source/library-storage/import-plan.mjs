import { assertWorkspace, canonical, hash, LibraryError } from './contract.mjs';
import { getLibraryEntryCanonicalBody, normalizePromptText } from '../prompt-lab-extension/src/lib/libraryMatching.js';

const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
const keyFor = (source, path) => JSON.stringify([source, ...path]);
const titleFor = entry => normalizePromptText(entry.title).toLowerCase();
// Legacy imports accept content as an alias. Use it for matching only; the raw
// source and every history row remain untouched.
const bodyFor = entry => getLibraryEntryCanonicalBody({ ...entry, enhanced: entry.enhanced || entry.original || entry.prompt || entry.content });
const own = (object, key) => Object.hasOwn(object, key) ? object[key] : undefined;

/**
 * A selection graph, never a normalized workspace. Source paths and hashes keep
 * every member addressable without rewriting IDs or discarding conflicting data.
 * Callers must retain both source workspaces before publishing this graph.
 */
export async function planLosslessImport(existing, incoming, resolutions = {}) {
  assertWorkspace(existing);
  assertWorkspace(incoming);
  if (!record(resolutions)) throw new LibraryError('INVALID_RESOLUTIONS', 'Import choices must be an object.');
  canonical(resolutions);
  // Freeze the review input before hashing yields. A caller editing its draft
  // during the async walk must not create a mixed source/record fingerprint.
  existing = structuredClone(existing);
  incoming = structuredClone(incoming);
  resolutions = structuredClone(resolutions);
  const sources = { existing, incoming };
  const nodes = [], groups = [], rows = [], references = [];
  const nodeByKey = new Map(), groupByMember = new Map();
  const indexes = new Map();
  const sourceHashes = { existing: await hash(existing), incoming: await hash(incoming) };

  const index = (source, kind) => {
    const key = keyFor(source, [kind]);
    if (!indexes.has(key)) indexes.set(key, new Map());
    return indexes.get(key);
  };
  async function addNode(source, path, kind, data, identityIndex = kind) {
    if (!record(data)) throw new LibraryError('INVALID_RECORD', `Expected an object at ${keyFor(source, path)}.`);
    if (data.id != null && (typeof data.id !== 'string' || !data.id.trim())) {
      throw new LibraryError('INVALID_IDENTITY', `Invalid source ID at ${keyFor(source, path)}.`);
    }
    const key = keyFor(source, path);
    const ids = index(source, identityIndex);
    if (data.id && ids.has(data.id)) throw new LibraryError('AMBIGUOUS_ID', `Duplicate ${kind} ID in the ${source} source.`);
    const node = { key, source, path, kind, sourceId: data.id ?? null, hash: await hash(data) };
    nodes.push(node);
    nodeByKey.set(key, { node, data });
    if (data.id) ids.set(data.id, key);
    return key;
  }
  // Index the complete source before resolving references. Nothing is filtered
  // through a UI schema, and trash remains separate from active matching.
  for (const [source, workspace] of Object.entries(sources)) {
    for (const section of ['library', 'trash', 'runs', 'testCases', 'evaluations', 'experiments', 'traceRuns']) {
      if (workspace[section] == null) continue;
      if (!Array.isArray(workspace[section])) throw new LibraryError('INVALID_RECORD', `${section} must be an array.`);
      for (const [i, data] of workspace[section].entries()) {
        const prompt = section === 'library' || section === 'trash';
        const key = await addNode(source, [section, i], prompt ? 'prompt' : section, data, prompt ? 'prompts' : section);
        if (!prompt) continue;
        if (data.versions != null && !Array.isArray(data.versions)) throw new LibraryError('INVALID_RECORD', 'Prompt versions must be an array.');
        for (const [j, version] of (data.versions ?? []).entries()) {
          await addNode(source, [section, i, 'versions', j], 'version', version, key);
        }
        if (data.currentVersionId != null) {
          if (typeof data.currentVersionId !== 'string' || !data.currentVersionId.trim()) throw new LibraryError('INVALID_IDENTITY', 'Invalid current version ID.');
          // Some exports include the current version in their history array.
          // Keep both records and report the two possible source records.
          const versions = index(source, key);
          const historical = versions.get(data.currentVersionId);
          versions.set(data.currentVersionId, historical ? [key, historical] : key);
        }
      }
    }
    if (workspace.scratch?.pads != null) {
      if (!Array.isArray(workspace.scratch.pads)) throw new LibraryError('INVALID_RECORD', 'Scratch pads must be an array.');
      for (const [i, pad] of workspace.scratch.pads.entries()) await addNode(source, ['scratch', 'pads', i], 'pad', pad);
    }
  }

  const indexed = [];
  async function newGroup(member) {
    const group = { id: await hash({ source: sourceHashes[member.source], member: member.key }), selected: member.key, members: [member.key] };
    groups.push(group);
    groupByMember.set(member.key, group);
    return group;
  }
  for (const node of nodes.filter(node => node.source === 'existing' && node.path[0] === 'library' && node.kind === 'prompt')) {
    await newGroup(node);
    indexed.push(node);
  }
  const incomingNodes = nodes.filter(node => node.source === 'incoming' && node.path[0] === 'library' && node.kind === 'prompt');
  const choiceKeys = new Set(incomingNodes.map(node => node.sourceId ?? node.key));
  if (choiceKeys.size !== incomingNodes.length) throw new LibraryError('AMBIGUOUS_ID', 'Incoming choice keys are ambiguous.');
  for (const key of Object.keys(resolutions)) if (!choiceKeys.has(key)) throw new LibraryError('INVALID_RESOLUTIONS', 'A choice names an unavailable incoming prompt.');
  const replaced = new Set();
  for (const node of incomingNodes) {
    const entry = nodeByKey.get(node.key).data;
    const body = bodyFor(entry);
    const title = titleFor(entry);
    // Empty bodies are not duplicates. They remain preserved and reviewable.
    const exact = body ? indexed.filter(target => bodyFor(nodeByKey.get(target.key).data) === body) : [];
    const matches = exact.length ? exact : indexed.filter(target => {
      const other = nodeByKey.get(target.key).data;
      return (title && titleFor(other) === title) || (node.sourceId && node.sourceId === target.sourceId);
    });
    const resolutionKey = node.sourceId ?? node.key;
    const explicit = own(resolutions, resolutionKey);
    if (Object.hasOwn(resolutions, resolutionKey) && explicit == null) throw new LibraryError('INVALID_RESOLUTIONS', 'An explicit choice must name an action.');
    const first = exact[0];
    const choice = explicit ?? (first ? { action: 'skip', target: first.key } : matches.length ? null : { action: 'keep' });
    if (choice && (!record(choice) || !['keep', 'replace', 'skip'].includes(choice.action))) throw new LibraryError('INVALID_RESOLUTIONS', 'Unknown import choice.');
    let target = null;
    if (choice?.target != null || choice?.existingId != null) {
      target = matches.find(candidate => choice.target != null ? candidate.key === choice.target
        : candidate.sourceId === choice.existingId && candidate.source === (choice.targetSource ?? 'existing'));
      if (!target) throw new LibraryError('INVALID_RESOLUTIONS', 'Select a listed import target.');
    }
    if (choice?.action === 'replace' && !target) throw new LibraryError('INVALID_RESOLUTIONS', 'Replace requires a listed target.');
    if (choice?.action === 'keep' && target) throw new LibraryError('INVALID_RESOLUTIONS', 'Keep does not select a replacement target.');
    if (choice?.action === 'skip' && exact.length) target ??= first;
    const row = { member: node.key, kind: exact.length ? 'duplicate' : matches.length ? 'conflict' : 'new',
      matches: matches.map(match => match.key), choice: choice ? { action: choice.action, ...(target ? { target: target.key } : {}) } : null };
    rows.push(row);
    if (!choice) { indexed.push(node); continue; }
    if (choice.action === 'keep') {
      await newGroup(node);
    } else if (choice.action === 'replace' || (choice.action === 'skip' && exact.length)) {
      const group = groupByMember.get(target.key);
      if (!group) {
        row.choice = null;
        row.dependsOn = target.key;
        indexed.push(node);
        continue;
      }
      if (choice.action === 'replace') {
        if (replaced.has(group.id)) throw new LibraryError('INVALID_RESOLUTIONS', 'Choose only one replacement for each logical prompt.');
        replaced.add(group.id);
        group.selected = node.key;
      }
      group.members.push(node.key);
      groupByMember.set(node.key, group);
    }
    if (choice.action !== 'skip' || exact.length) indexed.push(node);
  }

  function reference(from, path, sourceId, kind, promptId) {
    if (sourceId == null || sourceId === '') return;
    if (typeof sourceId !== 'string') throw new LibraryError('INVALID_REFERENCE', `Invalid reference at ${keyFor(from.source, [...from.path, ...path])}.`);
    let target, reason;
    if (kind === 'version') {
      const prompt = index(from.source, 'prompts').get(promptId);
      target = prompt && index(from.source, prompt).get(sourceId);
      if (Array.isArray(target)) { target = null; reason = 'ambiguous-current-version'; }
    } else target = index(from.source, kind).get(sourceId);
    const targetNode = target && nodeByKey.get(target).node;
    const promptKey = targetNode?.kind === 'version' ? keyFor(targetNode.source, targetNode.path.slice(0, 2)) : target;
    const group = groupByMember.get(promptKey);
    if (!target) reason ??= 'missing-source-reference';
    else if (['prompt', 'version'].includes(targetNode.kind) && targetNode.path[0] === 'library' && !group) reason = 'prompt-not-selected';
    references.push({ from: from.key, path, sourceId, kind, target: target ?? null, groupId: group?.id ?? null, ...(reason ? { reason } : {}) });
  }
  for (const node of nodes) {
    const data = nodeByKey.get(node.key).data;
    if (['runs', 'testCases', 'evaluations', 'experiments', 'traceRuns'].includes(node.kind)) {
      reference(node, ['promptId'], data.promptId, 'prompts');
      reference(node, ['promptVersionId'], data.promptVersionId, 'version', data.promptId);
      reference(node, ['testCaseId'], data.testCaseId, 'testCases');
      reference(node, ['runId'], data.runId, 'runs');
    }
    if (['prompt', 'version'].includes(node.kind)) {
      reference(node, ['resultMeta', 'runId'], data.resultMeta?.runId, 'runs');
      reference(node, ['goldenResponse', 'pinnedFromRunId'], data.goldenResponse?.pinnedFromRunId, 'runs');
      const origin = data.metadata?.followUpOrigin;
      reference(node, ['metadata', 'followUpOrigin', 'sourcePromptId'], origin?.sourcePromptId, 'prompts');
      reference(node, ['metadata', 'followUpOrigin', 'sourcePromptVersionId'], origin?.sourcePromptVersionId, 'version', origin?.sourcePromptId);
      reference(node, ['metadata', 'followUpOrigin', 'sourceRunId'], origin?.sourceRunId, 'runs');
    }
    if (node.kind === 'pad') {
      reference(node, ['linkedPromptId'], data.linkedPromptId, 'prompts');
      if (data.linkedPrompts != null && !Array.isArray(data.linkedPrompts)) throw new LibraryError('INVALID_REFERENCE', 'Scratch links must be an array.');
      for (const [i, link] of (data.linkedPrompts ?? []).entries()) reference(node, ['linkedPrompts', i, 'id'], link?.id, 'prompts');
    }
  }
  const plan = { format: 'promptlab-import-plan', schemaVersion: 1, sources: sourceHashes, resolutions, nodes, groups, rows, references,
    unresolved: rows.filter(row => !row.choice).length,
    // Unknown domains remain in the source objects. This graph does not claim
    // their application-specific reference or activation rules are implemented.
    activationReady: false };
  return { ...plan, fingerprint: await hash(plan) };
}

export async function verifyImportPlan(plan, existing, incoming, resolutions = {}) {
  const expected = await planLosslessImport(existing, incoming, resolutions);
  if (canonical(plan) !== canonical(expected)) throw new LibraryError('IMPORT_PLAN_MISMATCH', 'Import source, choices or graph changed. Preview again.', 409);
  return expected;
}
