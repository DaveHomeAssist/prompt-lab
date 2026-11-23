import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { signInAppearance } from '../../../prompt-lab-web/app/signInAppearance.js';

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../prompt-lab-web/app');

describe('signed-out /app gate', () => {
  it('hides Clerk’s duplicate heading and uses the landing colors', () => {
    expect(signInAppearance.elements.headerTitle).toMatchObject({ display: 'none' });
    expect(signInAppearance.variables.colorPrimary).toBe('#C2401F');
    expect(signInAppearance.variables.colorBackground).toBe('#101018');
    expect(signInAppearance.variables.fontFamily).toContain('Outfit');
    const css = readFileSync(resolve(appDir, 'sign-in.css'), 'utf8');
    const shell = readFileSync(resolve(appDir, 'main-web.jsx'), 'utf8');
    expect(css).toContain('.cl-headerTitle');
    expect(css).toContain('#06060A');
    expect(css).toContain('PL');
    expect(shell).toContain('appearance={signInAppearance}');
    expect(shell).toContain('signInContext.heading');
    expect(shell).toContain('Back to promptlab.tools');
  });
});