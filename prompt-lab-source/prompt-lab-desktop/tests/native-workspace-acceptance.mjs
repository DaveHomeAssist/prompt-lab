import assert from 'node:assert/strict';

const runId = 'native-import-run';
const caseId = 'native-import-case';
const childId = 'native-import-child';

async function storedHistory(executeAsync) {
  const result = await executeAsync(`
    const done = arguments[arguments.length - 1];
    const request = indexedDB.open('prompt_lab_local', 4);
    request.onerror = () => done({error: String(request.error)});
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(['eval_runs', 'test_cases'], 'readonly');
      const runs = tx.objectStore('eval_runs').getAll();
      const cases = tx.objectStore('test_cases').getAll();
      tx.oncomplete = () => { db.close(); done({runs: runs.result, cases: cases.result}); };
      tx.onabort = () => { db.close(); done({error: String(tx.error)}); };
    };`);
  assert.ok(!result.error, result.error);
  return result;
}

export async function checkWorkspacePersisted(api, expected) {
  const library = await api.readLibrary();
  const history = await storedHistory(api.executeAsync);
  const target = library.find(row => row.id === expected.targetId);
  assert.equal(target?.enhanced, 'Native imported replacement body');
  assert.ok(target.versions.some(version => version.enhanced === expected.previousBody), 'Replacement keeps its previous version');
  const run = history.runs.find(row => row.id === runId);
  assert.equal(run?.promptId, target.id);
  assert.equal(run.promptVersionId, target.currentVersionId);
  assert.equal(run.testCaseId, caseId);
  assert.equal(history.cases.find(row => row.id === caseId)?.promptId, target.id);
  const duplicateRun = history.runs.find(row => row.id === 'native-import-duplicate-run');
  assert.equal(duplicateRun?.promptId, expected.parent.id);
  assert.equal(duplicateRun.promptVersionId, expected.parent.currentVersionId);
  const child = library.find(row => row.id === childId);
  assert.equal(child?.metadata?.followUpOrigin?.sourcePromptId, target.id);
  assert.equal(child.metadata.followUpOrigin.sourceRunId, runId);
  assert.equal(child.metadata.followUpOrigin.sourcePromptVersionId, target.currentVersionId);
  assert.equal(library.filter(row => row.id === expected.keepId).length, 1);
  assert.deepEqual(library.find(row => row.id === expected.parent.id), expected.parent, 'Duplicate reuse and Keep both do not overwrite the lifecycle parent');
  assert.equal(library.length, expected.count);
  assert.deepEqual(await api.execute('return JSON.parse(localStorage.getItem("pl2-packs"));'), expected.packs, 'Legacy empty packs do not erase authored destination packs');
  return { library, history };
}

