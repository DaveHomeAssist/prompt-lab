import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import EditorActions from '../EditorActions.jsx';

vi.mock('../icons.jsx', () => ({
  default: () => null,
}));

describe('EditorActions', () => {
  const baseProps = {
    m: {
      input: 'bg-slate-900',
      text: 'text-slate-100',
      dangerGhost: 'border border-red-500/30 text-red-300',
    },
    enhMode: 'balanced',
    onEnhanceModeChange: vi.fn(),
    onEnhance: vi.fn(),
    onRunCases: vi.fn(),
    onSave: vi.fn(),
    onClear: vi.fn(),
    loading: false,
    hasInput: true,
    runningCases: false,
    batchProgress: { active: false, completed: 0, total: 0 },
    testCaseCount: 3,
    hasSavablePrompt: true,
    onCancelEnhance: vi.fn(),
    enhanceShortcutLabel: 'Cmd+Enter',
  };

  it('demotes the destructive action to Reset Draft', () => {
    render(<EditorActions {...baseProps} />);

    expect(screen.getByRole('button', { name: /reset draft/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /refine prompt cmd\+enter/i })).toBeInTheDocument();
  });

  it('shows cancel while enhance is in flight', () => {
    render(<EditorActions {...baseProps} loading />);

    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });

  it('uses clean mode labels without emoji prefixes and shared ember/gold action styling', () => {
    render(<EditorActions {...baseProps} />);

    expect(screen.getByRole('option', { name: 'Balanced' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Claude' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'ChatGPT' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '⚖️ Balanced' })).not.toBeInTheDocument();

    expect(screen.getByRole('button', { name: /refine prompt cmd\+enter/i })).toHaveClass(
      'pl-primary-button'
    );
    expect(screen.getByRole('button', { name: /run cases/i })).toHaveClass(
      'border',
      'border-amber-400/35',
      'bg-amber-500/15',
      'text-amber-100'
    );
  });

  it('keeps the locked Pro action inside the warm shared accent system', () => {
    render(<EditorActions {...baseProps} runCasesLocked />);

    expect(screen.getByRole('button', { name: /run cases pro/i })).toHaveClass(
      'border',
      'border-orange-400/35',
      'bg-orange-500/12',
      'text-orange-100'
    );
    expect(screen.getByText('Pro')).toHaveClass(
      'bg-orange-500/20',
      'text-orange-50'
    );
  });
  it('groups secondary actions under More and hides Save when the result owns it', () => {
    const onClear = vi.fn();
    const onNewPrompt = vi.fn();
    render(<EditorActions {...baseProps} onClear={onClear} onNewPrompt={onNewPrompt} groupSecondary showSave={false} hasResult />);
    const more = screen.getByTestId('editor-more-actions');
    expect(screen.queryByRole('button', { name: 'Save as new prompt' })).toBeNull();
    expect(screen.getByTestId('refine-action')).toHaveTextContent('Refine again Cmd+Enter');
    expect(more).toContainElement(screen.getByRole('button', { name: 'Run Cases' }));
    expect(more).toContainElement(screen.getByRole('button', { name: /New prompt/ }));
    more.open = true;
    fireEvent.click(screen.getByRole('button', { name: /Reset Draft/ }));
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(more.open).toBe(false);
  });

  it('closes the More menu on Escape', () => {
    render(<EditorActions {...baseProps} groupSecondary />);
    const more = screen.getByTestId('editor-more-actions');
    more.open = true;
    fireEvent.keyDown(screen.getByRole('button', { name: 'Run Cases' }), { key: 'Escape' });
    expect(more.open).toBe(false);
  });

  it('keeps every action inline in the stacked layout', () => {
    render(<EditorActions {...baseProps} />);
    expect(screen.queryByTestId('editor-more-actions')).toBeNull();
    expect(screen.getByRole('button', { name: 'Save as new prompt' })).toBeInTheDocument();
    expect(screen.getByTestId('refine-action')).toHaveTextContent('Refine Prompt Cmd+Enter');
  });
});
