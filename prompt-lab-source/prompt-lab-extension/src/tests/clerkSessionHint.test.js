import { describe, expect, it } from 'vitest';
import { hasClerkSessionHint } from '../lib/clerkSessionHint.js';

describe('hasClerkSessionHint', () => {
  it('is false without cookies or with a signed-out marker', () => {
    expect(hasClerkSessionHint('')).toBe(false);
    expect(hasClerkSessionHint(undefined)).toBe(false);
    expect(hasClerkSessionHint('__client_uat=0')).toBe(false);
    expect(hasClerkSessionHint('theme=dark; __client_uat_Ab12=0')).toBe(false);
    expect(hasClerkSessionHint('__client_uat=')).toBe(false);
  });

  it('is true when Clerk recorded a client update', () => {
    expect(hasClerkSessionHint('__client_uat=1730480000')).toBe(true);
    expect(hasClerkSessionHint('a=1; __client_uat_Ab12-x=1730480000; b=2')).toBe(true);
  });

  it('ignores look-alike cookie names', () => {
    expect(hasClerkSessionHint('my__client_uat=1730480000')).toBe(false);
    expect(hasClerkSessionHint('__client_uatx=1730480000')).toBe(false);
  });
});
