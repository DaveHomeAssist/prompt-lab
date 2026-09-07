import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test } from '@playwright/test';
import { exerciseLibrary } from '../../prompt-lab-desktop/tests/native-library-acceptance.mjs';
import { exerciseWorkspace } from '../../prompt-lab-desktop/tests/native-workspace-acceptance.mjs';

const extensionPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');

// Fast development coverage for shared scenario logic. Native CI still owns
// WebDriver behavior, installed-process restart and installer retention proof.
for (const width of [400, 480, 1180]) test(`native scenario browser development at ${width}px`, async ({}, testInfo) => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'promptlab-native-development-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  let page;
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const url = `chrome-extension://${new URL(worker.url()).host}/panel.html`;
    const execute = (script, args = []) => page.evaluate(({ script, args }) => new Function(script)(...args), { script, args });
    const executeAsync = script => page.evaluate(script => new Promise(resolve => new Function(script)(resolve)), script);
    const readLibrary = () => execute('return JSON.parse(localStorage.getItem("pl2-library") || "[]");');
    const waitFor = async (read, label) => {
      let value;
      await expect.poll(async () => Boolean(value = await read()), { message: label, timeout: 15_000 }).toBe(true);
      return value;
    };
    const openSession = async () => {
      page = await context.newPage();
      page.setDefaultTimeout(8000);
      await page.setViewportSize({ width, height: 1000 });
      await page.route('**/api/proxy', route => route.abort());
      await page.goto(url);
      await page.getByTestId('prompt-input').waitFor();
    };
    const api = {
      execute, executeAsync, readLibrary, waitFor, openSession,
      closeSession: () => page.close(),
      fill: (selector, text) => page.locator(selector).fill(text),
      click: async (selector, using) => {
        const locator = page.locator(using === 'xpath' ? `xpath=${selector}` : selector);
        if (selector.includes(' option[')) await locator.locator('..').selectOption(await locator.getAttribute('value'));
        else await locator.click();
      },
      uploadJson: (selector, data) => page.locator(selector).setInputFiles({ name: 'native-workspace.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) }),
      screenshot: name => page.screenshot({ path: testInfo.outputPath(`${name}.png`) }),
      checkpoint: async label => testInfo.annotations.push({ type: 'browser development only', description: label }),
    };
    await openSession();
    await waitFor(async () => { const rows = await readLibrary(); return rows.length > 0 && rows.every(row => row.completeness); }, 'initial Library hydration');
    await execute(`
      localStorage.setItem('pl_telemetry_consent', 'denied');
      const rows = JSON.parse(localStorage.getItem('pl2-library'));
      rows.push({id:'native-dev-parent',title:'Native lifecycle parent',original:'Native parent original',enhanced:'Native parent enhanced',variants:[{label:'Concise',content:'Native concise variant'}],notes:'Native saved notes',currentVersionId:'parent-version',createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z'});
      localStorage.setItem('pl2-library', JSON.stringify(rows));
      window.dispatchEvent(new StorageEvent('storage', {key:'pl2-library', storageArea:localStorage}));
      return true;`);
    await waitFor(async () => (await api.readLibrary()).find(row => row.id === 'native-dev-parent')?.completeness, 'synthetic parent adopted by Library store');
    await page.close();
    await openSession();
    await exerciseLibrary(api);
    await exerciseWorkspace(api, 'native-dev-parent');
  } finally {
    await context.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
});
