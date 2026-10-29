import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('literal native WebDriver scripts parse after JavaScript string decoding', () => {
  const source = readFileSync(new URL('./native-acceptance.mjs', import.meta.url), 'utf8');
  let checked = 0;
  // Parsing the harness alone cannot catch incorrectly escaped JS inside a string.
  // Dynamic templates are covered by the installed-app acceptance, not evaluated here.
  for (const pattern of [/\bexecute(?:Async)?\(\s*('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")/gs, /\bexecute(?:Async)?\(\s*(`(?:\\.|[^`\\])*`)/gs]) {
    for (const match of source.matchAll(pattern)) {
      if (match[1].startsWith('`') && match[1].includes('${')) continue;
      const script = Function(`return ${match[1]}`)();
      assert.doesNotThrow(() => Function(script), `Embedded script at harness offset ${match.index}`);
      checked++;
    }
  }
  assert.ok(checked > 20, `The syntax guard must inspect the actual acceptance scripts (${checked} found)`);
});


test('Library journal fault injection cannot abort or acknowledge a Scratch transaction', async () => {
  const source = readFileSync(new URL('./native-acceptance.mjs', import.meta.url), 'utf8');
  const literal = [...source.matchAll(/\bexecute\(\s*(`(?:\\.|[^`\\])*`)/gs)]
    .map(match => match[1]).find(script => script.includes('window.__nativeLibraryDurability ='));
  assert.ok(literal, 'Exercise the actual native Library probe');
  const script = Function(`return ${literal}`)();
  class Transaction extends EventTarget {
    constructor(db) { super(); this.db = db; this.aborted = false; }
    abort() { this.aborted = true; this.dispatchEvent(new Event('abort')); }
  }
  class Database {
    constructor(name = 'prompt_lab_durable') { this.name = name; }
    transaction() { return new Transaction(this); }
  }
  class Store {
    constructor(transaction) { this.transaction = transaction; }
    put(value) { return value; }
  }
  let observe;
  let receipt = false;
  const window = {};
  class Observer { constructor(callback) { observe = callback; } observe() {} }
  const document = { body: {}, querySelector: () => receipt };
  Function('window', 'IDBDatabase', 'IDBObjectStore', 'MutationObserver', 'document', 'queueMicrotask', script)
    (window, Database, Store, Observer, document, queueMicrotask);
  const database = new Database();
  const scratch = database.transaction('journal', 'readwrite');
  new Store(scratch).put({ id: 'scratch' });
  await Promise.resolve();
  assert.equal(scratch.aborted, false, 'Library failure must not poison Scratch migration');
  scratch.dispatchEvent(new Event('complete'));
  assert.equal(window.__nativeLibraryDurability.completed, 0, 'Scratch completion cannot acknowledge Library');
  receipt = true; observe();
  assert.equal(window.__nativeLibraryDurability.prematureReceipt, true);
  const failed = database.transaction('journal', 'readwrite');
  new Store(failed).put({ id: 'library' });
  await Promise.resolve();
  assert.equal(failed.aborted, true, 'The real Library abort fault remains active');
  assert.equal(window.__nativeLibraryDurability.aborted, 1);
  window.__nativeLibraryDurability.fail = false;
  const saved = database.transaction('journal', 'readwrite');
  new Store(saved).put({ id: 'library' });
  let observedCompletion;
  saved.addEventListener('complete', () => { observedCompletion = window.__nativeLibraryDurability.completed; });
  saved.dispatchEvent(new Event('complete'));
  assert.equal(observedCompletion, 1, 'Observe strict completion before the application save handler');
});
