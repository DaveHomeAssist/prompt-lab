import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { resolveExtensionSource } from '../../scripts/assemble.js';

// The Chrome Web Store package logged ERR_FILE_NOT_FOUND on the Settings tab
// because options.html pointed its favicons at ../../../assets/icons/favicon/,
// which is outside the packaged extension. Every local href/src in the shipped
// options.html must resolve to a file assemble.js packages.
describe('packaged options.html assets', () => {
  const optionsPath = resolveExtensionSource('options.html');
  const html = readFileSync(optionsPath, 'utf8');
  const localRefs = [...html.matchAll(/\s(?:href|src)="([^"#]+)"/g)]
    .map((match) => match[1])
    .filter((ref) => !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(ref));

  it('finds the icon links', () => {
    expect(localRefs.some((ref) => ref.startsWith('icons/'))).toBe(true);
  });

  it('never points outside the package', () => {
    expect(localRefs.filter((ref) => ref.startsWith('..') || ref.startsWith('/'))).toEqual([]);
  });

  it('resolves every local reference to a packaged file', () => {
    const missing = localRefs.filter((ref) => {
      const [topLevel, ...rest] = ref.replace(/^\.\//, '').split('/');
      const source = resolveExtensionSource(topLevel);
      return !source || (rest.length > 0 && !existsSync(join(source, ...rest)));
    });
    expect(missing).toEqual([]);
  });
});
