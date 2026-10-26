import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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

  it('uses an editor-first weighted split when both panes are active', () => {
    const { container } = renderWorkspace({ showLibraryPane: true });
    expect(container.firstChild.className).toContain('grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]');
    expect(screen.getByText('Editor pane')).toBeInTheDocument();
    expect(screen.getByText('Library pane')).toBeInTheDocument();
  });

  it('lets compact single-pane content participate in the main scroll flow', () => {
    const { container } = renderWorkspace({ compact: true, pageScroll: false });
    expect(container.firstChild.className).not.toContain('overflow-hidden');
    expect(screen.getByLabelText('Prompt editor workspace').className).not.toContain('overflow-hidden');
  });
});

describe('MainWorkspace side pane', () => {
  it('places the side pane in a resizable column beside the editor', () => {
    const { container } = renderWorkspace({ sidePane: <div>Side notes</div>, sidePaneMode: 'column', sidePaneWidth: 400 });
    expect(container.firstChild).toHaveAttribute('data-side-pane', 'column');
    expect(container.firstChild.style.gridTemplateColumns).toBe('minmax(0, 1fr) auto 400px');
    expect(screen.getByRole('separator', { name: 'Resize Scratch panel' })).toHaveAttribute('aria-valuenow', '400');
    expect(screen.getByText('Side notes')).toBeInTheDocument();
  });

  it('reports keyboard resizing through onSidePaneResize', () => {
    const onSidePaneResize = vi.fn();
    renderWorkspace({ sidePane: <div>Side notes</div>, sidePaneWidth: 360, onSidePaneResize });
    fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize Scratch panel' }), { key: 'ArrowLeft' });
    expect(onSidePaneResize).toHaveBeenCalledWith(384);
  });

  it('floats the side pane without a column or resizer in overlay mode', () => {
    const { container } = renderWorkspace({ sidePane: <div>Side notes</div>, sidePaneMode: 'overlay' });
    expect(container.firstChild).toHaveAttribute('data-side-pane', 'overlay');
    expect(container.firstChild.style.gridTemplateColumns).toBe('');
    expect(screen.queryByRole('separator')).toBeNull();
    expect(screen.getByText('Side notes')).toBeInTheDocument();
  });

  it('never shows the side pane next to the Library pane', () => {
    renderWorkspace({ showLibraryPane: true, sidePane: <div>Side notes</div> });
    expect(screen.queryByText('Side notes')).toBeNull();
  });
});
