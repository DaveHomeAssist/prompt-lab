// S-06: the www -> apex Library migration frames /legacy-library-bridge.html
// on www (and the old tawny demo). The bridge must answer the apex with the
// library stored on its own origin, and must stay silent when it is served
// from the apex itself or asked by its own origin or a stranger.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../prompt-lab-web/public/legacy-library-bridge.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function runBridge(origin, stored = {}) {
  const listeners = [];
  const window = {
    location: { origin },
    localStorage: { getItem: key => (key in stored ? stored[key] : null) },
    addEventListener: (type, fn) => { if (type === 'message') listeners.push(fn); },
  };
  vm.runInNewContext(script, { window, Set, JSON, Array });
  return {
    listening: listeners.length > 0,
    ask(fromOrigin, data = { type: 'pl2:request-legacy-library' }) {
      const replies = [];
      const source = { postMessage: (message, targetOrigin) => replies.push({ message, targetOrigin }) };
      for (const fn of listeners) fn({ origin: fromOrigin, data, source });
      return replies;
    },
  };
}

const library = [{ id: 'p1', title: 'From www', original: 'body', enhanced: 'body' }];
const stored = { 'pl2-library': JSON.stringify(library), 'pl2-collections': JSON.stringify(['Ops']) };

test('the www bridge answers the apex with the www library, targeted at the apex only', () => {
  const bridge = runBridge('https://www.promptlab.tools', stored);
  const replies = bridge.ask('https://promptlab.tools');
  assert.equal(replies.length, 1);
  assert.equal(replies[0].targetOrigin, 'https://promptlab.tools');
  assert.deepEqual(JSON.parse(JSON.stringify(replies[0].message)), {
    type: 'pl2:legacy-library-payload', library, collections: ['Ops'], sourceOrigin: 'https://www.promptlab.tools',
  });
});

test('the bridge is inert when served from the apex itself', () => {
  const bridge = runBridge('https://promptlab.tools', stored);
  assert.equal(bridge.listening, false);
});

test('the bridge ignores its own origin, strangers and other message types', () => {
  const bridge = runBridge('https://www.promptlab.tools', stored);
  assert.deepEqual(bridge.ask('https://www.promptlab.tools'), []);
  assert.deepEqual(bridge.ask('https://evil.example'), []);
  assert.deepEqual(bridge.ask('null'), []);
  assert.deepEqual(bridge.ask('https://promptlab.tools', { type: 'other' }), []);
});

test('the tawny bridge still answers the apex and www', () => {
  const bridge = runBridge('https://prompt-lab-tawny.vercel.app', stored);
  assert.equal(bridge.ask('https://promptlab.tools').length, 1);
  assert.equal(bridge.ask('https://www.promptlab.tools').length, 1);
});

test('a corrupt or missing stored library is sent as empty arrays', () => {
  const bridge = runBridge('https://www.promptlab.tools', { 'pl2-library': '{not json' });
  const [reply] = bridge.ask('https://promptlab.tools');
  assert.deepEqual(JSON.parse(JSON.stringify(reply.message.library)), []);
  assert.deepEqual(JSON.parse(JSON.stringify(reply.message.collections)), []);
});
