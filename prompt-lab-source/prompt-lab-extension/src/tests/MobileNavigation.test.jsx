import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import MobileNavigation from '../MobileNavigation.jsx';

const css = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../index.css'), 'utf8');

describe('MobileNavigation labels', () => {
  it('shows five phone tabs and hides Dual Pane below the dual-pane breakpoint', () => {
    render(
      <MobileNavigation
        primaryView="create"
        workspaceView="editor"
        openCreateView={vi.fn()}
        openSection={vi.fn()}
        setPrimaryView={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Write' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('button', { name: 'Dual Pane' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Dual' })).toBeNull();
    expect(screen.getAllByRole('button').map((b) => b.textContent.trim()))
      .toEqual(['Write', 'Library', 'Compose', 'Evaluate', 'Scratch']);
  });

  it('keeps phone labels at least 11px and tap targets at least 44px', () => {
    expect(css).toContain('grid-template-columns: repeat(5, minmax(0, 1fr))');
    expect(css).toMatch(/\.pl-mobile-nav button \{[^}]*min-height: 44px;/);
    expect(css).toMatch(/\.pl-mobile-nav button \{[^}]*font-size: 11px;/);
    expect(css).not.toContain('.pl-mobile-nav button { font-size: 0.48rem; }');
  });
});
