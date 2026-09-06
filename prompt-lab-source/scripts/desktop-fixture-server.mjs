import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { fixtureEnhancementContract } from '../prompt-lab-extension/src/lib/providerFixture.js';

const origins = new Set(['tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost']);
const model = 'promptlab-fixture';

// Operator-only loopback transport. It never forwards traffic or reads credentials.
export function createDesktopFixtureServer({ mode = 'success', responseKind = 'enhancement', delayMs = 30_000, onEvent = () => {} } = {}) {
  if (!['success', 'slow', 'error'].includes(mode)) throw new Error('Mode must be success, slow, or error.');
  if (!['enhancement', 'follow-up'].includes(responseKind)) throw new Error('Unknown fixture response kind.');
  return http.createServer(async (request, response) => {
    const origin = request.headers.origin;
    const reply = (status, body) => {
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    if (origin && !origins.has(origin)) return reply(403, { error: 'Origin not allowed' });
    if (origin) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Vary', 'Origin');
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      response.setHeader('Access-Control-Allow-Headers', 'content-type');
    }
    if (request.method === 'OPTIONS') { response.writeHead(204); return response.end(); }
    if (request.method === 'GET' && request.url === '/api/tags') {
      return reply(200, { models: [{ name: model, model }] });
    }
    if (request.method !== 'POST' || request.url !== '/api/chat') return reply(404, { error: 'Unknown fixture route' });
    let body = '';
    try {
      for await (const chunk of request) {
        body += chunk.toString();
        if (Buffer.byteLength(body) > 256 * 1024) return reply(413, { error: 'Fixture input too large' });
      }
      const payload = JSON.parse(body);
      if (!Array.isArray(payload?.messages)) return reply(400, { error: 'messages must be an array' });
      onEvent('request');
      if (mode === 'error') return reply(400, { error: 'Intentional fixture failure' });
      if (mode === 'slow') {
        const completed = await new Promise(resolve => {
          const close = () => { clearTimeout(timer); onEvent('connection-closed'); resolve(false); };
          const timer = setTimeout(() => { response.off('close', close); resolve(true); }, delayMs);
          response.once('close', close);
        });
        if (!completed) return;
      }
      const result = responseKind === 'follow-up'
        ? { suggestions: [{ title: 'Fixture next analysis', prompt: `Continue from this saved answer:\n${payload.messages.find(message => message.role === 'user')?.content || ''}` }] }
        : fixtureEnhancementContract(payload);
      reply(200, { model, done: true, message: { role: 'assistant', content: JSON.stringify(result) } });
      onEvent('completed');
    } catch {
      if (!response.destroyed && !response.headersSent) reply(400, { error: 'Invalid fixture request' });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createDesktopFixtureServer({ mode: process.argv[2] || 'success', onEvent: event => console.log(`fixture: ${event}`) });
  server.on('error', error => { console.error(`Fixture could not listen: ${error.code || 'unknown error'}`); process.exitCode = 1; });
  server.listen(11434, '127.0.0.1', () => console.log('Fixture listening on http://127.0.0.1:11434; no upstream traffic.'));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { server.closeAllConnections(); server.close(); });
}
