import { canonical } from '../../../library-storage/contract.mjs';
import { validateChangedFields } from '../../../library-storage/edit-plan.mjs';
import { APP_RECORD_VERSION } from './appRecordVersion.js';
import { detectDuplicates } from './presetMatching.js';

const object = value => value && Object.getPrototypeOf(value) === Object.prototype;
const identity = value => typeof value === 'string' && value.trim() && value.length <= 200;

export function reviewRepositoryPack(sourceText, view, newId, fileName = 'Selected pack') {
  if (typeof sourceText !== 'string' || !sourceText.length || sourceText.length > 20_000_000) throw new Error('Choose a pack smaller than 20 MB.');
  const pack = JSON.parse(sourceText); canonical(pack);
  if (!object(pack) || pack.type !== 'prompt-pack' || !identity(pack.id) || typeof pack.title !== 'string' || !pack.title.trim()
    || typeof pack.version !== 'string' || !pack.version.trim() || !Array.isArray(pack.presets) || pack.presets.length > 1000
    || pack.presets.some(row => !object(row) || !identity(row.id))) {
    throw new Error('Choose a prompt-pack with a title, version and stable preset identities. Workspace imports require their own complete review.');
  }
  const used = new Set([...view.library, ...view.trash].map(row => row.id));
  const rows = pack.presets.map((preset, index) => {
    const rowId = `pack-preset-${index}`, matches = detectDuplicates([{ ...preset, id: rowId }], view.library);
    const targets = new Map(matches.map(match => [match.b.id, match.b]));
    for (const entry of view.library) if (entry.id === preset.id) targets.set(entry.id, { id: entry.id, title: entry.title || entry.id });
    const conflicts = [...targets.values()].map(row => ({ ...row, targetSource: 'existing' }));
    const duplicate = matches.some(match => match.reason === 'prompt-exact-match');
    const promptId = newId();
    if (!identity(promptId) || used.has(promptId)) throw new Error('Could not reserve distinct prompt identities. Review this pack again.');
    used.add(promptId);
    return { index, promptId, entry: { id: rowId, title: typeof preset.title === 'string' ? preset.title : preset.id,
      enhanced: typeof preset.enhanced === 'string' ? preset.enhanced : typeof preset.original === 'string' ? preset.original : typeof preset.prompt === 'string' ? preset.prompt : '' },
    conflicts, kind: duplicate ? 'duplicate' : conflicts.length ? 'conflict' : 'new',
    choice: duplicate ? { action: 'skip' } : conflicts.length ? null : { action: 'keep' } };
  });
  return { sourceText, packId: pack.id, expectedRevision: view.revision, fileName, rows,
    versions: new Map(view.library.map(row => [row.id, { ...row[APP_RECORD_VERSION] }])),
    error: '', locked: false, hidden: false, pending: null };
}

export function packImportPresentation(review) {
  const rows = structuredClone(review.rows), replacements = rows.filter(row => row.choice?.action === 'replace');
  const duplicateTarget = new Set(replacements.map(row => row.choice.existingId)).size !== replacements.length;
  return { mode: 'pack', fileName: review.fileName, rows, allowChoices: true,
    unresolved: rows.filter(row => !row.choice).length,
    error: review.error || (duplicateTarget ? 'Choose only one replacement for each existing prompt.' : ''),
    partial: review.locked, atomic: true, completedStages: [],
    destination: 'the selected Library',
    plan: { importedCount: rows.filter(row => row.choice?.action === 'keep').length,
      replacedCount: replacements.length, skippedCount: rows.filter(row => row.choice?.action === 'skip').length,
      runs: [], testCases: [], trash: [], warnings: [] } };
}

export function choosePackImport(review, id, choice) {
  if (review.locked) throw new Error('Retry the retained import before changing its choices.');
  const row = review.rows.find(row => row.entry.id === id);
  if (!row || !['keep', 'replace', 'skip'].includes(choice?.action)) throw new Error('Choose an available import action.');
  if (choice.action === 'replace' && (choice.targetSource !== undefined && choice.targetSource !== 'existing'
    || !row.conflicts.some(target => target.id === choice.existingId))) throw new Error('Choose a reviewed replacement target.');
  row.choice = choice.action === 'replace' ? { action: 'replace', existingId: choice.existingId, targetSource: 'existing' } : { action: choice.action };
  delete review.command;
  review.error = '';
}

export function packImportCommand(review) {
  const preview = packImportPresentation(review);
  if (preview.unresolved || preview.error) throw new Error(preview.error || 'Choose an action for every conflicting preset.');
  const pack = JSON.parse(review.sourceText);
  for (const row of review.rows.filter(row => row.choice.action !== 'skip')) {
    const preset = pack.presets[row.index];
    validateChangedFields(preset, Object.keys(preset).map(key => ({ path: [key] })), 'INVALID_PACK_SOURCE');
    if (preset.versions !== undefined && (!Array.isArray(preset.versions) || preset.versions.some(value => !object(value)))) {
      throw new Error('Repair this preset history, or skip it to retain its original source without installing it.');
    }
  }
  return { action: 'install', packId: review.packId, sourceText: review.sourceText, folderPolicy: 'preserve-paths',
    choices: review.rows.map(row => row.choice.action === 'keep' ? { index: row.index, action: 'add', promptId: row.promptId }
      : row.choice.action === 'skip' ? { index: row.index, action: 'skip' }
        : { index: row.index, action: 'replace', groupId: review.versions.get(row.choice.existingId).groupId,
          expectedRecordHash: review.versions.get(row.choice.existingId).valueHash }) };
}
