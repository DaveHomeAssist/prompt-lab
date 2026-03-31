import { describe, expect, it } from 'vitest';
import {
  PRIMARY_VIEWS,
  SUBVIEWS,
  SHORTCUTS,
  deriveActiveSection,
  deriveTab,
  resolveSectionState,
  resolveTabState,
  resolveRouteState,
  stateToRoute,
  matchShortcut,
  buildCommandActions,
  filterCommands,
} from '../lib/navigationRegistry.js';

// ── Helpers ────────────────────────────────────────────────────────

function fakeKeyEvent(key, { meta = false, ctrl = false, target = 'DIV' } = {}) {
  return { key, metaKey: meta, ctrlKey: ctrl, target: { tagName: target }, preventDefault: () => {} };
}

// ── Tests ──────────────────────────────────────────────────────────

describe('navigationRegistry', () => {
  it('PRIMARY_VIEWS and SUBVIEWS are consistent', () => {
    const primaryIds = PRIMARY_VIEWS.map((v) => v.id);
    expect(primaryIds).toContain('create');
    expect(primaryIds).toContain('runs');
    expect(primaryIds).toContain('notebook');

    // Every primary view has a subviews entry
    for (const id of primaryIds) {
      expect(SUBVIEWS[id]).toBeDefined();
      expect(Array.isArray(SUBVIEWS[id])).toBe(true);
    }

    // Subview ids are unique within their parent
    for (const [, subviews] of Object.entries(SUBVIEWS)) {
      const ids = subviews.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('deriveTab matches the original useUiState tab computation', () => {
    expect(deriveTab('notebook', 'editor', 'history')).toBe('pad');
    expect(deriveTab('runs', 'editor', 'compare')).toBe('abtest');
    expect(deriveTab('runs', 'editor', 'history')).toBe('history');
    expect(deriveTab('create', 'composer', 'history')).toBe('composer');
    expect(deriveTab('create', 'editor', 'history')).toBe('editor');
  });

  it('resolveTabState round-trips through deriveTab', () => {
    const tabs = ['editor', 'composer', 'abtest', 'history', 'pad'];
    for (const tab of tabs) {
      const state = resolveTabState(tab);
      const derived = deriveTab(
        state.primaryView,
        state.workspaceView || 'editor',
        state.runsView || 'history',
      );
      expect(derived).toBe(tab);
    }
  });

  it('derives the correct header section from view state', () => {
    expect(deriveActiveSection('create', 'editor')).toBe('create');
    expect(deriveActiveSection('create', 'library')).toBe('library');
    expect(deriveActiveSection('runs', 'editor')).toBe('evaluate');
    expect(deriveActiveSection('notebook', 'editor')).toBe('create');
  });

  it('resolves section ids and route paths through the shared contract', () => {
    expect(resolveSectionState('create')).toEqual({ primaryView: 'create', workspaceView: 'editor' });
    expect(resolveSectionState('library')).toEqual({ primaryView: 'create', workspaceView: 'library' });
    expect(resolveSectionState('evaluate')).toEqual({ primaryView: 'runs' });
    expect(resolveSectionState('experiments')).toEqual({ primaryView: 'runs' });

    expect(resolveRouteState('/library')).toEqual({ primaryView: 'create', workspaceView: 'library' });
    expect(resolveRouteState('/compare')).toEqual({ primaryView: 'runs', runsView: 'compare' });
    expect(resolveRouteState('/unknown')).toBe(null);

    expect(stateToRoute('create', 'editor', 'history')).toBe('/');
    expect(stateToRoute('create', 'library', 'history')).toBe('/library');
    expect(stateToRoute('runs', 'editor', 'compare')).toBe('/compare');
    expect(stateToRoute('notebook', 'editor', 'history')).toBe('/pad');
  });

  // ── Cmd/Ctrl+K ────────────────────────────────────────────────────

  it('Cmd/Ctrl+K matches cmdPalette shortcut', () => {
    const mac = matchShortcut(fakeKeyEvent('k', { meta: true }));
    expect(mac).not.toBe(null);
    expect(mac.id).toBe('cmdPalette');

    const win = matchShortcut(fakeKeyEvent('k', { ctrl: true }));
    expect(win).not.toBe(null);
    expect(win.id).toBe('cmdPalette');

    // Plain 'k' should NOT match
    expect(matchShortcut(fakeKeyEvent('k'))).toBe(null);
  });

  // ── ? shortcut ────────────────────────────────────────────────────

  it('? matches shortcuts toggle, but not in inputs', () => {
    const match = matchShortcut(fakeKeyEvent('?'));
    expect(match).not.toBe(null);
    expect(match.id).toBe('shortcuts');

    // Should NOT fire inside textarea
    expect(matchShortcut(fakeKeyEvent('?', { target: 'TEXTAREA' }))).toBe(null);
    expect(matchShortcut(fakeKeyEvent('?', { target: 'INPUT' }))).toBe(null);
  });

  // ── Esc ───────────────────────────────────────────────────────────

  it('Escape matches escape shortcut', () => {
    const match = matchShortcut(fakeKeyEvent('Escape'));
    expect(match).not.toBe(null);
    expect(match.id).toBe('escape');
  });

  // ── View transitions via command palette ──────────────────────────

  it('buildCommandActions produces filterable navigation entries', () => {
    let navigated = null;
    const actions = buildCommandActions({
      enhance: () => {},
      save: () => {},
      clear: () => {},
      goEditor: () => { navigated = 'editor'; },
      goLibrary: () => { navigated = 'library'; },
      goBuild: () => { navigated = 'build'; },
      goRuns: () => { navigated = 'runs'; },
      goCompare: () => { navigated = 'compare'; },
      goNotebook: () => { navigated = 'notebook'; },
      toggleTheme: () => {},
      exportLib: () => {},
      openSettings: () => {},
      openOptions: () => {},
      showShortcuts: () => {},
    });

    expect(actions.length).toBe(14);

    // Filter by query
    const filtered = filterCommands(actions, 'notebook');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].label).toBe('Open Notebook');

    // Execute a navigation action
    filtered[0].action();
    expect(navigated).toBe('notebook');
  });

  it('buildCommandActions omits entries with missing handlers', () => {
    const actions = buildCommandActions({
      enhance: () => {},
      // everything else undefined
    });
    expect(actions).toHaveLength(1);
    expect(actions[0].label).toBe('Enhance Prompt');
  });

  it('SHORTCUTS have unique ids', () => {
    const ids = SHORTCUTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
