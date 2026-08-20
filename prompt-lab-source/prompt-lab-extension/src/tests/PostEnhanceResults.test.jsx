import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PostEnhanceResults from '../PostEnhanceResults.jsx';

vi.mock('../icons.jsx', () => ({ default: () => null }));
vi.mock('../MarkdownPreview.jsx', () => ({ default: ({ text }) => <div>{text}</div> }));

const m = { diffAdd: 'add', diffDel: 'del', diffEq: 'same' };

function Harness({ onSaveAsNew = vi.fn() }) {
  const [enhanced, setEnhanced] = useState('Improved output with assumed audience.');
  const [meta, setMeta] = useState({
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
  });
  return <PostEnhanceResults
    m={m}
    raw="Original output."
    enhanced={enhanced}
    setEnhanced={setEnhanced}
    variants={[]}
    resultMeta={meta}
    setResultMeta={setMeta}
    copy={vi.fn()}
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
});
