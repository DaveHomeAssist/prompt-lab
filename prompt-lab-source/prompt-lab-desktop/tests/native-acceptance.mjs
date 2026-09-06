import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createDesktopFixtureServer } from '../../scripts/desktop-fixture-server.mjs';
import { exerciseLibrary, checkLibraryPersisted } from './native-library-acceptance.mjs';
import { exerciseWorkspace, checkWorkspacePersisted } from './native-workspace-acceptance.mjs';

// Runs only on disposable CI runners, against an installed application binary.
assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Use the operator checklist outside disposable CI.');
const application = process.env.PL_NATIVE_APP;
assert.ok(application && path.isAbsolute(application), 'PL_NATIVE_APP must identify the installed binary.');
const phase = process.env.PL_NATIVE_PHASE || 'exercise';
assert.ok(['exercise', 'retention'].includes(phase));
const evidenceDir = path.resolve(process.env.PL_NATIVE_EVIDENCE || 'native-evidence');
await mkdir(evidenceDir, { recursive: true });
const evidence = { application, phase, platform: process.platform, sha: process.env.GITHUB_SHA, checks: [] };
const tauriOptions = { application };
if (process.platform === 'win32') {
  assert.ok(process.env.LOCALAPPDATA, 'Windows local app data directory is required');
  const config = JSON.parse(await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
  // The directly launched app retains Tauri's default LocalData/identifier.
  const userDataFolder = path.join(process.env.LOCALAPPDATA, config.identifier);
  await mkdir(userDataFolder, { recursive: true });
  evidence.userDataFolder = userDataFolder;
}
const driver = process.platform === 'win32'
  ? spawn('msedgedriver.exe', ['--port=4444', '--verbose'], { stdio: ['ignore', 'pipe', 'pipe'] })
  : spawn('tauri-driver', ['--port', '4444'], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let driverOutput = '';
let driverError;
driver.on('error', error => { driverError = error; });
for (const stream of [driver.stdout, driver.stderr]) stream.on('data', chunk => { driverOutput = (driverOutput + chunk).slice(-32_000); });
let session;
let fixture;
let nativeApp;
let nativeAppPid;
let launchNumber = 0;
let nativeAppError;
let nativeOutput = '';
const events = [];

async function checkpoint(label) {
  evidence.checks.push(label);
  // Progress is deliberately separate from the final acceptance result.
  await writeFile(path.join(evidenceDir, `${phase}-progress.json`), JSON.stringify({ ...evidence, status: 'running' }, null, 2));
}
async function stopOwnedProcess(child, group = false) {
  if (!child?.pid) return;
  try {
    if (child.exitCode === null && child.signalCode === null) {
      if (process.platform === 'win32') {
        const result = spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { encoding: 'utf8', timeout: 10_000 });
        if (result.error) throw result.error;
        assert.equal(result.status, 0, result.stderr || result.stdout || 'Owned process cleanup failed');
      } else {
        try { process.kill(group ? -child.pid : child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      }
      const deadline = Date.now() + 5000;
      while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) await delay(100);
      assert.ok(child.exitCode !== null || child.signalCode !== null, 'Owned process did not exit');
    }
  } finally {
    // A descendant can retain inherited pipe handles after its parent exits.
    // Detach test-owned pipes after the bounded exit check; any failed cleanup
    // is recorded as failure, never converted into a passing lifecycle check.
    child.stdout?.destroy();
    child.stderr?.destroy();
    child.unref();
  }
}

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
    if (nativeAppError) throw nativeAppError;
    try { const result = await probe(); if (result) return result; } catch (error) { last = error; }
    await delay(200);
  }
  throw new Error(`Timed out: ${label}${last ? ` (${last.message})` : ''}`);
}
const execute = (script, args = []) => command('POST', `/session/${session}/execute/sync`, { script, args });
const readLibrary = () => execute('return JSON.parse(localStorage.getItem("pl2-library") || "[]");');
async function element(value, using = 'css selector') {
  const result = await waitFor(() => command('POST', `/session/${session}/element`, { using, value }), value);
  return result['element-6066-11e4-a52e-4f735466cecf'] || result.ELEMENT;
}
async function click(selector, using) {
  const id = await element(selector, using);
  await waitFor(() => command('GET', `/session/${session}/element/${id}/enabled`), `${selector} enabled`);
  await execute('arguments[0].scrollIntoView({block:"center",behavior:"instant"}); return true;', [{ 'element-6066-11e4-a52e-4f735466cecf': id }]);
  let previousRect;
  await waitFor(async () => {
    const rect = JSON.stringify(await command('GET', `/session/${session}/element/${id}/rect`));
    const stable = rect === previousRect;
    previousRect = rect;
    return stable;
  }, `${selector} position stable`);
  await command('POST', `/session/${session}/element/${id}/click`, {});
}
async function fill(selector, text) {
  const id = await element(selector);
  await command('POST', `/session/${session}/element/${id}/click`, {});
  // WebKit's element clear does not update React's controlled input state.
  // Ctrl+A / Backspace produces the same input events as operator replacement.
  await command('POST', `/session/${session}/element/${id}/value`, { text: '\uE009a\uE000\uE003' });
  // Backspace already completes an empty replacement; WebKit rejects empty send-keys.
  if (text.length > 0) await command('POST', `/session/${session}/element/${id}/value`, { text });
  assert.equal(await command('GET', `/session/${session}/element/${id}/property/value`), text, 'Native input contains exactly the requested fixture text');
}
async function screenshot(name) {
  const data = await command('GET', `/session/${session}/screenshot`);
  await writeFile(path.join(evidenceDir, `${phase}-${name}.png`), Buffer.from(data, 'base64'));
}
async function windowsStartupDiagnostics() {
  if (process.platform !== 'win32') return;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', `
    foreach ($root in @('HKLM:', 'HKCU:')) {
      $policy = Get-ItemProperty -LiteralPath "$root\\SOFTWARE\\Policies\\Microsoft\\Edge" -Name RemoteDebuggingAllowed -ErrorAction SilentlyContinue
      $arguments = Get-Item -LiteralPath "$root\\SOFTWARE\\Policies\\Microsoft\\Edge\\WebView2\\AdditionalBrowserArguments" -ErrorAction SilentlyContinue
      [pscustomobject]@{Root=$root; RemoteDebuggingAllowed=$policy.RemoteDebuggingAllowed; AdditionalBrowserArgumentsPolicyPresent=($null -ne $arguments)} | ConvertTo-Json
    }
    Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('prompt-lab-desktop.exe', 'msedgewebview2.exe', 'msedgedriver.exe') } |
      Select-Object Name,ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Depth 3
    $probe = $null
    try {
      if (!(Get-Process -Name 'prompt-lab-desktop' -ErrorAction SilentlyContinue)) {
        $probe = Start-Process -FilePath $env:PL_NATIVE_APP -PassThru -RedirectStandardError "$env:PL_NATIVE_DIAGNOSTIC_SCREEN.stderr.txt" -RedirectStandardOutput "$env:PL_NATIVE_DIAGNOSTIC_SCREEN.stdout.txt"
        Start-Sleep -Seconds 5
        $probe.Refresh()
        $probe | Select-Object Id,HasExited,ExitCode,MainWindowTitle,Responding | ConvertTo-Json
      }
      Add-Type -AssemblyName System.Windows.Forms
      Add-Type -AssemblyName System.Drawing
      Add-Type -AssemblyName UIAutomationClient
      Add-Type -AssemblyName UIAutomationTypes
      $window = Get-Process -Name 'prompt-lab-desktop' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
      if ($window) {
        $root = [System.Windows.Automation.AutomationElement]::FromHandle($window.MainWindowHandle)
        $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition) |
          Select-Object -First 120 | ForEach-Object { [pscustomobject]@{Name=$_.Current.Name; AutomationId=$_.Current.AutomationId; ControlType=$_.Current.ControlType.ProgrammaticName; Enabled=$_.Current.IsEnabled} } | ConvertTo-Json -Depth 3
      }
      $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
      $bitmap = New-Object System.Drawing.Bitmap $bounds.Width,$bounds.Height
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      try {
        $graphics.CopyFromScreen($bounds.Left,$bounds.Top,0,0,$bitmap.Size)
        $bitmap.Save($env:PL_NATIVE_DIAGNOSTIC_SCREEN, [System.Drawing.Imaging.ImageFormat]::Png)
      } finally { $graphics.Dispose(); $bitmap.Dispose() }
    } catch { Write-Warning $_.Exception.Message }
    finally {
      if ($probe -and !$probe.HasExited) {
        $null = $probe.CloseMainWindow()
        if (!$probe.WaitForExit(5000)) { $probe.Kill() }
      }
    }
  `], { encoding: 'utf8', timeout: 20_000, env: { ...process.env, PL_NATIVE_DIAGNOSTIC_SCREEN: path.join(evidenceDir, `${phase}-windows-desktop.png`) } });
  await writeFile(path.join(evidenceDir, `${phase}-windows-processes.log`), `${result.stdout || ''}\n${result.stderr || ''}\n${result.error?.message || ''}`);
}
async function openCreate() {
  // The compact inspector deliberately overlays workspace navigation.
  // Dismiss it through the same visible control a user must use first.
  if (await execute('return Boolean(document.querySelector(`[aria-label="Close prompt inspector"]`));')) {
    await click('[aria-label="Close prompt inspector"]');
  }
  await click('//*[@data-testid="nav-create"] | //nav[@aria-label="Primary mobile navigation"]//button[normalize-space(.)="Write"]', 'xpath');
}
async function openSession() {
  let capabilities = { 'tauri:options': tauriOptions };
  if (process.platform === 'win32') {
    const privilegesFile = path.join(evidenceDir, `${phase}-launch-${++launchNumber}-privileges.json`);
    nativeApp = spawn('powershell.exe', ['-NoProfile', '-File', fileURLToPath(new URL('./windows-native-standard-user.ps1', import.meta.url))], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PL_NATIVE_PROCESS_EVIDENCE: privilegesFile, TAURI_WEBVIEW_AUTOMATION: 'true', WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9222' },
    });
    nativeApp.on('error', error => { nativeAppError = error; });
    for (const stream of [nativeApp.stdout, nativeApp.stderr]) stream.on('data', chunk => { nativeOutput = (nativeOutput + chunk).slice(-32_000); });
    const privileges = await waitFor(async () => JSON.parse(await readFile(privilegesFile, 'utf8')), 'standard user app launch');
    assert.equal(privileges.childIntegrity, 'S-1-16-8192');
    assert.equal(privileges.childAdministrator, false);
    assert.equal(privileges.ownedObjectAccess, true);
    assert.ok(Number.isSafeInteger(privileges.childPid) && privileges.childPid > 1);
    nativeAppPid = privileges.childPid;
    (evidence.nativeProcessPrivileges ||= []).push(privileges);
    await waitFor(async () => {
      if (nativeApp.exitCode !== null) throw new Error(`Installed app exited with ${nativeApp.exitCode}`);
      const response = await fetch('http://127.0.0.1:9222/json/version', { signal: AbortSignal.timeout(1500) });
      if (!response.ok) return false;
      const version = await response.json();
      evidence.debuggingVersion = version;
      return Boolean(version.webSocketDebuggerUrl);
    }, 'installed WebView2 debugging endpoint');
    capabilities = { browserName: 'webview2', 'ms:edgeOptions': { debuggerAddress: '127.0.0.1:9222' } };
  }
  const result = await command('POST', '/session', { capabilities: { alwaysMatch: capabilities } });
  session = result.sessionId;
  assert.ok(session, 'Native session created');
  await command('POST', `/session/${session}/window/rect`, { width: 1180, height: 900 });
  await waitFor(() => execute(`return Boolean(window.__TAURI_INTERNALS__ && document.querySelector('[aria-label="Primary workspaces"], [aria-label="Primary mobile navigation"]'));`), 'native application rendered');
  // WebView2 can restore a compact native window despite the driver rect request.
  // Readiness and navigation must follow the app's actual responsive surface.
  (evidence.viewports ||= []).push(await execute(`return {width: innerWidth, height: innerHeight, compact: Boolean(document.querySelector('[aria-label="Primary mobile navigation"]'))};`));
  await openCreate();
  await waitFor(() => execute('return Boolean(document.querySelector("[data-testid=prompt-input]"));'), 'Create editor visible');
}
async function closeSession() {
  let browserPids = [];
  if (nativeAppPid) {
    const probe = spawnSync('powershell.exe', ['-NoProfile', '-Command', `
      $owned = @(Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" |
        Where-Object { $_.ParentProcessId -eq [int]$env:PL_NATIVE_OWNED_PID } |
        Select-Object -ExpandProperty ProcessId)
      ConvertTo-Json -InputObject $owned -Compress
    `], { encoding: 'utf8', timeout: 10_000, env: { ...process.env, PL_NATIVE_OWNED_PID: String(nativeAppPid) } });
    assert.equal(probe.status, 0, probe.stderr || 'Owned WebView2 process discovery failed');
    browserPids = JSON.parse(probe.stdout.trim());
    assert.ok(browserPids.length, 'Owned WebView2 browser process must be identified before restart');
  }
  const closingSession = session;
  const closeNativeWindowFirst = Boolean(nativeAppPid);
  try {
    // Attached EdgeDriver may close WebView2 when its session ends. Exercise
    // the user's native window close before releasing that driver session.
    if (session && !closeNativeWindowFirst) await command('DELETE', `/session/${session}`);
  } finally {
    session = null;
    if (nativeApp && nativeApp.exitCode === null && nativeApp.signalCode === null && !nativeAppPid) await stopOwnedProcess(nativeApp);
    if (nativeApp && nativeApp.exitCode === null && nativeApp.signalCode === null && nativeAppPid) {
      const close = spawnSync('powershell.exe', ['-NoProfile', '-Command', '$app = Get-Process -Id $env:PL_NATIVE_OWNED_PID -ErrorAction Stop; if (!$app.CloseMainWindow()) { throw "Native window refused close" }; if (!$app.WaitForExit(10000)) { throw "Native window did not exit" }'], {
        encoding: 'utf8', timeout: 15_000, env: { ...process.env, PL_NATIVE_OWNED_PID: String(nativeAppPid) },
      });
      assert.equal(close.status, 0, close.stderr || 'Native window close failed');
      await waitFor(() => nativeApp.exitCode !== null || nativeApp.signalCode !== null, 'native launcher exit after window close');
    }
    nativeApp?.stdout?.destroy();
    nativeApp?.stderr?.destroy();
    nativeApp?.unref();
    nativeApp = null;
    nativeAppPid = null;
    if (browserPids.length) {
      const exited = spawnSync('powershell.exe', ['-NoProfile', '-Command', `
        $owned = @($env:PL_NATIVE_BROWSER_PIDS.Split(',') | ForEach-Object { [int]$_ })
        $deadline = (Get-Date).AddSeconds(20)
        do {
          $remaining = @(Get-Process -Id $owned -ErrorAction SilentlyContinue)
          if (!$remaining.Count) { break }
          Start-Sleep -Milliseconds 100
        } while ((Get-Date) -lt $deadline)
        if ($remaining.Count) { throw 'Owned WebView2 processes did not finish shutdown' }
      `], { encoding: 'utf8', timeout: 25_000, env: { ...process.env, PL_NATIVE_BROWSER_PIDS: browserPids.join(',') } });
      assert.equal(exited.status, 0, exited.stderr || 'Owned WebView2 shutdown failed');
      (evidence.nativeShutdowns ||= []).push({ browserPids, exited: true, method: 'native-window-before-driver-session' });
    }
    if (closingSession && closeNativeWindowFirst) await command('DELETE', `/session/${closingSession}`);
  }
}
async function startFixture(mode, responseKind = 'enhancement') {
  if (fixture) { fixture.closeAllConnections(); await new Promise(resolve => fixture.close(resolve)); }
  fixture = createDesktopFixtureServer({ mode, responseKind, onEvent: event => events.push(event) });
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
  await click('[data-testid="nav-library"]');
  await fill('[data-testid="library-search"]', 'Fixture enhanced prompt');
  await waitFor(() => execute(`return [...document.querySelectorAll('.pl-library-card')].some(card => card.innerText.includes(${JSON.stringify(saved[0].title)}));`), 'persisted prompt visible in hydrated Library');
  await screenshot('persisted-library');
  await openCreate();
  return saved[0];
}

async function checkFollowUpPersisted(expected) {
  const library = await readLibrary();
  const child = library.find(row => row.id === expected.child.id);
  // Inspecting an entry records access and recomputes completeness timestamps.
  // Compare every other field, including semantic completeness and provenance.
  const persistentContent = row => {
    assert.ok(row, 'Follow-up record exists');
    const { updatedAt, updated_at, lastAccessedAt, completeness, ...content } = row;
    const { updatedAt: completenessCheckedAt, ...assessment } = completeness || {};
    return { ...content, completeness: assessment };
  };
  assert.deepEqual(persistentContent(child), persistentContent(expected.child), 'Follow-up identity, body and provenance persist');
  assert.deepEqual(library.find(row => row.id === expected.parent.id), expected.parent, 'Source prompt remains unchanged');
  await click('[data-testid="nav-library"]');
  await fill('[data-testid="library-search"]', child.title);
  await click(`//button[@aria-label="Inspect ${child.title}"]`, 'xpath');
  await waitFor(() => execute('return [...document.querySelectorAll("[aria-label=\\"Follow-up provenance\\"]")].some(node => node.innerText.includes("Saved run output"));'), 'saved run provenance visible in Library');
  await screenshot('follow-up-provenance');
  await openCreate();
}

