import { describe, expect, it, vi } from 'vitest';
import { appPathToHashUrl, redirectAppPathToHash } from '../lib/appPathRoute.js';

describe('appPathToHashUrl (V-03)', () => {
  it.each([
    ['/app/compare', '/app/#/compare'],
    ['/app/diff', '/app/#/diff'],
    ['/app/settings', '/app/#/settings'],
    ['/app/library/', '/app/#/library'],
    ['/app/scratch', '/app/#/scratch'],
    ['/app/evaluate', '/app/#/evaluate'],
    ['/app/split/library', '/app/#/split/library'],
    ['/app/Write', '/app/#/'],
    ['/app/notebook', '/app/#/scratch'],
  ])('%s -> %s', (pathname, expected) => {
    expect(appPathToHashUrl({ pathname, search: '', hash: '' })).toBe(expected);
  });

  it('keeps the query string', () => {
    expect(appPathToHashUrl({ pathname: '/app/library', search: '?intent=x', hash: '' })).toBe('/app/?intent=x#/library');
  });

  it('prefers an explicit hash route', () => {
    expect(appPathToHashUrl({ pathname: '/app/compare', search: '', hash: '#/library' })).toBe('/app/#/library');
  });

  it('leaves the app root and non-app paths alone', () => {
    for (const pathname of ['/app/', '/app', '/app/index.html', '/', '/terms']) {
      expect(appPathToHashUrl({ pathname, search: '', hash: '#/library' })).toBeNull();
    }
  });

  it('rewrites the address with replaceState', () => {
    const replaceState = vi.fn();
    const win = { location: { pathname: '/app/compare', search: '', hash: '' }, history: { state: null, replaceState } };
    expect(redirectAppPathToHash(win)).toBe(true);
    expect(replaceState).toHaveBeenCalledWith(null, '', '/app/#/compare');
  });
});
