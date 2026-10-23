import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CreateContextBar, { describeEditingContext } from '../CreateContextBar.jsx';
import CreateEditorPane from '../CreateEditorPane.jsx';
import PostEnhanceResults from '../PostEnhanceResults.jsx';
import PromptShortcuts from '../PromptShortcuts.jsx';
import { PROMPT_SHORTCUTS_KEY, readPromptShortcutsOpen } from '../lib/promptShortcutsPreference.js';
import { normalizeEntry, updatePromptEntry } from '../lib/promptSchema.js';

vi.mock('../icons.jsx', () => ({ default: () => null }));
vi.mock('../MarkdownPreview.jsx', () => ({ default: ({ text }) => <div>{text}</div> }));

const m = {
  surface: 'bg-slate-950/70', border: 'border-slate-800', borderHov: 'hover:border-slate-700',
  text: 'text-slate-50', textAlt: 'text-slate-200', textBody: 'text-slate-100', textSub: 'text-slate-300',
  textMuted: 'text-slate-500', btn: 'bg-slate-800', input: 'bg-slate-900', codeBlock: 'bg-slate-900/80',
  scoreGood: 'text-emerald-300', scoreBad: 'text-rose-300', notesBg: 'bg-amber-950/20', notesText: 'text-amber-200',
  diffAdd: 'bg-emerald-500/20', diffDel: 'bg-rose-500/20', diffEq: 'bg-slate-800',
};
const savedEntry = { id: 'entry-1', title: 'Voice Memo Cleanup', collection: 'Ops', original: 'Draft prompt body', enhanced: 'Refined prompt output' };
const recent = [{ id: 'r1', title: 'Alpha recent', enhanced: 'Alpha text' }, { id: 'q2', title: 'Shared prompt', enhanced: 'Shared text' }];
const quick = [{ id: 'q1', title: 'Beta quick', enhanced: 'Beta text' }, { id: 'q2', title: 'Shared prompt', enhanced: 'Shared text' }];

function stubViewport(narrow) {
  window.matchMedia = vi.fn().mockImplementation(query => ({
    matches: narrow, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }));
}

beforeEach(() => {
  localStorage.removeItem(PROMPT_SHORTCUTS_KEY);
  delete window.matchMedia;
});
afterEach(() => {
  delete window.matchMedia;
});

describe('describeEditingContext', () => {
  it('reports a saved prompt with no changes', () => {
    const context = describeEditingContext({ currentEntry: savedEntry, raw: 'Draft prompt body', enhanced: 'Refined prompt output' });
    expect(context).toMatchObject({ mode: 'editing', title: 'Voice Memo Cleanup', folder: 'Ops', unsaved: false, saveState: 'No unsaved changes', saveBehavior: 'Save adds a new version' });
  });
  it('reports unsaved edits to a saved prompt', () => {
    const context = describeEditingContext({ currentEntry: savedEntry, raw: 'Draft prompt body, edited', enhanced: 'Refined prompt output' });
    expect(context.unsaved).toBe(true);
    expect(context.saveState).toBe('Unsaved changes');
  });
  it('counts pending Library details as unsaved and shows what Save will write', () => {
    const base = { currentEntry: { ...savedEntry, tags: ['ops', 'audio'] }, raw: 'Draft prompt body', enhanced: 'Refined prompt output' };
    expect(describeEditingContext({ ...base, saveTitle: 'Voice Memo Cleanup', saveCollection: 'Ops', saveTags: ['audio', 'ops'] }))
      .toMatchObject({ unsaved: false, title: 'Voice Memo Cleanup', folder: 'Ops' });
    expect(describeEditingContext({ ...base, saveTitle: 'Voice memo tidy-up', saveCollection: 'Ops', saveTags: ['ops', 'audio'] }))
      .toMatchObject({ unsaved: true, saveState: 'Unsaved changes', title: 'Voice memo tidy-up' });
    expect(describeEditingContext({ ...base, saveTitle: 'Voice Memo Cleanup', saveCollection: 'Archive', saveTags: ['ops', 'audio'] }))
      .toMatchObject({ unsaved: true, folder: 'Archive' });
    expect(describeEditingContext({ ...base, saveTitle: 'Voice Memo Cleanup', saveCollection: 'Ops', saveTags: ['ops'] }).unsaved).toBe(true);
  });
  it('reports a new draft and an empty editor', () => {
    expect(describeEditingContext({ currentEntry: null, raw: 'Something', enhanced: '', suggestedSaveTitle: 'Something' }))
      .toMatchObject({ mode: 'new', title: 'Something', unsaved: true, saveState: 'Not saved yet', saveBehavior: 'Save creates a new prompt', canStartNew: true });
    expect(describeEditingContext({ currentEntry: null, raw: '  ', enhanced: '' }))
      .toMatchObject({ mode: 'new', title: '', unsaved: false, saveState: 'Empty draft', canStartNew: false });
  });
});