async function exerciseFollowUp(parentId) {
  const parent = (await readLibrary()).find(row => row.id === parentId);
  assert.ok(parent?.currentVersionId, 'Saved source has a version');
  // Seed only synthetic upstream run data. Generation and saving below use the
  // installed app's UI, transport and persistence without adapter substitution.
  const source = { id: 'native-follow-up-source', promptId: parent.id, promptVersionId: parent.currentVersionId,
    promptTitle: parent.title, mode: 'ab', status: 'success', input: parent.original,
    output: 'Native saved answer: prioritize the measured acceptance gaps.', provider: 'ollama', model: 'promptlab-fixture', createdAt: new Date().toISOString() };
  const seeded = await command('POST', `/session/${session}/execute/async`, { script: `
    const record = arguments[0], done = arguments[arguments.length - 1];
    const request = indexedDB.open('prompt_lab_local', 4);
    request.onerror = () => done({error: String(request.error)});
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('eval_runs', 'readwrite');
      transaction.objectStore('eval_runs').put(record);
      transaction.oncomplete = () => { db.close(); done({ok: true}); };
      transaction.onabort = () => { db.close(); done({error: String(transaction.error)}); };
    };`, args: [source] });
  assert.equal(seeded.ok, true, JSON.stringify(seeded));
  await command('POST', `/session/${session}/refresh`, {});
  await click('[aria-label="Follow-up source"]');
  const sourceOption = await element('[aria-label="Follow-up source"] option[value="native-follow-up-source"]');
  await command('POST', `/session/${session}/element/${sourceOption}/click`, {});
  await startFixture('error', 'follow-up');
  await click('[data-testid="suggest-follow-ups"]');
  await waitFor(() => execute('return Boolean(document.querySelector("[data-testid=follow-up-panel] .text-red-400")?.textContent.trim());'), 'follow-up provider failure visible');
  await startFixture('success', 'follow-up');
  await click('[data-testid="suggest-follow-ups"]');
  const prompt = `Continue from this saved answer:\n${source.output}`;
  await waitFor(() => execute('return document.querySelector("[data-testid=follow-up-panel]")?.innerText.includes(arguments[0]);', [prompt]), 'suggestion derived from selected saved output');
  const baseline = await readLibrary();
  const beforeRequests = events.filter(event => event === 'request').length;
  await execute(`
    const original = Storage.prototype.setItem;
    window.__nativeFailFollowUpSave = true;
    window.__nativeRejectedSaves = 0;
    Storage.prototype.setItem = function(key, value) {
      if (window.__nativeFailFollowUpSave && key === 'pl2-library') {
        window.__nativeRejectedSaves++;
        throw new DOMException('Synthetic native quota failure', 'QuotaExceededError');
      }
      return original.call(this, key, value);
    }; return true;`);
  const saveButton = '//*[@data-testid="follow-up-panel"]//button[normalize-space(.)="Save to Library"]';
  await click(saveButton, 'xpath');
  await waitFor(() => execute('return window.__nativeRejectedSaves > 0;'), 'follow-up write rejected');
  assert.deepEqual(await readLibrary(), baseline, 'Rejected save does not acknowledge or change Library');
  await execute('window.__nativeFailFollowUpSave = false; return true;');
  await click(saveButton, 'xpath');
  const child = await waitFor(async () => (await readLibrary()).find(row => row.original === prompt), 'follow-up saved after retry');
  assert.notEqual(child.id, parent.id);
  const origin = child.metadata?.followUpOrigin;
  assert.equal(origin?.sourceKind, 'run-output');
  assert.equal(origin.sourcePromptId, parent.id);
  assert.equal(origin.sourcePromptVersionId, parent.currentVersionId);
  assert.equal(origin.sourceRunId, source.id);
  assert.equal(origin.generationProvider, 'ollama');
  assert.equal(origin.generationModel, 'promptlab-fixture');
  assert.equal((await readLibrary()).length, baseline.length + 1);
  assert.equal(events.filter(event => event === 'request').length, beforeRequests, 'Storage retry does not repeat provider generation');
  await click('//*[@data-testid="follow-up-panel"]//button[normalize-space(.)="Use in editor"]', 'xpath');
  assert.equal(await execute('return document.querySelector("[data-testid=prompt-input]").value;'), prompt);
  const expected = { child, parent: baseline.find(row => row.id === parent.id) };
  await writeFile(path.join(evidenceDir, `${phase}-follow-up-before-restart.json`), JSON.stringify(expected, null, 2));
  await closeSession();
  await openSession();
  await checkFollowUpPersisted(expected);
  evidence.followUp = expected;
  await checkpoint('saved-output follow-up survives native restart; rejected save retry preserves parent and makes no provider call');
}

