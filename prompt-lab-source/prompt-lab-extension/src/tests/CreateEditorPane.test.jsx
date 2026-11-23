import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CreateEditorPane, { WRITE_SHORT_QUERY } from '../CreateEditorPane.jsx';

const css = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../index.css'), 'utf8');

vi.mock('../icons.jsx', () => ({ default: () => null }));
vi.mock('../MarkdownPreview.jsx', () => ({ default: ({ text }) => <div>{text}</div> }));

function renderPane(overrides = {}) {
  const noop = vi.fn();
  const lib = { pinGoldenResponse: vi.fn(), clearGoldenResponse: vi.fn(), setGoldenThreshold: vi.fn() };
  return render(<CreateEditorPane
    m={{ surface: 'bg-slate-950/70', border: 'border-slate-800', borderHov: 'hover:border-slate-700',
      text: 'text-slate-50', textAlt: 'text-slate-200', textBody: 'text-slate-100', textSub: 'text-slate-300',
      textMuted: 'text-slate-500', btn: 'bg-slate-800', input: 'bg-slate-900', codeBlock: 'bg-slate-900/80',
      scoreGood: 'text-emerald-300', scoreBad: 'text-rose-300', notesBg: 'bg-amber-950/20', notesText: 'text-amber-200',
      diffAdd: 'bg-emerald-500/20', diffDel: 'bg-rose-500/20', diffEq: 'bg-slate-800' }}
    compact={false} pageScroll={false} colorMode="dark" quickInject={[]} recentPrompts={[]}
    loadEntry={noop} copy={noop} bumpUse={noop} showCreateContext
    currentEntry={{ id: 'entry-1', title: 'Voice Memo Cleanup', collection: 'Ops' }}
    suggestedSaveTitle="Voice Memo Cleanup" canSavePanel openSavePanel={noop} openSection={noop}
    raw="Draft prompt body" setRaw={noop} updateCursor={noop} mdPreview={false} setMdPreview={noop}
    wc={3} score={null} inp="border border-slate-700 text-slate-50" lintIssues={[]} lintOpen={false}
    setLintOpen={noop} handleLintFix={noop} enhMode="balanced" setEnhMode={noop} enhance={noop}
    runAllCases={noop} clearEditor={noop} cancelEnhance={noop} loading={false} runningCases={false}
    batchProgress={{ active: false, completed: 0, total: 0 }} currentTestCases={[]} hasSavablePrompt
    primaryModKey="Ctrl" streaming={false} optimisticSaveVisible={false} showSave={false}
    error={{ userMessage: 'The provider stalled before returning a usable draft.', suggestions: ['Retry with the same provider'], actions: ['retry'] }}
    openOptions={noop} enhanced="Refined prompt output" setEnhanced={noop} enhMdPreview={false} setEnhMdPreview={noop}
    resultTab="improved" setResultTab={noop} resultTabs={[{ id: 'improved', label: 'Improved' }, { id: 'diff', label: 'Diff' }]}
    activeResultTab="improved" copyBtn="border border-slate-700 text-slate-100" showInlineSaveBar={false}
    saveTitle="" setSaveTitle={noop} quickSave={noop} editingId="entry-1" goldenResponse={null}
    goldenSimilarity={0.91} goldenThreshold={0.8} goldenVerdict="pass" comparisonText="Comparison sample"
    comparisonSourceLabel="Latest run" lib={lib} variants={[]} showNotes={false} notes="" evalRuns={[]}
    libraryCount={1} evalRunCount={0} onLoadQuickStartPrompt={noop} onOpenEvaluate={noop}
    showEvalHistory={false} setShowEvalHistory={noop} streamPreview=""
    runCasesLocked={false} {...overrides} />);
}

