import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import MainWorkspace from '../MainWorkspace.jsx';

function renderWorkspace(overrides = {}) {
  return render(
    <MainWorkspace
      m={{ border: 'border' }}
      compact={false}
      isWeb={false}
      showEditorPane
      showLibraryPane={false}
      editorPane={<div>Editor pane</div>}
      libraryPane={<div>Library pane</div>}
      {...overrides}
    />
  );
}

describe('MainWorkspace layout', () => {
  it('uses a single-column grid when only the editor pane is shown', () => {
    const { container } = renderWorkspace();
    expect(container.firstChild.className).toContain('grid-cols-1');
    expect(screen.getByText('Editor pane')).toBeInTheDocument();
    expect(screen.queryByText('Library pane')).not.toBeInTheDocument();
  });

  it('uses the two-column grid only when both panes are active', () => {
    const { container } = renderWorkspace({ showLibraryPane: true });
    expect(container.firstChild.className).toContain('grid-cols-[minmax(0,1fr)_minmax(0,1fr)]');
    expect(screen.getByText('Editor pane')).toBeInTheDocument();
    expect(screen.getByText('Library pane')).toBeInTheDocument();
  });
});
