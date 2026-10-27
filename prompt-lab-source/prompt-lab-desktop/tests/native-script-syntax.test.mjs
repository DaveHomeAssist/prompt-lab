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
