import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The registry stays real by default; individual tests can force every route
// to be unknown to prove the recovery cannot redirect-loop (App.test.jsx
// mocks resolveRouteState to always return null, which OOM'd the first cut
// of this recovery).
const routeStateOverride = vi.hoisted(() => ({ current: null }));
vi.mock('../lib/navigationRegistry.js', async () => {
  const actual = await vi.importActual('../lib/navigationRegistry.js');
  return {
    ...actual,
    resolveRouteState: (pathname) => (
      routeStateOverride.current ? routeStateOverride.current(pathname) : actual.resolveRouteState(pathname)
    ),
  };
});

import useRouteSync from '../hooks/useRouteSync.js';

// L-2: an unknown app route used to fall through resolveRouteState silently --
// navigation state kept its previous workspace and the URL was quietly
// rewritten, with no signal that the link was dead. The hook must recover to
// the canonical Write route and report the unknown path to its caller.

function Harness({ hookProps }) {
  const location = useLocation();
  useRouteSync(hookProps);
  return <div data-testid="pathname">{location.pathname}</div>;
}

function renderRouteSync(initialPath, overrides = {}) {
  const hookProps = {
    primaryView: 'create',
    setPrimaryView: vi.fn(),
    workspaceView: 'editor',
    setWorkspaceView: vi.fn(),
    runsView: 'history',
    setRunsView: vi.fn(),
    splitPane: 'editor',
    setSplitPane: vi.fn(),
    compact: false,
    ...overrides,
  };
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Harness hookProps={hookProps} />
    </MemoryRouter>,
  );
  return hookProps;
}

describe('useRouteSync route recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routeStateOverride.current = null;
  });

  it('applies a known route mapping without reporting anything', async () => {
    const props = renderRouteSync('/library', { onUnknownRoute: vi.fn() });

    await waitFor(() => {
      expect(props.setWorkspaceView).toHaveBeenCalledWith('library');
    });
    expect(props.onUnknownRoute).not.toHaveBeenCalled();
    expect(screen.getByTestId('pathname')).toHaveTextContent('/library');
  });

  it('recovers an unknown route to the Write workspace and reports it', async () => {
    const props = renderRouteSync('/definitely-not-a-route', { onUnknownRoute: vi.fn() });

    await waitFor(() => {
      expect(screen.getByTestId('pathname')).toHaveTextContent(/^\/$/);
    });
    expect(props.onUnknownRoute).toHaveBeenCalledWith('/definitely-not-a-route');
    // Recovery lands on the canonical mapping, not the pre-navigation state.
    await waitFor(() => {
      expect(props.setPrimaryView).toHaveBeenCalledWith('create');
      expect(props.setWorkspaceView).toHaveBeenCalledWith('editor');
    });
  });

  it('recovers without a reporter wired in', async () => {
    renderRouteSync('/broken/deep/link');

    await waitFor(() => {
      expect(screen.getByTestId('pathname')).toHaveTextContent(/^\/$/);
    });
  });

  it('reports a dead link once, not once per effect pass', async () => {
    const props = renderRouteSync('/dead-link', { onUnknownRoute: vi.fn() });

    await waitFor(() => {
      expect(screen.getByTestId('pathname')).toHaveTextContent(/^\/$/);
    });
    expect(props.onUnknownRoute).toHaveBeenCalledTimes(1);
  });

  // Regression for the first cut of this recovery: App.test.jsx mocks
  // resolveRouteState to return null for EVERY route (including '/'), and an
  // unconditional replaceRoute('/') retry redirect-looped until the vitest
  // worker ran out of heap. When even the fallback route cannot resolve, the
  // hook must go quiet instead of looping.
  it('never redirect-loops when no route resolves at all', async () => {
    routeStateOverride.current = () => null;
    const props = renderRouteSync('/', { onUnknownRoute: vi.fn() });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(props.onUnknownRoute).not.toHaveBeenCalled();
    expect(screen.getByTestId('pathname')).toHaveTextContent(/^\/$/);
  });

  it('attempts recovery once when the fallback itself cannot resolve', async () => {
    routeStateOverride.current = () => null;
    const props = renderRouteSync('/dead-link', { onUnknownRoute: vi.fn() });

    await waitFor(() => {
      expect(screen.getByTestId('pathname')).toHaveTextContent(/^\/$/);
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    // One report, one redirect, then quiet — no loop even though '/' is
    // also unresolvable in this environment.
    expect(props.onUnknownRoute).toHaveBeenCalledTimes(1);
  });

  it.each(['/pack=encoded-pack', '/share=encoded-prompt'])(
    'preserves the shared payload route %s until persistence consumes it',
    async (initialPath) => {
      const onUnknownRoute = vi.fn();
      const hookProps = {
        primaryView: 'create',
        setPrimaryView: vi.fn(),
        workspaceView: 'editor',
        setWorkspaceView: vi.fn(),
        runsView: 'history',
        setRunsView: vi.fn(),
        splitPane: 'editor',
        setSplitPane: vi.fn(),
        compact: false,
        preserveSharedHash: true,
        onUnknownRoute,
      };
      const view = render(
        <MemoryRouter initialEntries={[initialPath]}>
          <Harness hookProps={hookProps} />
        </MemoryRouter>,
      );

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(screen.getByTestId('pathname')).toHaveTextContent(initialPath);
      expect(onUnknownRoute).not.toHaveBeenCalled();

      view.rerender(
        <MemoryRouter initialEntries={[initialPath]}>
          <Harness hookProps={{ ...hookProps, preserveSharedHash: false }} />
        </MemoryRouter>,
      );

      await waitFor(() => {
        expect(screen.getByTestId('pathname')).toHaveTextContent(/^\/$/);
      });
      expect(onUnknownRoute).toHaveBeenCalledWith(initialPath);
    },
  );
});