const executeAsync = script => command('POST', `/session/${session}/execute/async`, { script, args: [] });
async function uploadJson(selector, data) {
  const file = path.join(evidenceDir, 'workspace-import.json');
  await writeFile(file, JSON.stringify(data, null, 2));
  const id = await element(selector);
  await command('POST', `/session/${session}/element/${id}/value`, { text: file });
}
const libraryApi = { execute, executeAsync, uploadJson, click, fill, waitFor, readLibrary, closeSession, openSession, screenshot, checkpoint };

try {
  await checkpoint('native harness started');
  await waitFor(() => command('GET', '/status'), 'native WebDriver ready');
  await openSession();
  await checkpoint('installed native binary rendered a Tauri window');
  await screenshot('launch');
  if (phase === 'retention') {
    const restored = await checkPersisted();
    const previous = JSON.parse(await readFile(path.join(evidenceDir, 'exercise.json'), 'utf8'));
    assert.equal(restored.id, previous.savedPromptId, 'Reinstall preserves the exact saved identity');
    evidence.savedPromptId = restored.id;
    await checkpoint('Library and Scratch survived OS uninstall and reinstall');
    assert.ok(previous.followUp, 'Exercise must include follow-up acceptance');
    await checkFollowUpPersisted(previous.followUp);
    evidence.followUp = previous.followUp;
    await checkpoint('follow-up identity and provenance survived OS uninstall and reinstall');
    assert.ok(previous.libraryMatrix, 'Exercise must include Library acceptance');
    await checkLibraryPersisted(libraryApi, previous.libraryMatrix);
    evidence.libraryMatrix = previous.libraryMatrix;
    await checkpoint('Library matrix identities, order and collection cleanup survived OS uninstall and reinstall');
    assert.ok(previous.workspaceImport, 'Exercise must include native workspace import');
    await checkWorkspacePersisted(libraryApi, previous.workspaceImport);
    evidence.workspaceImport = previous.workspaceImport;
    await checkpoint('imported versions, mapped runs/test cases and provenance survived OS uninstall and reinstall');
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
    await checkpoint('Enhance reached only the loopback fixture and saved through the native UI');
    await click('//*[@data-testid="nav-scratch"] | //nav[@aria-label="Primary mobile navigation"]//button[normalize-space(.)="Scratch"]', 'xpath');
    await fill('textarea[aria-label="Scratchpad"]', 'Survives native restart');
    await waitFor(() => execute('return JSON.parse(localStorage.getItem("pl2-pads") || "null")?.pads.some(pad => pad.content.includes("Survives native restart"));'), 'Scratch acknowledged save');
    await screenshot('saved');
    await closeSession();
    await openSession();
    const restored = await checkPersisted();
    assert.equal(restored.id, saved.id);
    await checkpoint('full native app close and relaunch preserved Library identity/body and Scratch content');
    await screenshot('restarted');
    await exerciseFollowUp(saved.id);
    await startFixture('slow');
    const priorRequests = events.filter(event => event === 'request').length;
    await fill('[data-testid="prompt-input"]', 'Cancel this synthetic native request.');
    await click('[data-testid="refine-action"]');
    await waitFor(() => events.filter(event => event === 'request').length > priorRequests, 'slow provider request');
    await click('//button[normalize-space(.)="Cancel"]', 'xpath');
    await waitFor(() => events.includes('connection-closed'), 'native cancellation closed upstream connection');
    await checkpoint('native Cancel closed the loopback provider connection');
    await startFixture('error');
    await fill('[data-testid="prompt-input"]', 'Fail this synthetic native request.');
    await click('[data-testid="refine-action"]');
    await waitFor(() => execute('return document.body.innerText.includes("ollama request failed (400)");'), 'visible provider failure');
    await checkpoint('native UI displayed terminal provider failure');
    await screenshot('failure');
    evidence.libraryMatrix = await exerciseLibrary(libraryApi);
    evidence.workspaceImport = await exerciseWorkspace(libraryApi, saved.id);
    // Import deliberately replaces Alpha and adds two records. Retention must
    // verify this acknowledged post-import state, not the pre-import fixture.
    const afterImport = await readLibrary();
    evidence.libraryMatrix.order = afterImport.map(row => row.id);
    evidence.libraryMatrix.entries = afterImport.filter(row => evidence.libraryMatrix.entries.some(entry => entry.id === row.id));
  }
  evidence.status = 'passed';
} catch (error) {
  evidence.status = 'failed';
  evidence.error = error.message;
  evidence.failedCommand = evidence.lastCommand;
  await windowsStartupDiagnostics().catch(error => { evidence.diagnosticError = error.message; });
  if (session) evidence.failureState = await execute(`return {
    input: document.querySelector('[data-testid="prompt-input"]')?.value,
    library: JSON.parse(localStorage.getItem('pl2-library') || '[]').map(({id,title,original}) => ({id,title,original}))
  };`).catch(() => null);
  if (session) await screenshot('failure').catch(() => {});
  process.exitCode = 1;
} finally {
  await closeSession().catch(error => { evidence.cleanupError = error.message; evidence.status = 'failed'; process.exitCode = 1; });
  if (fixture) { fixture.closeAllConnections(); await new Promise(resolve => fixture.close(resolve)); }
  for (const child of [driver, nativeApp]) {
    await stopOwnedProcess(child, child === driver).catch(error => {
      evidence.cleanupError = [evidence.cleanupError, error.message].filter(Boolean).join('; ');
      evidence.status = 'failed';
      process.exitCode = 1;
    });
  }
  evidence.fixtureEvents = events;
  evidence.remainingResources = process.getActiveResourcesInfo();
  await writeFile(path.join(evidenceDir, `${phase}.json`), JSON.stringify(evidence, null, 2));
  await writeFile(path.join(evidenceDir, `${phase}-driver.log`), driverOutput);
  if (process.platform === 'win32') await writeFile(path.join(evidenceDir, `${phase}-native.log`), nativeOutput);
  console.log(JSON.stringify(evidence, null, 2));
}
