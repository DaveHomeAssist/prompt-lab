import { libraryWriteCoordinator } from './libraryWriteCoordinator.js';
import { libraryEditBuffers } from './libraryEditBuffers.js';
import { registerSessionRecoveryCapture } from './draftRecoveryCapture.js';

export const CAPTURE_LOCKS = Object.freeze({
  owner: 'promptlab:capture:v1:owner', membership: 'promptlab:capture:v1:membership',
  participant: 'promptlab:capture:v1:participant:', channel: 'promptlab:capture:v1',
});
const failure = code => Object.assign(new Error('Coordinated library capture could not complete. Keep the original library and retry.'), { code });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

// Web Locks cover participating contexts in one storage partition. They cannot
// prove ownership of unregistered older code, another profile or a native host.
export async function createOriginCaptureParticipant({
  locks = globalThis.navigator?.locks, channelFactory = name => new BroadcastChannel(name),
  clientId = globalThis.crypto.randomUUID(), coordinator = libraryWriteCoordinator, buffers = libraryEditBuffers,
} = {}) {
  if (!locks?.request || !locks?.query || typeof channelFactory !== 'function') throw failure('SOURCE_CAPABILITY_UNAVAILABLE');
  if (typeof clientId !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(clientId)) throw failure('INVALID_SOURCE');
  const channel = channelFactory(CAPTURE_LOCKS.channel), lifetime = deferred();
  let session, leader, stopped = false, lease;
  const send = message => channel.postMessage({ protocol: 1, from: clientId, ...message });
  const participants = async () => (await locks.query()).held.filter(lock => lock.name.startsWith(CAPTURE_LOCKS.participant))
    .map(lock => lock.name.slice(CAPTURE_LOCKS.participant.length)).sort();
  const sameMembers = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function finishSession(id) { if (session?.id === id) session.release.resolve(); }

  function prepare({ id, deadline, owner }) {
    if (session || stopped || !Number.isFinite(deadline) || deadline <= Date.now() || deadline > Date.now() + 60_000) return;
    const current = { id, owner, release: deferred(), check: null, snapshot: null };
    session = current;
    const remaining = Math.max(1, deadline - Date.now());
    const timer = setTimeout(() => current.release.resolve(), remaining);
    let resume;
    current.done = Promise.resolve().then(() => {
      resume = buffers.suspend();
      return coordinator.withPausedWrites(async ({ check }) => {
        current.check = check;
        current.snapshot = buffers.read();
        deliver({ protocol: 1, from: clientId, type: 'ready', id, buffers: current.snapshot });
        send({ type: 'ready', id, buffers: current.snapshot });
        await current.release.promise;
        buffers.assertUnchanged(current.snapshot);
      }, { timeoutMs: remaining });
    }).catch(() => {
      deliver({ protocol: 1, from: clientId, type: 'failed', id });
      send({ type: 'failed', id });
    }).finally(() => {
      clearTimeout(timer); resume?.();
      if (session === current) session = null;
      deliver({ protocol: 1, from: clientId, type: 'released', id });
      send({ type: 'released', id });
    });
  }

  function deliver(message) {
    if (message?.protocol !== 1 || typeof message.id !== 'string' || typeof message.from !== 'string') return;
    if (leader?.id === message.id && leader.expected.includes(message.from)) {
      if (message.type === 'ready' && Array.isArray(message.buffers)) leader.ready.set(message.from, message.buffers);
      if (message.type === 'checked') leader.checked.add(message.from);
      if (message.type === 'released') leader.released.add(message.from);
      if (message.type === 'failed') leader.failed = true;
      leader.wake();
    }
    if (message.type === 'prepare') prepare({ ...message, owner: message.from });
    if (message.type === 'release' && session?.owner === message.from) finishSession(message.id);
    if (message.type === 'check' && session?.id === message.id && session.owner === message.from) {
      let type = 'checked';
      try {
        if (!session.check) throw failure('LIBRARY_CAPTURE_CHANGED');
        session.check(); buffers.assertUnchanged(session.snapshot);
      } catch { type = 'failed'; }
      const response = { protocol: 1, from: clientId, id: message.id, type };
      deliver(response); send(response);
    }
  }
  channel.onmessage = event => deliver(event.data);
  try {
    await locks.request(CAPTURE_LOCKS.membership, { mode: 'shared' }, async () => {
      const ready = deferred();
      lease = locks.request(CAPTURE_LOCKS.participant + clientId, async () => { ready.resolve(); await lifetime.promise; });
      await Promise.race([ready.promise, lease.then(() => { throw failure('SOURCE_CAPABILITY_UNAVAILABLE'); })]);
    });
  } catch (error) { lifetime.resolve(); channel.close(); throw error; }

  async function capture(read, { timeoutMs = 30_000 } = {}) {
    if (stopped || typeof read !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw failure('INVALID_SOURCE');
    return locks.request(CAPTURE_LOCKS.owner, { ifAvailable: true }, async lock => {
      if (!lock) throw failure('LIBRARY_CAPTURE_BUSY');
      const abort = new AbortController(), deadline = Date.now() + timeoutMs;
      const timer = setTimeout(() => { abort.abort(); leader?.wake(); }, timeoutMs);
      try {
        return await locks.request(CAPTURE_LOCKS.membership, { signal: abort.signal }, async () => {
          const expected = await participants();
          if (!expected.includes(clientId) || expected.length > 32) throw failure('SOURCE_CAPABILITY_UNAVAILABLE');
          const waiters = new Set(), id = globalThis.crypto.randomUUID();
          const state = { id, expected, ready: new Map(), checked: new Set(), released: new Set(), failed: false,
            wake: () => { for (const done of waiters) done(); waiters.clear(); } };
          leader = state;
          const check = () => {
            if (abort.signal.aborted || Date.now() >= deadline) throw failure('LIBRARY_CAPTURE_TIMEOUT');
            if (state.failed) throw failure('LIBRARY_CAPTURE_CHANGED');
          };
          const wait = async predicate => { while (!predicate()) { check(); await new Promise(done => waiters.add(done)); } check(); };
          let completed = false;
          try {
            prepare({ id, deadline, owner: clientId });
            send({ type: 'prepare', id, deadline });
            await wait(() => state.ready.size === expected.length);
            const clientBuffers = expected.map(id => ({ clientId: id, buffers: state.ready.get(id) }));
            const value = await read({ clientBuffers, signal: abort.signal });
            check();
            if (!sameMembers(expected, await participants())) throw failure('LIBRARY_CAPTURE_CHANGED');
            deliver({ protocol: 1, from: clientId, type: 'check', id });
            send({ type: 'check', id });
            await wait(() => state.checked.size === expected.length);
            if (!sameMembers(expected, await participants())) throw failure('LIBRARY_CAPTURE_CHANGED');
            check();
            completed = true;
            return { value, coordination: { protocolVersion: 1, scope: 'cooperating-origin-clients', clientIds: expected, activationReady: false } };
          } finally {
            send({ type: 'release', id }); finishSession(id);
            await session?.done;
            // A subsequent capture must not race participants still resuming.
            try { await wait(() => state.released.size === expected.length); }
            catch (error) { if (completed) throw error; }
            finally { if (leader === state) leader = null; }
          }
        });
      } catch (error) { if (abort.signal.aborted) throw failure('LIBRARY_CAPTURE_TIMEOUT'); throw error; }
      finally { clearTimeout(timer); }
    });
  }

  return { clientId, capture, stop: async () => {
    stopped = true; leader && (leader.failed = true); leader?.wake();
    if (session) { finishSession(session.id); await session.done; }
    lifetime.resolve(); await lease; channel.close();
  } };
}

let appParticipant;
export function startAppCaptureParticipant() {
  if (!globalThis.navigator?.locks || typeof globalThis.BroadcastChannel !== 'function') return Promise.resolve(null);
  if (appParticipant) return appParticipant;
  // Register before announcing membership: another window can capture while
  // this one's React tree is still starting. Raw session recovery already exists.
  const unregister = registerSessionRecoveryCapture(libraryEditBuffers);
  return appParticipant = createOriginCaptureParticipant().then(participant => {
    let stopping;
    return { ...participant, stop: () => stopping ||= participant.stop().finally(() => {
      unregister(); appParticipant = null;
    }) };
  }).catch(() => { unregister(); appParticipant = null; return null; });
}
