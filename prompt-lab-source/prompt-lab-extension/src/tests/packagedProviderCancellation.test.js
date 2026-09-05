import { mkdtempSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { assemble } from '../../scripts/assemble.js';
import { callProvider as shared } from '../lib/providers.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let artifact;
let packaged;
beforeAll(async () => {
  artifact = mkdtempSync(join(root, '.provider-artifact-'));
  assemble(basename(artifact));
  packaged = (await import(pathToFileURL(join(artifact, 'lib/providers.js')).href)).callProvider;
});
afterAll(() => { if (artifact) rmSync(artifact, { recursive: true, force: true }); });

const settings = {
  apiKey: 'fixture', openaiApiKey: 'fixture', geminiApiKey: 'fixture', openrouterApiKey: 'fixture',
  ollamaBaseUrl: 'http://127.0.0.1:11434',
};
const reply = {
  content: [{ type: 'text', text: 'Fixture' }], choices: [{ message: { content: 'Fixture' } }],
  candidates: [{ content: { parts: [{ text: 'Fixture' }] } }], message: { content: 'Fixture' },
};

for (const provider of ['anthropic', 'openai', 'gemini', 'openrouter', 'ollama']) {
  it(`${provider}: shared and assembled transports observe cancellation`, async () => {
    for (const callProvider of [shared, packaged]) {
      const controller = new AbortController();
      const fetchImpl = vi.fn((_url, init) => new Promise((_resolve, reject) => {
        expect(init.signal).toBe(controller.signal);
        init.signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
      }));
      const pending = callProvider({ provider, settings, payload: { messages: [{ role: 'user', content: 'Fixture' }] }, fetchImpl, signal: controller.signal });
      controller.abort();
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      expect(fetchImpl).toHaveBeenCalledOnce();
      expect(fetchImpl.mock.calls[0][1].signal.aborted).toBe(true);
    }
  });

  it(`${provider}: rejects pre-cancelled and late completed requests; normal calls still succeed`, async () => {
    for (const callProvider of [shared, packaged]) {
      const controller = new AbortController();
      controller.abort();
      const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => reply });
      const args = { provider, settings, payload: { messages: [{ role: 'user', content: 'Fixture' }] }, fetchImpl };
      await expect(callProvider({ ...args, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
      expect(fetchImpl).not.toHaveBeenCalled();
      await expect(callProvider(args)).resolves.toMatchObject({ content: [{ type: 'text', text: 'Fixture' }] });
      const late = new AbortController();
      fetchImpl.mockImplementationOnce(async () => { late.abort(); return { ok: true, json: async () => reply }; });
      await expect(callProvider({ ...args, signal: late.signal })).rejects.toMatchObject({ name: 'AbortError' });
    }
  });
}
