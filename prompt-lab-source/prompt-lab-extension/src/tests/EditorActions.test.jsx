import { render, screen } from '@testing-library/react';
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
      'bg-orange-500/90',
      'hover:bg-orange-400'
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
});
