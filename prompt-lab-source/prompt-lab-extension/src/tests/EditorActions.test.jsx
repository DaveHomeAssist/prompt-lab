import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EditorActions from '../EditorActions.jsx';
import { GENERATION_STORAGE_KEY } from '../lib/generationOptions.js';
vi.mock('../icons.jsx', () => ({ default: () => null }));

const baseProps = {
  m: { input: 'bg-slate-900', text: 'text-slate-100', dangerGhost: 'border border-red-500/30 text-red-300' },
  enhMode: 'expanded', onEnhanceModeChange: vi.fn(), onEnhance: vi.fn(), onRunCases: vi.fn(),
  onSave: vi.fn(), onClear: vi.fn(), loading: false, hasInput: true, runningCases: false,
  batchProgress: { active: false, completed: 0, total: 0 }, testCaseCount: 3, hasSavablePrompt: true,
  onCancelEnhance: vi.fn(), enhanceShortcutLabel: 'Cmd+Enter',
};
function Harness() {
  const [mode, setMode] = useState('expanded');
  return <EditorActions {...baseProps} enhMode={mode} onEnhanceModeChange={setMode} />;
}

describe('EditorActions', () => {
  beforeEach(() => { localStorage.removeItem(GENERATION_STORAGE_KEY); vi.clearAllMocks(); });
  it('demotes the destructive action to Reset Draft', () => {
    render(<EditorActions {...baseProps} />);
    expect(screen.getByRole('button', { name: /reset draft/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /refine prompt cmd\+enter/i })).toBeInTheDocument();
  });
  it('shows cancel while enhance is in flight and disables generation choices', () => {
    render(<EditorActions {...baseProps} loading />);
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Task type')).toBeDisabled();
    expect(screen.getByLabelText('Intended destination')).toBeDisabled();
  });
  it('uses independent clean labels and shared ember/gold action styling', () => {
    render(<EditorActions {...baseProps} />);
    expect(screen.getByLabelText('Task type')).toHaveValue('general');
    expect(screen.getByLabelText('Intended destination')).toHaveValue('general');
    expect(screen.getByLabelText('Preferred primary candidate')).toHaveValue('expanded');
    expect(screen.getByRole('option', { name: 'Claude' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'ChatGPT' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '⚖️ Balanced' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /refine prompt cmd\+enter/i })).toHaveClass('pl-primary-button');
    expect(screen.getByRole('button', { name: /test enhancer/i })).toHaveClass('border', 'border-amber-400/35', 'bg-amber-500/15', 'text-amber-100');
  });
  it('keeps the locked Pro action inside the warm shared accent system', () => {
    render(<EditorActions {...baseProps} runCasesLocked />);
    expect(screen.getByRole('button', { name: /test enhancer pro/i })).toHaveClass('border', 'border-orange-400/35', 'bg-orange-500/12', 'text-orange-100');
    expect(screen.getByText('Pro')).toHaveClass('bg-orange-500/20', 'text-orange-50');
  });
  it('persists independent task, target, strategy and budget choices', () => {
    const mounted = render(<Harness />);
    fireEvent.change(screen.getByLabelText('Task type'), { target: { value: 'code' } });
    fireEvent.change(screen.getByLabelText('Intended destination'), { target: { value: 'claude' } });
    fireEvent.click(screen.getByText(/Generation options/));
    fireEvent.change(screen.getByLabelText('Preferred primary candidate'), { target: { value: 'rebuilt' } });
    fireEvent.change(screen.getByLabelText('Generation output budget'), { target: { value: '8192' } });
    expect(JSON.parse(localStorage.getItem(GENERATION_STORAGE_KEY))).toMatchObject({
      task: 'code', target: 'claude', strategy: 'rebuilt', budget: 8192, alternatives: false,
    });
    mounted.unmount();
    render(<EditorActions {...baseProps} enhMode="rebuilt" />);
    expect(screen.getByLabelText('Task type')).toHaveValue('code');
    expect(screen.getByLabelText('Intended destination')).toHaveValue('claude');
    expect(screen.getByLabelText('Preferred primary candidate')).toHaveValue('rebuilt');
  });
  it('makes shortening and JSON explicit source transformations', () => {
    render(<EditorActions {...baseProps} />);
    fireEvent.click(screen.getByText(/Generation options/));
    fireEvent.click(screen.getByRole('button', { name: 'Shorten source' }));
    expect(baseProps.onEnhance).toHaveBeenLastCalledWith(undefined, { modeId: 'shorten' });
    fireEvent.click(screen.getByRole('button', { name: 'Format source as JSON' }));
    expect(baseProps.onEnhance).toHaveBeenLastCalledWith(undefined, { modeId: 'json' });
  });
});
