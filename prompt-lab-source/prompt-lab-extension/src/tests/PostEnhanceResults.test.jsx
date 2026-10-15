import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PostEnhanceResults from '../PostEnhanceResults.jsx';

vi.mock('../icons.jsx', () => ({ default: () => null }));
vi.mock('../MarkdownPreview.jsx', () => ({ default: ({ text }) => <div>{text}</div> }));

const m = { diffAdd: 'add', diffDel: 'del', diffEq: 'same' };

const structuredMeta = {
  selectedCandidateId: 'improved',
  candidates: [
    { id: 'improved', label: 'Improved', content: 'Improved output with assumed audience.' },
    { id: 'tighter', label: 'Tighter', content: 'Tighter output.' },
    { id: 'json', label: 'Strict JSON', content: '{"answer":"output"}' },
  ],
  changeSummary: 'Clearer and easier to validate.',
  changes: [{ id: 'c1', type: 'added', label: 'Added explicit audience' }],
  assumptions: [{ id: 'a1', text: 'The audience is experienced.', addedText: ' with assumed audience' }],
  reasoning: 'The constraints now have a testable form.',
  provider: 'anthropic',
  model: 'claude-test',
  latencyMs: 420,
  usage: { input: 30, output: 18, total: 48 },
};

function Harness({ onSaveAsNew = vi.fn(), initialMeta = structuredMeta, splitWorkspace = false, copy = vi.fn() }) {
  const [enhanced, setEnhanced] = useState('Improved output with assumed audience.');
  const [meta, setMeta] = useState(initialMeta);
  return <PostEnhanceResults
    m={m}
    raw="Original output."
    enhanced={enhanced}
    setEnhanced={setEnhanced}
    variants={[]}
    resultMeta={meta}
    setResultMeta={setMeta}
    copy={copy}
    enhance={vi.fn()}
    dismiss={vi.fn()}
    editingId="prompt-1"
    lib={{ pinGoldenResponse: vi.fn() }}
    evalRuns={[]}
    showInlineSaveBar
    saveTitle="Prompt title"
    setSaveTitle={vi.fn()}
    suggestedSaveTitle="Prompt title"
    canSavePanel
    quickSave={vi.fn()}
    quickSaveAsNew={onSaveAsNew}
    openSavePanel={vi.fn()}
    currentEntry={{ id: 'prompt-1', title: 'Prompt title' }}
    splitWorkspace={splitWorkspace}
  />;
}

describe('PostEnhanceResults', () => {
  it('switches candidates and edits the selected candidate rather than only changing decoration', () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole('option', { name: /Tighter/ }));
    expect(screen.getByLabelText('Tighter candidate')).toHaveValue('Tighter output.');

    fireEvent.change(screen.getByLabelText('Tighter candidate'), { target: { value: 'Edited tighter output.' } });
    expect(screen.getByLabelText('Tighter candidate')).toHaveValue('Edited tighter output.');
  });

  it('shows structured changes and reverts the exact text attached to an assumption', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('tab', { name: 'Changes' }));
    expect(screen.getByText('Added explicit audience')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Revert' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Improved' }));
    expect(screen.getByLabelText('Improved candidate')).toHaveValue('Improved output.');
  });

  it('keeps save-as-new distinct from saving a version', () => {
    const onSaveAsNew = vi.fn();
    render(<Harness onSaveAsNew={onSaveAsNew} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save as new prompt' }));
    expect(onSaveAsNew).toHaveBeenCalledTimes(1);
  });

  it('renders a legacy enhanced result when structured metadata is null', () => {
    render(<Harness initialMeta={null} />);

    expect(screen.getByRole('tab', { name: 'Improved' })).toBeInTheDocument();
    expect(screen.getByLabelText('Improved candidate')).toHaveValue('Improved output with assumed audience.');
  });
  describe('split workspace', () => {
    it('shows the assumptions count in the header and moves focus to the assumptions', () => {
      render(<Harness splitWorkspace />);
      const review = screen.getByTestId('review-assumptions');
      expect(review).toHaveTextContent('Review assumptions · 1');
      fireEvent.click(review);
      expect(screen.getByRole('heading', { name: 'Review what the model inferred' })).toHaveFocus();
    });

    it('keeps one primary Save naming the selected candidate and moves Copy to the commit bar', () => {
      const copy = vi.fn();
      render(<Harness splitWorkspace copy={copy} />);
      expect(screen.getByTestId('save-to-library')).toHaveTextContent('Save new version · Improved');
      expect(screen.queryByRole('button', { name: 'Re-run' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Copy selected' })).toBeNull();
      const candidateActions = screen.getByRole('toolbar', { name: 'Improved actions' });
      expect(candidateActions).not.toHaveTextContent('Save');
      expect(candidateActions).not.toHaveTextContent('Copy');
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
      expect(copy).toHaveBeenCalledWith('Improved output with assumed audience.', 'Improved copied');
      fireEvent.click(screen.getByRole('option', { name: /Tighter/ }));
      expect(screen.getByTestId('save-to-library')).toHaveTextContent('Save new version · Tighter');
    });

    it('leaves the stacked layout header actions unchanged', () => {
      render(<Harness />);
      expect(screen.getByRole('button', { name: 'Copy selected' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Re-run' })).toBeInTheDocument();
      expect(screen.queryByTestId('review-assumptions')).toBeNull();
    });
  });
});
