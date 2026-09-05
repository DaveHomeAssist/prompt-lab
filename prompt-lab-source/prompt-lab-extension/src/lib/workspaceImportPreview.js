import { normalizeLibrary } from './promptSchema.js';
import { getLibraryEntryCanonicalBody, normalizePromptText } from './libraryMatching.js';
import { prepareWorkspaceImport } from './workspaceImport.js';

function incomingRows(parsed) {
  return Array.isArray(parsed) ? parsed : parsed?.library || parsed?.prompts || parsed?.presets || parsed?.entries || [];
}

/** Normalize once so generated source/version IDs survive choices and retries. */
export function normalizeWorkspaceImportSource(parsed) {
  if (!parsed || typeof parsed !== 'object') throw new Error('Expected a workspace object or prompt array.');
  const rows = incomingRows(parsed);
  if (!Array.isArray(rows)) throw new Error('The prompt list must be an array.');
  const invalid = rows.flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [index + 1];
    const body = entry.enhanced || entry.original || entry.prompt || entry.content;
    return typeof body === 'string' && body.trim() ? [] : [index + 1];
  });
  if (invalid.length) throw new Error(`Invalid prompt entries: ${invalid.join(', ')}. Each requires nonempty text.`);
  const ids = rows.map(entry => entry.id).filter(id => id != null && id !== '');
  if (ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length) throw new Error('Prompt IDs must be unique nonempty strings when present.');
  const library = normalizeLibrary(rows.map(entry => ({
    ...entry,
    original: entry.original || entry.prompt || entry.content || entry.enhanced,
    enhanced: entry.enhanced || entry.prompt || entry.content || entry.original,
  })));
  // Older schema-2 exports represented an absent pack registry as an empty array.
  const legacyEmptyPacks = parsed.product === 'Prompt Lab' && parsed.schemaVersion === 2
    && Array.isArray(parsed.packs) && parsed.packs.length === 0;
  const source = { ...(Array.isArray(parsed) ? {} : parsed), library };
  // This legacy value meant no registry was exported, not a request to clear
  // authored destination packs (including packs with no prompt members).
  if (legacyEmptyPacks) delete source.packs;
  return source;
}

export function workspaceImportRevision(context) {
  return JSON.stringify({
    library: context.library, trash: context.trash, collections: context.collections,
    generation: context.generation, deletedIds: [...context.deletedIds].sort(),
    runs: context.runs, testCases: context.testCases,
    scratch: context.scratch, packs: context.packs,
  });
}

export function buildWorkspaceImportPreview(source, context, resolutions = {}) {
  const rows = [];
  const byBody = new Map();
  const byTitle = new Map();
  const byId = new Map();
  const uniqueTargets = entries => [...new Map(entries.map(entry => [JSON.stringify([entry.targetSource, entry.id]), entry])).values()];
  const indexEntry = (record, targetSource) => {
    const entry = { ...record, targetSource };
    const body = getLibraryEntryCanonicalBody(entry);
    const title = normalizePromptText(entry.title).toLowerCase();
    if (!byBody.has(body)) byBody.set(body, []);
    if (!byTitle.has(title)) byTitle.set(title, []);
    byBody.get(body).push(entry);
    byTitle.get(title).push(entry);
    if (!byId.has(entry.id)) byId.set(entry.id, []);
    byId.get(entry.id).push(entry);
  };
  context.library.forEach(entry => indexEntry(entry, 'existing'));
  const effective = {};
  for (const entry of source.library) {
    const exact = uniqueTargets(byBody.get(getLibraryEntryCanonicalBody(entry)) || []);
    const conflicts = exact.length ? exact : uniqueTargets([
      ...(byTitle.get(normalizePromptText(entry.title).toLowerCase()) || []),
      ...(byId.get(entry.id) || []),
    ]);
    const choice = resolutions[entry.id] || (exact.length ? { action: 'skip', existingId: exact[0].id } : conflicts.length ? null : { action: 'keep' });
    if (choice && !['keep', 'replace', 'skip'].includes(choice.action)) throw new Error('Unknown import conflict choice.');
    if (choice?.action === 'replace' && !conflicts.some(target => target.id === choice.existingId && target.targetSource === (choice.targetSource || 'existing'))) throw new Error('Select a listed replacement target.');
    rows.push({ entry, kind: exact.length ? 'duplicate' : conflicts.length ? 'conflict' : 'new', conflicts, choice });
    if (choice) effective[entry.id] = choice;
    if (choice?.action !== 'skip' || exact.length) indexEntry(entry, 'incoming');
  }
  const unresolved = rows.filter(row => !row.choice).length;
  let plan = null;
  let error = '';
  try {
    // Validate related records even while prompt choices are unresolved.
    plan = prepareWorkspaceImport(source, { ...context, resolutions: effective });
  } catch (caught) { error = caught.message; }
  const hasExtras = ['trash', 'collections', 'packs', 'scratch', 'runs', 'testCases'].some(key => source[key] != null);
  if (!source.library.length && !hasExtras) error = 'No valid prompts or workspace data found.';
  return { source, context, resolutions: effective, rows, unresolved, plan, error, revision: workspaceImportRevision(context) };
}
