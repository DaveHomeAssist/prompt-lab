import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import CreateEditorPane from '../CreateEditorPane.jsx';

vi.mock('../icons.jsx', () => ({
  default: () => null,
}));

vi.mock('../MarkdownPreview.jsx', () => ({
  default: ({ text }) => <div>{text}</div>,
}));

function renderPane(overrides = {}) {
  const noop = vi.fn();
  const lib = {
    pinGoldenResponse: vi.fn(),
    clearGoldenResponse: vi.fn(),
    setGoldenThreshold: vi.fn(),
  };

  return render(
    <CreateEditorPane
      m={{
        surface: 'bg-slate-950/70',
        border: 'border-slate-800',
        borderHov: 'hover:border-slate-700',
        text: 'text-slate-50',
        textAlt: 'text-slate-200',
        textBody: 'text-slate-100',
        textSub: 'text-slate-300',
        textMuted: 'text-slate-500',
        btn: 'bg-slate-800',
        input: 'bg-slate-900',
        codeBlock: 'bg-slate-900/80',
        scoreGood: 'text-emerald-300',
        scoreBad: 'text-rose-300',
        notesBg: 'bg-amber-950/20',
        notesText: 'text-amber-200',
        diffAdd: 'bg-emerald-500/20',
        diffDel: 'bg-rose-500/20',
        diffEq: 'bg-slate-800',
      }}
      compact={false}
      pageScroll={false}
      colorMode="dark"
      quickInject={[]}
      recentPrompts={[]}
      loadEntry={noop}
      copy={noop}
      bumpUse={noop}
      showCreateContext
      currentEntry={{ id: 'entry-1', title: 'Voice Memo Cleanup', collection: 'Ops' }}
      suggestedSaveTitle="Voice Memo Cleanup"
      canSavePanel
      openSavePanel={noop}
      openSection={noop}
      raw="Draft prompt body"
      setRaw={noop}
      updateCursor={noop}
      mdPreview={false}
      setMdPreview={noop}
      wc={3}
      score={null}
      inp="border border-slate-700 text-slate-50"
      lintIssues={[]}
      lintOpen={false}
      setLintOpen={noop}
      handleLintFix={noop}
      enhMode="balanced"
      setEnhMode={noop}
      enhance={noop}
      runAllCases={noop}
      clearEditor={noop}
      cancelEnhance={noop}
      loading={false}
      runningCases={false}
      batchProgress={{ active: false, completed: 0, total: 0 }}
      currentTestCases={[]}
      hasSavablePrompt
      primaryModKey="Ctrl"
      streaming={false}
      optimisticSaveVisible={false}
      showSave={false}
      error={{
        userMessage: 'The provider stalled before returning a usable draft.',
        suggestions: ['Retry with the same provider'],
        actions: ['retry'],
      }}
      openOptions={noop}
      enhanced="Refined prompt output"
      setEnhanced={noop}
      enhMdPreview={false}
      setEnhMdPreview={noop}
      resultTab="improved"
      setResultTab={noop}
      resultTabs={[
        { id: 'improved', label: 'Improved' },
        { id: 'diff', label: 'Diff' },
      ]}
      activeResultTab="improved"
      copyBtn="border border-slate-700 text-slate-100"
      showInlineSaveBar={false}
      saveTitle=""
      setSaveTitle={noop}
      quickSave={noop}
      editingId="entry-1"
      goldenResponse={null}
      goldenSimilarity={0.91}
      goldenThreshold={0.8}
      goldenVerdict="pass"
      comparisonText="Comparison sample"
      comparisonSourceLabel="Latest run"
      lib={lib}
      variants={[]}
      showNotes={false}
      notes=""
      evalRuns={[]}
      libraryCount={1}
      evalRunCount={0}
      onLoadQuickStartPrompt={noop}
      onOpenEvaluate={noop}
      showEvalHistory={false}
      setShowEvalHistory={noop}
      streamPreview=""
      showDiffUpgradeHint
      onUnlockDiff={noop}
      runCasesLocked={false}
      {...overrides}
    />
  );
}

describe('CreateEditorPane', () => {
  it('uses the shared ember and gold accents across the workbench body', () => {
    renderPane();

    expect(screen.getByText('Editing')).toHaveClass('text-orange-400');
    expect(screen.getByRole('button', { name: 'Write' })).toHaveClass('bg-orange-500/90', 'text-white');
    expect(screen.getByRole('tab', { name: 'Improved' })).toHaveClass('bg-orange-500/90', 'text-white');
    expect(screen.getByRole('button', { name: 'Try Again' })).toHaveClass('bg-orange-500/90', 'hover:bg-orange-400');
    expect(screen.getByRole('button', { name: 'Unlock Diff' })).toHaveClass('text-amber-300', 'hover:text-amber-200');
  });

  it('shows an intentional workbench empty state before any output exists', () => {
    renderPane({
      currentEntry: null,
      suggestedSaveTitle: 'Untitled prompt',
      raw: '',
      wc: 0,
      error: null,
      enhanced: '',
      editingId: null,
      goldenResponse: null,
      showDiffUpgradeHint: false,
    });

    expect(screen.getByText('Workbench flow')).toBeInTheDocument();
    expect(screen.getByText('Start with a draft or load a starter.')).toBeInTheDocument();
    expect(screen.getByText('Ctrl+Enter to refine')).toBeInTheDocument();
    expect(screen.getByText(/Save strong versions to Library/i)).toBeInTheDocument();
  });

  it('shows an activation runway with a starter-draft action for first-run users', () => {
    const onLoadQuickStartPrompt = vi.fn();

    renderPane({
      currentEntry: null,
      suggestedSaveTitle: 'Untitled prompt',
      raw: '',
      wc: 0,
      error: null,
      enhanced: '',
      editingId: null,
      goldenResponse: null,
      libraryCount: 0,
      evalRunCount: 0,
      onLoadQuickStartPrompt,
      showDiffUpgradeHint: false,
    });

    expect(screen.getByText('Activation runway')).toBeInTheDocument();
    expect(screen.getByText('0/3 milestones')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Load Starter Draft' }));

    expect(onLoadQuickStartPrompt).toHaveBeenCalledTimes(1);
  });

  it('guides saved-but-unreviewed users toward Evaluate', () => {
    const onOpenEvaluate = vi.fn();

    renderPane({
      currentEntry: null,
      suggestedSaveTitle: 'Untitled prompt',
      raw: 'Draft prompt body',
      error: null,
      enhanced: '',
      editingId: null,
      goldenResponse: null,
      libraryCount: 1,
      evalRunCount: 0,
      onOpenEvaluate,
      showDiffUpgradeHint: false,
    });

    expect(screen.getByText('2/3 milestones')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open Evaluate' }));

    expect(onOpenEvaluate).toHaveBeenCalledTimes(1);
  });
});