export async function exerciseWorkspace(api, parentId) {
  const { execute, executeAsync, readLibrary, click, waitFor, uploadJson, screenshot, closeSession, openSession, checkpoint } = api;
  const baseline = await readLibrary();
  const parent = baseline.find(row => row.id === parentId);
  const target = baseline.find(row => row.id === 'native-library-alpha');
  assert.ok(parent?.currentVersionId && target, 'Lifecycle parent and Library matrix target exist');
  assert.ok(!baseline.some(row => row.id === childId));
  const historyBefore = await storedHistory(executeAsync);
  const packs = await execute(`
    const packs = JSON.parse(localStorage.getItem('pl2-packs') || '{}');
    packs['native-import-authored'] = {id:'native-import-authored',title:'Native authored pack',version:'1.0.0',source:'authored'};
    localStorage.setItem('pl2-packs', JSON.stringify(packs)); return packs;`);
  const incoming = {
    product: 'Prompt Lab',
    schemaVersion: 2,
    packs: [],
    library: [
      { ...parent, id: 'native-import-duplicate', title: 'Native duplicate alias', original: parent.original, enhanced: parent.enhanced, currentVersionId: 'duplicate-version' },
      { id: 'native-import-replacement', title: target.title, original: 'Native imported replacement body', enhanced: 'Native imported replacement body', currentVersionId: 'incoming-version' },
      { id: 'native-import-keep', title: parent.title, original: 'Native Keep both body', enhanced: 'Native Keep both body' },
      { id: childId, title: 'Native imported child', original: 'Native child body', enhanced: 'Native child body', metadata: { followUpOrigin: { sourceKind: 'run-output', sourcePromptId: 'native-import-replacement', sourcePromptVersionId: 'incoming-version', sourceRunId: runId, generationProvider: 'ollama', generationModel: 'promptlab-fixture' } } },
    ],
    runs: [
      { id: runId, promptId: 'native-import-replacement', promptVersionId: 'incoming-version', testCaseId: caseId, output: 'Native imported historical output', status: 'success' },
      { id: 'native-import-duplicate-run', promptId: 'native-import-duplicate', promptVersionId: 'duplicate-version', output: 'Native duplicate historical output', status: 'success' },
    ],
    testCases: [{ id: caseId, promptId: 'native-import-replacement', input: 'Native imported case' }],
  };
  await click('[data-testid="nav-library"]');
  await uploadJson('[aria-label="Import Prompt Lab workspace"]', incoming);
  await waitFor(() => execute('return Boolean(document.querySelector("[role=dialog][aria-labelledby=workspace-import-title]"));'), 'native import preview');
  await click('//*[@role="dialog"]//button[normalize-space(.)="Cancel"]', 'xpath');
  assert.deepEqual(await readLibrary(), baseline, 'Cancel performs no Library writes');
  assert.deepEqual(await storedHistory(executeAsync), historyBefore, 'Cancel performs no history/test-case writes');
  await uploadJson('[aria-label="Import Prompt Lab workspace"]', incoming);
  for (const [title, action] of [[target.title, 'replace'], [parent.title, 'keep']]) {
    const selector = `[aria-label="Conflict action for ${title}"]`;
    await click(selector);
    await click(`${selector} option[value="${action}"]`);
  }
  await click('//*[@role="dialog"]//button[normalize-space(.)="Apply import"]', 'xpath');
  await waitFor(async () => (await readLibrary()).some(row => row.id === childId), 'native file import applied');
  await waitFor(() => execute('return !document.querySelector("[role=dialog][aria-labelledby=workspace-import-title]");'), 'native import completed');
  const imported = await readLibrary();
  const kept = imported.find(row => row.enhanced === 'Native Keep both body');
  assert.ok(kept && kept.id !== parent.id);
  const expected = { targetId: target.id, previousBody: target.enhanced, keepId: kept.id, parent, packs, count: baseline.length + 2 };
  await checkWorkspacePersisted(api, expected);
  await screenshot('workspace-import');

  // Observe the actual export blob without replacing the exporter or stopping
  // its normal download. The adapter also verifies the completed file below.
  await execute(`
    const original = URL.createObjectURL;
    window.__nativeExport = null;
    URL.createObjectURL = function(blob) {
      if (blob.type === 'application/json') blob.text().then(text => { window.__nativeExport = JSON.parse(text); });
      return original.call(this, blob);
    }; return true;`);
  const verifyDownload = await api.prepareDownload();
  await click('button[aria-label="Settings"]');
  await click('//button[normalize-space(.)="Export Library"]', 'xpath');
  const exported = await waitFor(() => execute('return window.__nativeExport;'), 'native workspace export serialized');
  assert.equal(exported.schemaVersion, 2);
  assert.deepEqual(exported.packs, packs);
  assert.equal(exported.library.length, expected.count);
  assert.equal(exported.runs.find(row => row.id === runId)?.promptId, target.id);
  assert.equal(exported.runs.find(row => row.id === 'native-import-duplicate-run')?.promptId, parent.id);
  assert.equal(exported.testCases.find(row => row.id === caseId)?.promptId, target.id);
  assert.equal(exported.library.find(row => row.id === childId)?.metadata?.followUpOrigin?.sourcePromptId, target.id);
  await verifyDownload(exported);
  await click('[aria-label="Close settings"]');
  await closeSession();
  await openSession();
  await checkWorkspacePersisted(api, expected);
  await checkpoint('native file preview cancel, Skip/Replace/Keep both, associated history/provenance, completed export download and restart passed');
  return expected;
}
