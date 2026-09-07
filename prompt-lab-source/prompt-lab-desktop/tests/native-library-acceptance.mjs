import assert from 'node:assert/strict';

// Synthetic records are added to the disposable native profile. Existing
// lifecycle and follow-up records remain intact for restart/reinstall checks.
const ids = ['native-library-alpha', 'native-library-hidden', 'native-library-beta'];
const collection = 'Native acceptance collection';

export async function checkLibraryPersisted({ readLibrary, execute, click, fill, waitFor, screenshot }, expected) {
  const library = await readLibrary();
  assert.deepEqual(library.map(row => row.id), expected.order, 'Native Library manual order survives restart');
  for (const entry of expected.entries) {
    const actual = library.find(row => row.id === entry.id);
    assert.ok(actual, `Retained native Library fixture ${entry.id}`);
    for (const key of ['title', 'original', 'enhanced', 'collection']) assert.equal(actual[key], entry[key]);
    assert.deepEqual(actual.tags, entry.tags);
    assert.deepEqual(actual.metadata, entry.metadata);
  }
  assert.ok(!library.some(row => row.collection === collection), 'Deleted collection assignments stay cleared');
  assert.ok(!(await execute('return JSON.parse(localStorage.getItem("pl2-collections") || "[]");')).includes(collection));
  await click('[data-testid="nav-library"]');
  await fill('[data-testid="library-search"]', 'Native matrix');
  await waitFor(() => execute('return document.querySelector(`[aria-label="Saved prompts"]`)?.firstElementChild?.innerText.includes("Native matrix Beta");'), 'native filtered manual order visible after restart');
  assert.equal(await execute('return getComputedStyle(document.querySelector(`[aria-label="Sort prompts"]`)).colorScheme;'), 'dark');
  await click('[aria-label="Switch to light mode"]');
  assert.equal(await execute('return getComputedStyle(document.querySelector(`[aria-label="Sort prompts"]`)).colorScheme;'), 'light');
  assert.equal(await execute('return getComputedStyle(document.querySelector(`button[aria-label="Settings"]`)).appearance;'), 'none');
  assert.equal(await execute('return getComputedStyle(document.querySelector(`button[aria-label="Settings"]`)).getPropertyValue("-webkit-appearance");'), 'none');
  await screenshot('library-light-controls');
  await click('[aria-label="Switch to dark mode"]');
  assert.equal(await execute('return getComputedStyle(document.querySelector(`[aria-label="Sort prompts"]`)).colorScheme;'), 'dark');
  assert.equal(await execute('return getComputedStyle(document.querySelector(`button[aria-label="Settings"]`)).appearance;'), 'none');
  assert.equal(await execute('return getComputedStyle(document.querySelector(`button[aria-label="Settings"]`)).getPropertyValue("-webkit-appearance");'), 'none');
  await screenshot('library-restored');
}