describe('CreateContextBar', () => {
  const baseProps = { m, canSavePanel: true, openSavePanel: vi.fn(), accentTextClass: 'text-orange-400', accentHoverTextClass: '', accentBadgeClass: 'bg-amber-500/15' };
  it('names the saved prompt, its folder, its save state and what Save does', () => {
    const openSection = vi.fn();
    const onStartNew = vi.fn();
    render(<CreateContextBar {...baseProps} currentEntry={savedEntry} raw="Draft prompt body, edited" enhanced="Refined prompt output"
      openSection={openSection} onStartNew={onStartNew} />);
    const bar = screen.getByRole('region', { name: 'Editing context' });
    expect(within(bar).getByText('Editing saved prompt:')).toBeInTheDocument();
    expect(within(bar).getByText('Voice Memo Cleanup')).toBeInTheDocument();
    expect(within(bar).getByText('Folder: Ops')).toBeInTheDocument();
    expect(within(bar).getByText('Unsaved changes')).toBeInTheDocument();
    expect(within(bar).getByText('Save adds a new version')).toBeInTheDocument();
    expect(within(bar).queryByRole('button', { name: /new prompt/i })).not.toBeInTheDocument();
    expect(within(bar).getByTestId('refinement-identity')).toHaveTextContent('Refine keeps this prompt');
    fireEvent.click(within(bar).getByRole('button', { name: 'View in Library' }));
    expect(openSection).toHaveBeenCalledWith('library');
  });
  it('shows the pending title and folder from Library details', () => {
    render(<CreateContextBar {...baseProps} currentEntry={savedEntry} raw="Draft prompt body" enhanced="Refined prompt output"
      saveTitle="Voice memo tidy-up" saveCollection="Archive" saveTags={[]} openSection={vi.fn()} onStartNew={vi.fn()} />);
    const bar = screen.getByRole('region', { name: 'Editing context' });
    expect(within(bar).getByText('Voice memo tidy-up')).toBeInTheDocument();
    expect(within(bar).getByText('Folder: Archive')).toBeInTheDocument();
    expect(within(bar).getByText('Unsaved changes')).toBeInTheDocument();
  });
  it('labels an empty editor as a new prompt with nothing to start over', () => {
    render(<CreateContextBar {...baseProps} currentEntry={null} raw="" enhanced="" openSection={vi.fn()} onStartNew={vi.fn()} />);
    const bar = screen.getByRole('region', { name: 'Editing context' });
    expect(within(bar).getByText('New unsaved prompt')).toBeInTheDocument();
    expect(within(bar).getByText('Empty draft')).toBeInTheDocument();
    expect(within(bar).getByText('Save creates a new prompt')).toBeInTheDocument();
    expect(within(bar).queryByRole('button', { name: 'Start new prompt' })).not.toBeInTheDocument();
    expect(within(bar).queryByRole('button', { name: 'View in Library' })).not.toBeInTheDocument();
  });
});

