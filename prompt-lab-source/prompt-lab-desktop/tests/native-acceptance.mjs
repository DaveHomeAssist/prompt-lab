import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createDesktopFixtureServer } from '../../scripts/desktop-fixture-server.mjs';

// Runs only on disposable CI runners, against an installed application binary.
assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Use the operator checklist outside disposable CI.');
const application = process.env.PL_NATIVE_APP;
assert.ok(application && path.isAbsolute(application), 'PL_NATIVE_APP must identify the installed binary.');
const phase = process.env.PL_NATIVE_PHASE || 'exercise';
assert.ok(['exercise', 'retention'].includes(phase));
const evidenceDir = path.resolve(process.env.PL_NATIVE_EVIDENCE || 'native-evidence');
await mkdir(evidenceDir, { recursive: true });
const evidence = { application, phase, platform: process.platform, sha: process.env.GITHUB_SHA, checks: [] };
const driver = spawn('tauri-driver', ['--port', '4444'], { stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
let driverOutput = '';
let driverError;
driver.on('error', error => { driverError = error; });
for (const stream of [driver.stdout, driver.stderr]) stream.on('data', chunk => { driverOutput = (driverOutput + chunk).slice(-32_000); });
let session;
let fixture;
const events = [];

async function command(method, route, body) {
  evidence.lastCommand = `${method} ${route}`;
  const response = await fetch(`http://127.0.0.1:4444${route}`, {
    method, headers: { 'Content-Type': 'application/json' },
    // Cold WebView2 startup can exceed an ordinary command's deadline. Allow
    // the native driver to return its session-creation diagnostic first.
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(method === 'POST' && route === '/session' ? 120_000 : 30_000),
  });
  const result = await response.json();
  if (!response.ok || result.value?.error) throw new Error(`${route}: ${result.value?.error || response.status} ${result.value?.message || ''}`);
  return result.value;
}
async function waitFor(probe, label, timeout = 20_000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    if (driverError) throw driverError;
    try { const result = await probe(); if (result) return result; } catch (error) { last = error; }
    await delay(200);
  }
  throw new Error(`Timed out: ${label}${last ? ` (${last.message})` : ''}`);
}
const execute = script => command('POST', `/session/${session}/execute/sync`, { script, args: [] });
const readLibrary = () => execute('return JSON.parse(localStorage.getItem("pl2-library") || "[]");');
async function element(value, using = 'css selector') {
  const result = await waitFor(() => command('POST', `/session/${session}/element`, { using, value }), value);
  return result['element-6066-11e4-a52e-4f735466cecf'] || result.ELEMENT;
}
async function click(selector, using) {
  const id = await element(selector, using);
  await command('POST', `/session/${session}/element/${id}/click`, {});
}
async function fill(selector, text) {
  const id = await element(selector);
  await command('POST', `/session/${session}/element/${id}/clear`, {});
  await command('POST', `/session/${session}/element/${id}/value`, { text });
}
async function screenshot(name) {
  const data = await command('GET', `/session/${session}/screenshot`);
  await writeFile(path.join(evidenceDir, `${phase}-${name}.png`), Buffer.from(data, 'base64'));
}
async function openSession() {
  const result = await command('POST', '/session', { capabilities: { alwaysMatch: { 'tauri:options': { application } } } });
  session = result.sessionId;
  assert.ok(session, 'Native session created');
  await command('POST', `/session/${session}/window/rect`, { width: 1180, height: 900 });
  await waitFor(() => execute(`return Boolean(window.__TAURI_INTERNALS__ && document.querySelector('[role="tablist"][aria-label="Primary workspaces"]'));`), 'native application rendered');
  await click('//*[@role="tablist" and @aria-label="Primary workspaces"]//*[@role="tab" and contains(.,"Create")]', 'xpath');
  await waitFor(() => execute('return Boolean(document.querySelector("[data-testid=prompt-input]"));'), 'Create editor visible');
}
async function closeSession() {
  if (!session) return;
  await command('DELETE', `/session/${session}`);
  session = null;
}
async function startFixture(mode) {
  if (fixture) { fixture.closeAllConnections(); await new Promise(resolve => fixture.close(resolve)); }
  fixture = createDesktopFixtureServer({ mode, onEvent: event => events.push(event) });
  fixture.listen(11434, '127.0.0.1');
  await once(fixture, 'listening');
}
async function checkPersisted() {
  const library = await readLibrary();
  const saved = library.filter(row => row.original === 'Summarize this synthetic native acceptance note.');
  assert.equal(saved.length, 1, 'Exactly one acceptance prompt persists alongside bundled starters');
  assert.match(saved[0].enhanced, /Fixture enhanced prompt/);
  const notes = await execute('return JSON.parse(localStorage.getItem("pl2-pads") || "null");');
  assert.ok(notes?.pads.some(pad => pad.content.includes('Survives native restart')));
  return saved[0];
}

try {
  await waitFor(() => command('GET', '/status'), 'native WebDriver ready');
  await openSession();
  evidence.checks.push('installed native binary rendered a Tauri window');
  await screenshot('launch');
  if (phase === 'retention') {
    await checkPersisted();
    evidence.checks.push('Library and Scratch survived OS uninstall and reinstall');
  } else {
    const baseline = await readLibrary();
    assert.ok(!baseline.some(row => row.original === 'Summarize this synthetic native acceptance note.'), 'Disposable runner must not contain a previous acceptance prompt');
    evidence.baselinePromptCount = baseline.length;
    await execute('localStorage.setItem("pl_telemetry_consent", "denied"); localStorage.setItem("pl2-provider-settings", JSON.stringify({provider:"ollama",ollamaBaseUrl:"http://127.0.0.1:11434",ollamaModel:"promptlab-fixture"})); return true;');
    await command('POST', `/session/${session}/refresh`, {});
    await startFixture('success');
    await fill('[data-testid="prompt-input"]', 'Summarize this synthetic native acceptance note.');
    await click('[data-testid="refine-action"]');
    await waitFor(() => execute('return document.body.innerText.includes("Fixture enhanced prompt");'), 'fixture enhancement');
    await click('[data-testid="save-to-library"]');
    const saved = await waitFor(async () => { const rows = await readLibrary(); return rows.length === baseline.length + 1 && rows.find(row => row.original === 'Summarize this synthetic native acceptance note.'); }, 'acknowledged Library save');
    assert.match(saved.enhanced, /Fixture enhanced prompt/);
    evidence.savedPromptId = saved.id;
    evidence.checks.push('Enhance reached only the loopback fixture and saved through the native UI');
    await click('//*[@role="tablist" and @aria-label="Primary workspaces"]//*[@role="tab" and contains(.,"Scratch")]', 'xpath');
    await fill('textarea[aria-label="Scratchpad"]', 'Survives native restart');
    await waitFor(() => execute('return JSON.parse(localStorage.getItem("pl2-pads") || "null")?.pads.some(pad => pad.content.includes("Survives native restart"));'), 'Scratch acknowledged save');
    await screenshot('saved');
    await closeSession();
    await openSession();
    const restored = await checkPersisted();
    assert.equal(restored.id, saved.id);
    evidence.checks.push('full native app close and relaunch preserved Library identity/body and Scratch content');
    await screenshot('restarted');
    await startFixture('slow');
    const priorRequests = events.filter(event => event === 'request').length;
    await fill('[data-testid="prompt-input"]', 'Cancel this synthetic native request.');
    await click('[data-testid="refine-action"]');
    await waitFor(() => events.filter(event => event === 'request').length > priorRequests, 'slow provider request');
    await click('//button[normalize-space(.)="Cancel"]', 'xpath');
    await waitFor(() => events.includes('connection-closed'), 'native cancellation closed upstream connection');
    evidence.checks.push('native Cancel closed the loopback provider connection');
    await startFixture('error');
    await fill('[data-testid="prompt-input"]', 'Fail this synthetic native request.');
    await click('[data-testid="refine-action"]');
    await waitFor(() => execute('return document.body.innerText.includes("Intentional fixture failure");'), 'visible provider failure');
    evidence.checks.push('native UI displayed terminal provider failure');
    await screenshot('failure');
  }
  evidence.status = 'passed';
} catch (error) {
  evidence.status = 'failed';
  evidence.error = error.message;
  evidence.failedCommand = evidence.lastCommand;
  if (session) await screenshot('failure').catch(() => {});
  process.exitCode = 1;
} finally {
  await closeSession().catch(() => {});
  if (fixture) { fixture.closeAllConnections(); await new Promise(resolve => fixture.close(resolve)); }
  if (driver.pid && driver.exitCode === null) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(driver.pid), '/T', '/F']);
    else { try { process.kill(-driver.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
  }
  evidence.fixtureEvents = events;
  await writeFile(path.join(evidenceDir, `${phase}.json`), JSON.stringify(evidence, null, 2));
  await writeFile(path.join(evidenceDir, `${phase}-driver.log`), driverOutput);
  console.log(JSON.stringify(evidence, null, 2));
}
