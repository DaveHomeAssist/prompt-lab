import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MODES, T } from '../constants.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const cssPath = path.resolve(testDir, '../index.css');
const cssSource = fs.readFileSync(cssPath, 'utf8');

function relativeLuminance(hex) {
  const channels = hex.match(/[0-9a-f]{2}/gi).map((value) => parseInt(value, 16) / 255);
  const linear = channels.map((value) => (value <= 0.04045
    ? value / 12.92
    : ((value + 0.055) / 1.055) ** 2.4));
  return (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2]);
}

function contrastRatio(first, second) {
  const [lighter, darker] = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('shared brand tokens', () => {
  it('defines the shared shell variables in index.css', () => {
    expect(cssSource).toContain('--pl-focus-ring: rgba(251, 146, 60, 0.72);');
    expect(cssSource).toContain('--pl-focus-ring-offset: rgba(10, 10, 15, 0.92);');
    expect(cssSource).toContain('--pl-brand-ember: #fb7a55;');
    expect(cssSource).toContain("[data-theme='light'] {");
    expect(cssSource).toContain('--pl-brand-ember: #9a3412;');
    expect(cssSource).toContain('--pl-brand-ember-bright: #9a3412;');
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
    expect(T.dark.textMuted).toBe('text-[#94908a]');
    expect(T.dark.textBody).toBe('text-[#d7d2cb]');
    expect(T.dark.textAlt).toBe('text-[#c7c2bb]');
    expect(T.dark.header).toBe('bg-[#0a0a0f]/95 backdrop-blur-sm border-white/10');
    expect(T.dark.btn).toBe('bg-white/[0.04] hover:bg-white/[0.08]');
    expect(T.dark.scoreGood).toBe('text-green-400');
    expect(T.dark.diffAdd).toBe('bg-green-900/60 text-green-200');
  });

  it('keeps shared action, accent, and muted text pairs at WCAG AA contrast in both themes', () => {
    const pairs = [
      ['#210b05', '#fb7a55'], // dark primary action
      ['#ff9a7a', '#06060a'], // dark accent text
      ['#a8a29e', '#06060a'], // dark muted text
      ['#ffffff', '#9a3412'], // light primary action
      ['#9a3412', '#fffdfa'], // light accent text, including tinted surfaces
      ['#57534e', '#fffdfa'], // light muted text
    ];
    for (const [foreground, background] of pairs) {
      expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
    }
    expect(T.light.textMuted).toBe('text-slate-600');
  });

  it('maps fixed utility actions and badges to light-theme AA colors', () => {
    expect(cssSource).toContain('.pl-app-shell .text-orange-50,');
    expect(cssSource).toContain("[data-theme='light'] .text-purple-300 { color: #7e22ce; }");
    expect(cssSource).toContain(".pl-app-shell[data-theme='light'] .bg-sky-600 { background-color: #075985; }");
    expect(cssSource).toContain(".pl-app-shell[data-theme='light'] .bg-emerald-600,");
    expect(cssSource).toContain(".pl-app-shell[data-theme='light'] .bg-green-600 { background-color: #15803d; }");
    expect(cssSource).toContain(".pl-app-shell[data-theme='light'] .bg-red-500,");

    for (const background of ['#075985', '#047857', '#15803d', '#b91c1c']) {
      expect(contrastRatio('#ffffff', background)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrastRatio('#7e22ce', '#fffdfa')).toBeGreaterThanOrEqual(4.5);
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
