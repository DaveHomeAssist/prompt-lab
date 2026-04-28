import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MODES, T } from '../constants.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const cssPath = path.resolve(testDir, '../index.css');
const cssSource = fs.readFileSync(cssPath, 'utf8');

describe('shared brand tokens', () => {
  it('defines the shared shell variables in index.css', () => {
    expect(cssSource).toContain('--pl-focus-ring: rgba(251, 146, 60, 0.72);');
    expect(cssSource).toContain('--pl-focus-ring-offset: rgba(10, 10, 15, 0.92);');
    expect(cssSource).toContain('--pl-brand-ember: #e8512f;');
    expect(cssSource).toContain('--pl-brand-gold: #c4a44a;');
    expect(cssSource).toContain('--pl-brand-paper: #f0ede6;');
    expect(cssSource).toContain('.pl-brand-title {');
    expect(cssSource).toContain('.pl-brand-chip {');
  });

  it('leans dark theme surfaces toward the landing palette without changing semantic success states', () => {
    expect(T.dark.bg).toBe('bg-[#06060a]');
    expect(T.dark.surface).toBe('bg-[#101018]');
    expect(T.dark.input).toBe('bg-[#14141d] border-white/10');
    expect(T.dark.text).toBe('text-[#f0ede6]');
    expect(T.dark.textSub).toBe('text-[#b3afaa]');
    expect(T.dark.textMuted).toBe('text-[#7c7a76]');
    expect(T.dark.textBody).toBe('text-[#d7d2cb]');
    expect(T.dark.textAlt).toBe('text-[#c7c2bb]');
    expect(T.dark.header).toBe('bg-[#0a0a0f]/95 backdrop-blur-sm border-white/10');
    expect(T.dark.btn).toBe('bg-white/[0.04] hover:bg-white/[0.08]');
    expect(T.dark.scoreGood).toBe('text-green-400');
    expect(T.dark.diffAdd).toBe('bg-green-900/60 text-green-200');
  });

  it('uses plain-text enhancement mode labels that match the refined product voice', () => {
    expect(MODES.map((mode) => mode.label)).toEqual([
      'Balanced',
      'Claude',
      'ChatGPT',
      'Image Gen',
      'Code Gen',
      'Concise',
      'Detailed',
    ]);
  });
});
