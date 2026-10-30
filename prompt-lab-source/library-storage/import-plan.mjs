import { assertWorkspace, canonical, hash, readObject, LibraryError } from './contract.mjs';
import { withRecordGroups } from './record-state.mjs';
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
  return planSources({ existing: structuredClone(existing), incoming: structuredClone(incoming) }, structuredClone(resolutions), { incomingSource: 'incoming' });
}

async function planSources(sources, resolutions, { incomingSource, initialGroups, repeatedSource = false }) {
  const nodes = [], groups = [], rows = [], references = [];
  const nodeByKey = new Map(), groupByMember = new Map();
  const matching = new Map();
  function matchingFor(key) {
    if (!matching.has(key)) {
      const value = nodeByKey.get(key).data;
      matching.set(key, { body: bodyFor(value), title: titleFor(value) });
    }
    return matching.get(key);
  }
  const indexes = new Map();
  const sourceHashes = {};
  for (const [source, workspace] of Object.entries(sources)) sourceHashes[source] = await hash(workspace);

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
    const node = { key, source, path, kind, sourceId: data.id ?? null, hash: await hash(data) };
    nodes.push(node);
    nodeByKey.set(key, { node, data });
    if (data.id) {
      const previous = ids.get(data.id);
      ids.set(data.id, previous ? [...(Array.isArray(previous) ? previous : [previous]), key] : key);
    }
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
          versions.set(data.currentVersionId, historical ? [key, ...(Array.isArray(historical) ? historical : [historical])] : key);
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
  if (initialGroups) {
    for (const original of initialGroups) {
      const group = structuredClone(original);
      const candidate = group.selected ?? group.retainedSelection;
      if (!group.members.includes(candidate) || group.members.some(key => !nodeByKey.has(key) || groupByMember.has(key)
        || nodeByKey.get(key).node.kind !== 'prompt' || nodeByKey.get(key).node.path[0] !== 'library')) throw new LibraryError('INVALID_IMPORT_STATE', 'Existing group members are unavailable or ambiguous.');
      groups.push(group);
      for (const key of group.members) groupByMember.set(key, group);
      indexed.push(nodeByKey.get(candidate).node);
    }
  } else {
    for (const node of nodes.filter(node => node.source !== incomingSource && node.path[0] === 'library' && node.kind === 'prompt')) {
      await newGroup(node);
      indexed.push(node);
    }
  }
  const incomingNodes = nodes.filter(node => node.source === incomingSource && node.path[0] === 'library' && node.kind === 'prompt');
  const nodeKeys = new Set(incomingNodes.map(node => node.key));
  const idCounts = new Map();
  for (const node of incomingNodes) if (node.sourceId) idCounts.set(node.sourceId, (idCounts.get(node.sourceId) ?? 0) + 1);
  const aliasesFor = node => [node.key, ...(node.sourceId && idCounts.get(node.sourceId) === 1 && !nodeKeys.has(node.sourceId) ? [node.sourceId] : [])];
  const choiceKeys = new Set(incomingNodes.flatMap(aliasesFor));
  for (const key of Object.keys(resolutions)) if (!choiceKeys.has(key)) throw new LibraryError('INVALID_RESOLUTIONS', 'A choice names an unavailable incoming prompt.');
  const replaced = new Set();
  for (const node of incomingNodes) {
    if (repeatedSource) {
      if (Object.keys(resolutions).length) throw new LibraryError('INVALID_RESOLUTIONS', 'This source was already imported. Reimport cannot change its earlier choices.');
      const group = groupByMember.get(node.key);
      const target = group?.selected ?? group?.retainedSelection;
      rows.push({ member: node.key, kind: 'duplicate', matches: group ? [target] : [], choice: { action: 'skip', ...(group ? { target } : {}) } });
      continue;
    }
    const { body, title } = matchingFor(node.key);
    // Empty bodies are not duplicates. They remain preserved and reviewable.
    const exact = body ? indexed.filter(target => matchingFor(target.key).body === body) : [];
    const matches = exact.length ? exact : indexed.filter(target => {
      const aliases = groupByMember.get(target.key)?.members ?? [target.key];
      return (title && matchingFor(target.key).title === title) || (node.sourceId && aliases.some(key => nodeByKey.get(key).node.sourceId === node.sourceId));
    });
    const supplied = aliasesFor(node).filter(key => Object.hasOwn(resolutions, key));
    if (supplied.length > 1) throw new LibraryError('INVALID_RESOLUTIONS', 'Supply only one choice for each incoming source record.');
    const explicit = supplied.length ? own(resolutions, supplied[0]) : undefined;
    if (supplied.length && explicit == null) throw new LibraryError('INVALID_RESOLUTIONS', 'An explicit choice must name an action.');
    const first = exact[0];
    const choice = explicit ?? (first ? { action: 'skip', target: first.key } : matches.length ? null : { action: 'keep' });
    if (choice && (!record(choice) || !['keep', 'replace', 'skip'].includes(choice.action))) throw new LibraryError('INVALID_RESOLUTIONS', 'Unknown import choice.');
    let target = null;
    if (choice?.target != null || choice?.existingId != null) {
      const candidates = matches.filter(candidate => choice.target != null ? candidate.key === choice.target
        : candidate.sourceId === choice.existingId && (choice.targetSource ? candidate.source === choice.targetSource : candidate.source !== incomingSource));
      if (candidates.length > 1) throw new LibraryError('INVALID_RESOLUTIONS', 'The target ID is ambiguous. Select a source-scoped target.');
      target = candidates[0];
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
        delete group.retainedSelection;
        delete group.inactiveReason;
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
      if (Array.isArray(prompt)) reason = 'ambiguous-source-reference';
      else {
        target = prompt && index(from.source, prompt).get(sourceId);
        if (Array.isArray(target)) { reason = target.includes(prompt) ? 'ambiguous-current-version' : 'ambiguous-source-reference'; target = null; }
      }
    } else target = index(from.source, kind).get(sourceId);
    if (Array.isArray(target)) { target = null; reason = 'ambiguous-source-reference'; }
    const targetNode = target && nodeByKey.get(target).node;
    const promptKey = targetNode?.kind === 'version' ? keyFor(targetNode.source, targetNode.path.slice(0, 2)) : target;
    const group = groupByMember.get(promptKey);
    if (!target) reason ??= 'missing-source-reference';
    else if (['prompt', 'version'].includes(targetNode.kind) && targetNode.path[0] === 'library' && !group) reason = 'prompt-not-selected';
    else if (group?.selected === null) reason = 'prompt-not-selected';
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

/** Build the complete library state, retaining all raw object pairs from ancestry. */
export async function planLibraryImport({ base = null, baseRevision = null, incoming, objects, resolutions = {}, sourceBindings = [], derivedSources = [], enforceDeletions = false, current, currentView }) {
  if (!record(resolutions)) throw new LibraryError('INVALID_RESOLUTIONS', 'Import choices must be an object.');
  canonical(resolutions);
  resolutions = structuredClone(resolutions);
  base = structuredClone(base);
  incoming = structuredClone(incoming);
  const sources = [...(base?.sources ?? [])];
  if (!sources.some(item => canonical(item) === canonical(incoming))) sources.push(incoming);
  const workspaces = {};
  for (const item of sources) {
    const workspace = await readObject(objects, item.workspace, 'workspace');
    assertWorkspace(workspace);
    const sourceText = await readObject(objects, item.source, 'source');
    let decoded;
    try { decoded = JSON.parse(sourceText); } catch { throw new LibraryError('INVALID_JSON', 'Archived import source is not valid JSON.'); }
    if (typeof sourceText !== 'string' || canonical(decoded) !== canonical(workspace)) throw new LibraryError('SOURCE_MISMATCH', 'Archived import source and workspace disagree.');
    workspaces[item.workspace] = workspace;
  }
  const repeatedSource = Boolean(base?.sources.some(item => item.workspace === incoming.workspace));
  // A snapshot base has no groups yet. Index every original prompt as an
  // existing group before treating an identical first import as a no-op.
  const initial = repeatedSource && !base?.groups
    ? await planSources(workspaces, {}, { incomingSource: null }) : null;
  const review = await planSources(workspaces, resolutions, { incomingSource: incoming.workspace, initialGroups: base?.groups ?? initial?.groups, repeatedSource });
  let manifest = { format: 'promptlab-library-state', schemaVersion: 1, sources, nodes: review.nodes, groups: review.groups, references: review.references };
  manifest = withRecordGroups(manifest, base?.recordGroups);
  let deletionReview;
  if (enforceDeletions || base?.deletionPolicy) {
    const { applyDeletionPolicy } = await import('./selection-policy.mjs');
    ({ manifest, ...deletionReview } = await applyDeletionPolicy(manifest, objects, sourceBindings, derivedSources));
  }
  let appView;
  if (currentView !== undefined) {
    const { planImportedCurrentView } = await import('./import-current-view.mjs');
    appView = await planImportedCurrentView({ current, manifest, baseRevision, objects, sourceBindings, derivedSources, incoming, currentView });
  }
  const plan = { format: 'promptlab-library-import-plan', schemaVersion: 1, baseRevision, incoming, resolutions,
    sources: review.sources, rows: review.rows, unresolved: review.unresolved + (deletionReview?.blocked.length ?? 0) + (appView?.unresolved ?? 0), manifest, activationReady: false,
    ...(deletionReview ? { deletionReview } : {}),
    ...(appView ? { currentView: structuredClone(currentView), currentViewPlan: appView.currentViewPlan, recordReview: appView.recordReview } : {}) };
  return { ...plan, fingerprint: await hash(plan) };
}

/** Rebuild references over retained sources without choosing or importing rows. */
export async function buildLibrarySelection({ sources, groups, recordGroups, objects }) {
  const workspaces = {};
  for (const source of sources) {
    const workspace = await readObject(objects, source.workspace, 'workspace');
    assertWorkspace(workspace);
    const text = await readObject(objects, source.source, 'source');
    let decoded;
    try { decoded = JSON.parse(text); } catch { throw new LibraryError('INVALID_JSON', 'Archived selection source is invalid.'); }
    if (typeof text !== 'string' || canonical(decoded) !== canonical(workspace)) throw new LibraryError('SOURCE_MISMATCH', 'Archived selection source differs.');
    workspaces[source.workspace] = workspace;
  }
  const review = await planSources(workspaces, {}, { incomingSource: null, initialGroups: groups });
  return withRecordGroups({ format: 'promptlab-library-state', schemaVersion: 1, sources: structuredClone(sources), nodes: review.nodes, groups: review.groups, references: review.references }, recordGroups);
}