describe('CreateEditorPane', () => {
  beforeEach(() => localStorage.clear());

  it('uses the shared ember and gold accents across the workbench body', () => {
    renderPane();
    expect(screen.queryByText('Editing')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Write' })).toHaveClass('bg-orange-500/90', 'text-white');
    expect(screen.getByRole('tab', { name: 'Prompt' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'Try Again' })).toHaveClass('bg-orange-500/90', 'hover:bg-orange-400');
    expect(screen.getByRole('tab', { name: 'Side-by-side' })).toBeInTheDocument();
  });
  it('shows onboarding only while the library is empty, and remembers a dismissal', () => {
    renderPane({ currentEntry: null, suggestedSaveTitle: 'Untitled prompt', raw: '', wc: 0,
      error: null, enhanced: '', editingId: null, goldenResponse: null, libraryCount: 0 });
    expect(screen.getByTestId('write-onboarding')).toBeInTheDocument();
    expect(screen.getByText('Workbench flow')).toBeInTheDocument();
    expect(screen.getByText('Start with a draft or load a starter.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByTestId('write-onboarding')).not.toBeInTheDocument();
    expect(localStorage.getItem('pl2-write-onboarding-dismissed')).toBe('true');
  });

  it('hides onboarding once the library has a prompt', () => {
    renderPane({ currentEntry: null, suggestedSaveTitle: 'Untitled prompt', raw: '', wc: 0,
      error: null, enhanced: '', editingId: null, goldenResponse: null, libraryCount: 1 });
    expect(screen.queryByTestId('write-onboarding')).not.toBeInTheDocument();
    expect(screen.queryByText('Workbench flow')).not.toBeInTheDocument();
  });

  it('keeps a dismissed onboarding card hidden on the next visit', () => {
    localStorage.setItem('pl2-write-onboarding-dismissed', 'true');
    renderPane({ currentEntry: null, raw: '', wc: 0, error: null, enhanced: '', editingId: null, libraryCount: 0 });
    expect(screen.queryByTestId('write-onboarding')).not.toBeInTheDocument();
  });
  it('shows an activation runway with a starter-draft action for first-run users', () => {
    const onLoadQuickStartPrompt = vi.fn();
    renderPane({ currentEntry: null, suggestedSaveTitle: 'Untitled prompt', raw: '', wc: 0, error: null,
      enhanced: '', editingId: null, goldenResponse: null, libraryCount: 0, evalRunCount: 0,
      onLoadQuickStartPrompt });
    expect(screen.getByText('Activation runway')).toBeInTheDocument();
    expect(screen.getByText('0/3 milestones')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load Starter Draft' }));
    expect(onLoadQuickStartPrompt).toHaveBeenCalledTimes(1);
  });
  it('labels partial failed output separately from completed results', () => {
    renderPane({ enhanced: '', streamPreview: 'Incomplete fixture output', loading: false });
    expect(screen.getByText('Incomplete response — request failed')).toBeInTheDocument();
    expect(screen.getByText('Incomplete fixture output')).toBeInTheDocument();
  });

  it('names a cut-off response and offers continue and a larger retry', () => {
    const enhance = vi.fn();
    renderPane({
      enhanced: '# handle-intake',
      streamPreview: '',
      error: {
        userMessage: 'Response was cut off at the output limit',
        code: 'output_truncated',
        category: 'provider',
        suggestions: ['Continue asks the model to finish from the cutoff and stitches the text.'],
        actions: ['continue', 'retry_larger'],
      },
      enhance,
      resultMeta: { schemaVersion: 2, primaryId: 'expanded', partial: true, candidates: [{ id: 'expanded', label: 'Expanded', content: '# handle-intake' }] },
    });
    expect(screen.getByText('Response was cut off at the output limit')).toBeInTheDocument();
    expect(screen.getByTestId('partial-result')).toHaveTextContent('Partial result');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry with a larger limit' }));
    expect(enhance).toHaveBeenNthCalledWith(1, undefined, { continue: true });
    expect(enhance).toHaveBeenNthCalledWith(2, undefined, { retryLarger: true });
  });

  it('saves the first draft without passing the click event as a Library entry', () => {
    const openSavePanel = vi.fn();
    renderPane({ raw: 'A first draft', currentEntry: null, enhanced: '', error: null, libraryCount: 0, evalRunCount: 0, openSavePanel });
    fireEvent.click(screen.getByRole('button', { name: 'Save First Prompt' }));
    expect(openSavePanel).toHaveBeenCalledWith();
  });

  it('guides an empty library toward the first save, then hides that card once a prompt exists', () => {
    const openSavePanel = vi.fn();
    const first = renderPane({ currentEntry: null, suggestedSaveTitle: 'Untitled prompt', raw: 'Draft prompt body',
      error: null, enhanced: '', editingId: null, goldenResponse: null, libraryCount: 0,
      evalRunCount: 0, openSavePanel });
    expect(screen.getByText('1/3 milestones')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save First Prompt' }));
    expect(openSavePanel).toHaveBeenCalledTimes(1);
    first.unmount();

    renderPane({ currentEntry: null, suggestedSaveTitle: 'Untitled prompt', raw: 'Draft prompt body',
      error: null, enhanced: '', editingId: null, goldenResponse: null, libraryCount: 1, evalRunCount: 0 });
    expect(screen.queryByText('Activation runway')).not.toBeInTheDocument();
  });

  it('caps the write column and pins Refine in one scroll column on short windows', () => {
    expect(css).toContain('.pl-write-column { align-self: center; width: min(100%, 60rem);');
    expect(css).toContain('.pl-write-actions { position: sticky; bottom: 0;');
    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: query === WRITE_SHORT_QUERY,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const { container } = renderPane({
      libraryCount: 0, error: null, enhanced: '', currentEntry: null, editingId: null,
    });
    const column = container.querySelector('.pl-write-column.is-pinned-actions');
    const scroll = container.querySelector('.pl-write-scroll');
    const actions = container.querySelector('.pl-write-actions');
    expect(column).not.toBeNull();
    expect(scroll).toContainElement(screen.getByTestId('prompt-input'));
    expect(scroll).toContainElement(screen.getByTestId('write-onboarding'));
    expect(actions).toContainElement(screen.getByTestId('refine-action'));
    expect(scroll.contains(screen.getByTestId('refine-action'))).toBe(false);
    delete window.matchMedia;
  });
  describe('two-pane workspace (splitLayout)', () => {
    it('keeps the stacked layout unless splitLayout is set', () => {
      renderPane();
      expect(screen.queryByRole('region', { name: 'Source prompt' })).toBeNull();
      expect(screen.queryByRole('group', { name: 'Workspace pane' })).toBeNull();
    });

    it('renders source and result panes and keeps both mounted while switching', () => {
      const { container } = renderPane({ splitLayout: true, error: null });
      const source = screen.getByRole('region', { name: 'Source prompt' });
      const result = screen.getByRole('region', { name: 'Enhanced result' });
      expect(source).toContainElement(screen.getByTestId('prompt-input'));
      expect(result).toContainElement(screen.getByTestId('output-panel'));

      const root = container.querySelector('.pl-create-split');
      expect(root).toHaveAttribute('data-active-pane', 'source');
      fireEvent.click(screen.getByRole('button', { name: 'Result' }));
      expect(root).toHaveAttribute('data-active-pane', 'result');
      expect(screen.getByRole('button', { name: 'Result' })).toHaveAttribute('aria-pressed', 'true');
      // Switching only hides a pane through CSS; the draft stays in the DOM.
      expect(screen.getByTestId('prompt-input')).toHaveValue('Draft prompt body');
      fireEvent.click(screen.getByRole('button', { name: 'Source' }));
      expect(root).toHaveAttribute('data-active-pane', 'source');
    });

    it('follows a refine run into the result pane', () => {
      const { container } = renderPane({ splitLayout: true, error: null, enhanced: '', loading: true });
      expect(container.querySelector('.pl-create-split')).toHaveAttribute('data-active-pane', 'result');
    });

    it('keeps a Cancel inside the result pane while a run is in flight', () => {
      const cancelEnhance = vi.fn();
      // A re-run keeps the previous result on screen, so this must not depend on the empty loading card.
      renderPane({ splitLayout: true, error: null, loading: true, streaming: true, cancelEnhance });
      const result = screen.getByRole('region', { name: 'Enhanced result' });
      const bar = screen.getByTestId('result-pane-run-bar');
      expect(result).toContainElement(bar);
      expect(bar).toHaveTextContent('Streaming…');
      fireEvent.click(within(bar).getByRole('button', { name: 'Cancel' }));
      expect(cancelEnhance).toHaveBeenCalledTimes(1);
    });

    it('shows no result-pane run bar when nothing is running', () => {
      renderPane({ splitLayout: true, error: null });
      expect(screen.queryByTestId('result-pane-run-bar')).toBeNull();
    });

    it('leaves one primary Save once a result exists and groups secondary actions', () => {
      renderPane({ splitLayout: true, error: null, currentEntry: null, editingId: null });
      const saves = screen.getAllByRole('button', { name: /^Save\b/ });
      expect(saves).toHaveLength(1);
      expect(saves[0]).toHaveAttribute('data-testid', 'save-to-library');
      expect(saves[0]).toHaveTextContent('Save as new prompt · Improved');
      expect(screen.getByTestId('refine-action')).toHaveTextContent('Refine again');
      const more = screen.getByTestId('editor-more-actions');
      expect(more).toContainElement(screen.getByRole('button', { name: 'Test Enhancer' }));
      expect(more).toContainElement(screen.getByRole('button', { name: /Reset Draft/ }));
    });

    it('keeps the draft Save in the source pane before any result exists', () => {
      renderPane({ splitLayout: true, error: null, enhanced: '' });
      const source = screen.getByRole('region', { name: 'Source prompt' });
      expect(source).toContainElement(screen.getByRole('button', { name: 'Save new version' }));
      expect(screen.getByTestId('refine-action')).toHaveTextContent('Refine Prompt');
    });
  });
});