describe('PromptShortcuts', () => {
  const props = { m, recentPrompts: recent, quickInject: quick, accentTextClass: 'text-orange-400', accentHoverTextClass: '' };
  it('renders nothing without shortcuts', () => {
    const { container } = render(<PromptShortcuts {...props} recentPrompts={[]} quickInject={[]} loadEntry={vi.fn()} copy={vi.fn()} bumpUse={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
  it('starts open on wider screens, counts unique prompts, and loads or copies with labelled actions', () => {
    stubViewport(false);
    const loadEntry = vi.fn(); const copy = vi.fn(); const bumpUse = vi.fn();
    render(<PromptShortcuts {...props} loadEntry={loadEntry} copy={copy} bumpUse={bumpUse} />);
    const toggle = screen.getByRole('button', { name: /Prompt shortcuts/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveTextContent('(3)');
    fireEvent.click(screen.getByRole('button', { name: 'Load Alpha recent' }));
    expect(loadEntry).toHaveBeenCalledWith(recent[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Copy Beta quick' }));
    expect(copy).toHaveBeenCalledWith('Beta text', 'Copied: Beta quick');
    expect(bumpUse).toHaveBeenCalledWith('q1');
    expect(screen.queryByRole('button', { name: 'Copy Alpha recent' })).not.toBeInTheDocument();
  });
  it('starts closed on phones and remembers the choice', () => {
    stubViewport(true);
    const { unmount } = render(<PromptShortcuts {...props} loadEntry={vi.fn()} copy={vi.fn()} bumpUse={vi.fn()} />);
    const toggle = screen.getByRole('button', { name: /Prompt shortcuts/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'Load Alpha recent' })).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(document.activeElement === toggle || document.activeElement === document.body).toBe(true);
    expect(localStorage.getItem(PROMPT_SHORTCUTS_KEY)).toBe('open');
    unmount();
    render(<PromptShortcuts {...props} loadEntry={vi.fn()} copy={vi.fn()} bumpUse={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Prompt shortcuts/ })).toHaveAttribute('aria-expanded', 'true');
  });
  it('lays open shortcuts out as one row on short windows', () => {
    window.matchMedia = vi.fn().mockImplementation(query => ({
      matches: query === '(max-height: 800px)', media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }));
    localStorage.setItem(PROMPT_SHORTCUTS_KEY, 'open');
    render(<PromptShortcuts {...props} loadEntry={vi.fn()} copy={vi.fn()} bumpUse={vi.fn()} />);
    expect(screen.getByRole('region', { name: 'Prompt shortcuts' })).toHaveAttribute('data-layout', 'row');
    expect(screen.getByRole('button', { name: 'Load Alpha recent' })).toBeInTheDocument();
  });
  it('falls back to open when the viewport cannot be queried', () => {
    expect(readPromptShortcutsOpen()).toBe(true);
  });
});

function renderPane(overrides = {}) {
  const noop = vi.fn();
  const lib = { pinGoldenResponse: vi.fn(), clearGoldenResponse: vi.fn(), setGoldenThreshold: vi.fn() };
  return render(<CreateEditorPane
    m={m} compact={false} pageScroll={false} colorMode="dark" quickInject={quick} recentPrompts={recent}
    loadEntry={noop} copy={noop} bumpUse={noop} showCreateContext currentEntry={savedEntry}
    suggestedSaveTitle="Voice Memo Cleanup" canSavePanel openSavePanel={noop} openSection={noop}
    raw="Draft prompt body" setRaw={noop} updateCursor={noop} mdPreview={false} setMdPreview={noop}
    wc={3} score={null} inp="border border-slate-700 text-slate-50" lintIssues={[]} lintOpen={false}
    setLintOpen={noop} handleLintFix={noop} enhMode="balanced" setEnhMode={noop} enhance={noop}
    runAllCases={noop} clearEditor={noop} cancelEnhance={noop} loading={false} runningCases={false}
    batchProgress={{ active: false, completed: 0, total: 0 }} currentTestCases={[]} hasSavablePrompt
    primaryModKey="Ctrl" streaming={false} optimisticSaveVisible={false} showSave={false} error={null}
    openOptions={noop} enhanced="Refined prompt output" setEnhanced={noop} enhMdPreview={false} setEnhMdPreview={noop}
    resultTab="improved" setResultTab={noop} resultTabs={[{ id: 'improved', label: 'Improved' }]}
    activeResultTab="improved" copyBtn="border" showInlineSaveBar={false} saveTitle="" setSaveTitle={noop}
    quickSave={noop} editingId="entry-1" goldenResponse={null} goldenSimilarity={null} goldenThreshold={0.8}
    goldenVerdict={null} comparisonText="" comparisonSourceLabel="" lib={lib} variants={[]} showNotes={false}
    notes="" evalRuns={[]} libraryCount={1} evalRunCount={0} onLoadQuickStartPrompt={noop} onOpenEvaluate={noop}
    showEvalHistory={false} setShowEvalHistory={noop} streamPreview="" showDiffUpgradeHint={false}
    onUnlockDiff={noop} runCasesLocked={false} newPrompt={noop} {...overrides} />);
}

function renderContext(overrides = {}) {
  return render(<CreateContextBar m={m} raw="Draft prompt body" enhanced="Refined prompt output"
    currentEntry={savedEntry} accentTextClass="" accentHoverTextClass="" accentBadgeClass=""
    openSection={vi.fn()} {...overrides} />);
}

describe('CreateEditorPane slice 2A wiring', () => {
  const entryWithResults = () => normalizeEntry({
    ...savedEntry, notes: 'Saved notes', variants: [{ label: 'Refined', content: 'Alternate output' }],
    resultMeta: { schemaVersion: 2, selectedCandidateId: 'expanded', candidates: [
      { id: 'expanded', label: 'Expanded', content: savedEntry.enhanced },
      { id: 'refined', label: 'Refined', content: 'Alternate output' },
    ] },
  });
  it('keeps an alternate candidate edit dirty after returning to the unchanged primary, then clears after Save', () => {
    const entry = entryWithResults();
    const resultMeta = { ...entry.resultMeta, candidates: entry.resultMeta.candidates.map(candidate => (
      candidate.id === 'refined' ? { ...candidate, content: 'Edited alternate output' } : candidate
    )) };
    const { unmount } = renderContext({ currentEntry: entry,
      resultMeta, variants: entry.variants, notes: entry.notes });
    expect(screen.getByRole('region', { name: 'Editing context' })).toHaveTextContent('Unsaved changes');
    const saved = updatePromptEntry(entry, { resultMeta });
    expect(saved.currentVersionId).not.toBe(entry.currentVersionId);
    unmount();
    renderContext({ currentEntry: saved,
      resultMeta: saved.resultMeta, variants: saved.variants, notes: saved.notes });
    expect(screen.getByRole('region', { name: 'Editing context' })).toHaveTextContent('No unsaved changes');
  });
  it.each([
    ['notes', { notes: 'Edited notes' }],
    ['variants', { variants: [{ label: 'Refined', content: 'Edited variant' }] }],
  ])('counts changed %s as unsaved even when the selected output is unchanged', (_field, changes) => {
    const entry = entryWithResults();
    renderContext({ currentEntry: entry,
      resultMeta: entry.resultMeta, variants: entry.variants, notes: entry.notes, ...changes });
    expect(screen.getByRole('region', { name: 'Editing context' })).toHaveTextContent('Unsaved changes');
  });
  it('leaves context to the shell and keeps chip strips when controls are off', () => {
    renderPane();
    expect(screen.queryByRole('region', { name: 'Editing context' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Prompt shortcuts' })).not.toBeInTheDocument();
    expect(screen.queryByText('Editing')).not.toBeInTheDocument();
    expect(screen.getByText('Recent')).toBeInTheDocument();
    expect(screen.getByText('Quick')).toBeInTheDocument();
  });
  it('shows prompt shortcuts without duplicating the shell context when controls are on', () => {
    stubViewport(false);
    renderPane({ contextControls: true });
    expect(screen.queryByRole('region', { name: 'Editing context' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Prompt shortcuts' })).toBeInTheDocument();
    expect(screen.queryByText('Quick')).not.toBeInTheDocument();
  });
  it('shows the context bar even before anything is typed', () => {
    renderContext({ currentEntry: null, raw: '', enhanced: '' });
    expect(screen.getByRole('region', { name: 'Editing context' })).toHaveTextContent('New unsaved prompt');
  });
});

function ResultsHarness({ explicitSaveLabels, currentEntry }) {
  const [enhanced, setEnhanced] = useState('Improved output.');
  const [meta, setMeta] = useState({ selectedCandidateId: 'improved', candidates: [{ id: 'improved', label: 'Improved', content: 'Improved output.' }] });
  return <PostEnhanceResults m={m} raw="Original." enhanced={enhanced} setEnhanced={setEnhanced} variants={[]}
    resultMeta={meta} setResultMeta={setMeta} copy={vi.fn()} enhance={vi.fn()} dismiss={vi.fn()}
    editingId={currentEntry?.id || null} lib={{ pinGoldenResponse: vi.fn() }} evalRuns={[]} showInlineSaveBar
    saveTitle="Prompt title" setSaveTitle={vi.fn()} suggestedSaveTitle="Prompt title" canSavePanel
    quickSave={vi.fn()} quickSaveAsNew={vi.fn()} openSavePanel={vi.fn()} currentEntry={currentEntry}
    explicitSaveLabels={explicitSaveLabels} />;
}

describe('PostEnhanceResults candidate toolbar Save label', () => {
  it('stays "Save" when explicit labels are off', () => {
    render(<ResultsHarness explicitSaveLabels={false} currentEntry={null} />);
    const toolbar = screen.getByRole('toolbar', { name: 'Improved actions' });
    expect(within(toolbar).getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });
  it('names the save target when explicit labels are on', () => {
    const { unmount } = render(<ResultsHarness explicitSaveLabels currentEntry={null} />);
    expect(within(screen.getByRole('toolbar', { name: 'Improved actions' })).getByRole('button', { name: 'Save as new prompt' })).toBeInTheDocument();
    unmount();
    render(<ResultsHarness explicitSaveLabels currentEntry={{ id: 'p1', title: 'Saved' }} />);
    expect(within(screen.getByRole('toolbar', { name: 'Improved actions' })).getByRole('button', { name: 'Save new version' })).toBeInTheDocument();
  });
});