export async function exerciseLibrary(api) {
  const { execute, click, fill, waitFor, readLibrary, closeSession, openSession, screenshot, checkpoint } = api;
  const baseline = await readLibrary();
  assert.ok(!baseline.some(row => ids.includes(row.id)), 'Library acceptance fixtures must be new');
  const prompt = (id, title, assigned, metadata = {}) => ({ id, title, original: `${title} instructions`, enhanced: `${title} improved`, collection: assigned, tags: ['native-matrix'], createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z', metadata });
  const fixtures = [
    prompt(ids[0], 'Native matrix Alpha', collection, { owner: 'Avery', purpose: 'Navigation' }),
    prompt(ids[1], 'Native matrix Hidden', ''),
    prompt(ids[2], 'Native matrix Beta', collection, { packLoadedAt: new Date(Date.now() + 60_000).toISOString() }),
  ];
  await execute(`
    localStorage.setItem('pl2-library', JSON.stringify(arguments[0]));
    const collections = JSON.parse(localStorage.getItem('pl2-collections') || '[]');
    localStorage.setItem('pl2-collections', JSON.stringify([...new Set([...collections, arguments[1]])]));
    localStorage.setItem('pl2-billing', JSON.stringify({plan:'pro',status:'active',productName:'Prompt Lab Pro'}));
    window.dispatchEvent(new StorageEvent('storage', {key:'pl2-library', storageArea:localStorage}));
    return true;`, [[...fixtures, ...baseline], collection]);
  // Adopt the synthetic external write before a pending persistence effect
  // can overwrite the fixture with the mounted store's previous state.
  await click('[data-testid="nav-library"]');
  await fill('[data-testid="library-search"]', 'Native matrix');
  await waitFor(() => execute('return document.querySelector(`[aria-label="Saved prompts"]`)?.innerText.includes("Native matrix Beta");'), 'native Library fixture adopted before restart');
  await waitFor(async () => {
    const rows = await readLibrary();
    return ids.every(id => rows.find(row => row.id === id)?.metadata?.libraryGeneration !== undefined);
  }, 'native Library normalized fixture persistence');
  const seeded = await readLibrary();
  for (const fixture of fixtures) {
    const actual = seeded.find(row => row.id === fixture.id);
    assert.ok(actual, 'Native Library fixture acknowledged before restart');
    for (const key of ['title', 'original', 'enhanced', 'collection']) assert.equal(actual[key], fixture[key]);
    for (const [key, value] of Object.entries(fixture.metadata)) assert.deepEqual(actual.metadata[key], value);
  }
  await checkpoint('synthetic Library matrix acknowledged before native restart');
  // Restart, rather than mutating React state, to hydrate the real native store.
  await closeSession();
  await openSession();
  await click('[data-testid="nav-library"]');
  await fill('[data-testid="library-search"]', 'Native matrix');
  await waitFor(() => execute('return document.querySelector(`[aria-label="Saved prompts"]`)?.firstElementChild?.innerText.includes("Native matrix Beta");'), 'newly loaded old starter sorts first');
  await fill('[data-testid="library-search"]', 'avery navigation');
  await waitFor(() => execute(`const list = document.querySelector('[aria-label="Saved prompts"]'); return list?.children.length === 1 && list.innerText.includes('Native matrix Alpha');`), 'native Library metadata search');
  await click('//*[@role="tablist" and @aria-label="Create views"]//button[normalize-space(.)="Compose"] | //nav[@aria-label="Primary mobile navigation"]//button[normalize-space(.)="Compose"]', 'xpath');
  if (await execute('return Boolean(document.querySelector(`[aria-label="Composer views"]`));')) {
    await click('//*[@role="tablist" and @aria-label="Composer views"]//button[contains(.,"Library")]', 'xpath');
  }
  await fill('[aria-label="Filter composer library"]:not(.hidden *)', 'avery navigation');
  await waitFor(() => execute(`const input = [...document.querySelectorAll('[aria-label="Filter composer library"]')].find(node => node.getClientRects().length); const panel = input?.parentElement?.parentElement?.parentElement; return panel?.innerText.includes('Native matrix Alpha') && !panel.innerText.includes('Native matrix Beta');`), 'native Composer uses the same metadata matcher');
  await click('[data-testid="nav-library"]');
  await fill('[data-testid="library-search"]', '');
  await click('//button[starts-with(normalize-space(.),"Native acceptance collection")]', 'xpath');
  await click('[aria-label="Sort prompts"]');
  await click('[aria-label="Sort prompts"] option[value="manual"]');
  const beforeMove = await readLibrary();
  const alphaIndex = beforeMove.findIndex(row => row.id === ids[0]);
  assert.ok(alphaIndex >= 0 && beforeMove.findIndex(row => row.id === ids[2]) > alphaIndex, 'Beta starts after Alpha in the filtered collection');
  await click('[aria-label="Move Native matrix Beta up"]');
  await waitFor(async () => (await readLibrary())[alphaIndex]?.id === ids[2], 'filtered manual move persisted');
  assert.deepEqual((await readLibrary()).filter(row => !ids.includes(row.id)).map(row => row.id), baseline.map(row => row.id), 'Hidden existing records retain relative order');
  await click('[aria-label="Manage collections"]');
  await click('[aria-label="Delete collection Native acceptance collection"]');
  await waitFor(async () => !(await readLibrary()).some(row => row.collection === collection), 'collection deletion unassigns native prompts');
  await waitFor(() => execute(`return [...document.querySelectorAll('button[aria-current="page"]')].some(node => node.innerText.startsWith('All prompts'));`), 'active collection filter resets');
  const current = await readLibrary();
  assert.equal(current.length, baseline.length + fixtures.length, 'Collection deletion preserves every prompt');
  const expected = { order: current.map(row => row.id), entries: current.filter(row => ids.includes(row.id)) };
  await screenshot('library-matrix');
  await closeSession();
  await openSession();
  await checkLibraryPersisted(api, expected);
  await checkpoint('native Library/Composer search, starter ordering, filtered reorder and collection deletion persist after full restart');
  return expected;
}
