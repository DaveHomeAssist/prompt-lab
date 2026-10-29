import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  reasoning: 'The constraints now have a testable form.', provider: 'anthropic', model: 'claude-test',
  latencyMs: 420, usage: { input: 30, output: 18, total: 48 },
};
function Harness({ onSaveAsNew = vi.fn(), onSave = vi.fn(), onCopy = vi.fn(), onEnhance = vi.fn(), initialMeta = structuredMeta, splitWorkspace = false, lastSaveReceipt }) {
  const [enhanced, setEnhanced] = useState('Improved output with assumed audience.');
  const [meta, setMeta] = useState(initialMeta);
  return <PostEnhanceResults m={m} raw="Original output." enhanced={enhanced} setEnhanced={setEnhanced}
    variants={[]} resultMeta={meta} setResultMeta={setMeta} copy={onCopy} enhance={onEnhance} dismiss={vi.fn()}
    editingId="prompt-1" lib={{ pinGoldenResponse: vi.fn() }} evalRuns={[]} showInlineSaveBar
    saveTitle="Prompt title" setSaveTitle={vi.fn()} suggestedSaveTitle="Prompt title" canSavePanel
    quickSave={onSave} quickSaveAsNew={onSaveAsNew} openSavePanel={vi.fn()}
    currentEntry={{ id: 'prompt-1', title: 'Prompt title' }} splitWorkspace={splitWorkspace} lastSaveReceipt={lastSaveReceipt} />;
}

describe('PostEnhanceResults', () => {
  it('reconciles a failed button save and later edits with acknowledged saves from another entry point', async () => {
    const onSave = vi.fn().mockResolvedValue(null);
    const { container, rerender } = render(<Harness onSave={onSave} />);
    const bar = container.querySelector('.pl-result-commit-bar');
    fireEvent.click(screen.getByTestId('save-to-library'));
    await waitFor(() => expect(bar).toHaveTextContent('Save failed.'));
    const receipt = { entryId: 'prompt-1', title: 'Prompt title', versionNumber: 2, resultSnapshot: {
      raw: 'Original output.', content: 'Improved output with assumed audience.', candidateId: 'improved', label: 'Improved', runId: '',
    } };
    rerender(<Harness onSave={onSave} lastSaveReceipt={receipt} />);
    await waitFor(() => expect(bar).toHaveTextContent('Saved Improved to “Prompt title” · version 2.'));
    expect(bar).not.toHaveTextContent('Save failed.');
    fireEvent.change(screen.getByLabelText('Improved candidate'), { target: { value: 'Edited result' } });
    expect(bar).toHaveTextContent('Current result has unsaved changes.');
    rerender(<Harness onSave={onSave} lastSaveReceipt={{ ...receipt, versionNumber: 3, resultSnapshot: { ...receipt.resultSnapshot, content: 'Edited result' } }} />);
    await waitFor(() => expect(bar).toHaveTextContent('version 3.'));
    expect(bar).not.toHaveTextContent('Current result has unsaved changes.');
    rerender(<Harness onSave={onSave} lastSaveReceipt={null} />);
    expect(bar).toHaveTextContent('version 3.');
  });

  it('does not acknowledge a different prompt or a draft-only save as the current result', () => {
    const receipt = { entryId: 'different-prompt', title: 'Elsewhere', versionNumber: 4, resultSnapshot: {
      raw: 'Original output.', content: 'Improved output with assumed audience.', candidateId: 'improved', label: 'Improved',
    } };
    const { container, rerender } = render(<Harness lastSaveReceipt={receipt} />);
    const bar = container.querySelector('.pl-result-commit-bar');
    expect(bar).not.toHaveTextContent('Saved Improved');
    rerender(<Harness lastSaveReceipt={{ ...receipt, entryId: 'prompt-1', resultSnapshot: null }} />);
    expect(bar).not.toHaveTextContent('Saved Improved');
  });
  it('keeps the primary Save before review content and acknowledges the saved candidate only after persistence', async () => {
    let finish;
    const onSave = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    const { container } = render(<Harness onSave={onSave} splitWorkspace />);
    const save = screen.getByTestId('save-to-library');
    const bar = container.querySelector('.pl-result-commit-bar');
    expect(bar.compareDocumentPosition(container.querySelector('.pl-results-body')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(save);
    expect(save).toBeDisabled();
    expect(bar).toHaveTextContent('Saving Improved');
    expect(bar).not.toHaveTextContent('Saved Improved');
    await act(async () => finish({ id: 'prompt-1', title: 'Prompt title', versionNumber: 2 }));
    await waitFor(() => expect(bar).toHaveTextContent('Saved Improved to “Prompt title” · version 2.'));
    expect(save).not.toBeDisabled();
    fireEvent.change(screen.getByLabelText('Improved candidate'), { target: { value: 'Later unsaved edit' } });
    expect(bar).toHaveTextContent('Current result has unsaved changes.');
  });
  it('keeps failed saves at the point of action and permits an acknowledged retry', async () => {
    const onSave = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'prompt-1', title: 'Prompt title', versionNumber: 2 });
    const { container } = render(<Harness onSave={onSave} splitWorkspace />);
    fireEvent.click(screen.getByTestId('save-to-library'));
    await waitFor(() => expect(container.querySelector('.pl-result-commit-bar')).toHaveTextContent('Save failed. Your result is still here. Retry saving.'));
    fireEvent.click(screen.getByTestId('save-to-library'));
    await waitFor(() => expect(container.querySelector('.pl-result-commit-bar')).toHaveTextContent('Saved Improved'));
    expect(onSave).toHaveBeenCalledTimes(2);
  });
  it('switches candidates and edits their actual content', () => {
    render(<Harness />);
    expect(screen.getByRole('option', { name: /Strict JSON/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: /Tighter/ }));
    expect(screen.getByLabelText('Tighter candidate')).toHaveValue('Tighter output.');
    fireEvent.change(screen.getByLabelText('Tighter candidate'), { target: { value: 'Edited tighter output.' } });
    expect(screen.getByLabelText('Tighter candidate')).toHaveValue('Edited tighter output.');
  });
  it('shows structured changes and reverts exact assumption text', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('tab', { name: 'Changes' }));
    expect(screen.getByText('Added explicit audience')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Revert' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Prompt' }));
    expect(screen.getByLabelText('Improved candidate')).toHaveValue('Improved output.');
  });
  it('keeps save-as-new distinct from saving a version', () => {
    const onSaveAsNew = vi.fn();
    render(<Harness onSaveAsNew={onSaveAsNew} />);
    fireEvent.click(screen.getByText('More', { selector: 'summary' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save as new prompt' }));
    expect(onSaveAsNew).toHaveBeenCalledTimes(1);
  });
  it('renders legacy content without relabeling it as a modern strategy', () => {
    render(<Harness initialMeta={null} />);
    expect(screen.getByRole('tab', { name: 'Prompt' })).toBeInTheDocument();
    expect(screen.getByLabelText('Improved candidate')).toHaveValue('Improved output with assumed audience.');
  });
  it('copies and saves the exact edited modern candidate and scopes its metadata', () => {
    const onSave = vi.fn(); const onCopy = vi.fn();
    render(<Harness onSave={onSave} onCopy={onCopy} initialMeta={{
      schemaVersion: 2, primaryId: 'expanded', selectedCandidateId: 'expanded',
      candidates: [{ id: 'expanded', content: 'Developed instructions with a new assumption.' }, { id: 'rebuilt', content: 'Different execution plan.' }],
      assumptions: [{ id: 'a', text: 'Only Expanded assumes this.', addedText: ' with a new assumption', candidateId: 'expanded' }],
    }} />);
    expect(screen.getAllByText('Only Expanded assumes this.').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('option', { name: /Rebuilt/ }));
    expect(screen.queryByText('Only Expanded assumes this.')).not.toBeInTheDocument();
    const edited = 'Edited plan.\nPreserve every final requirement.';
    fireEvent.change(screen.getByLabelText('Rebuilt candidate'), { target: { value: edited } });
    fireEvent.click(screen.getByRole('button', { name: 'Copy selected' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save new version' }));
    expect(onCopy).toHaveBeenCalledWith(edited);
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ id: 'rebuilt', content: edited }));
    expect(screen.getByRole('option', { name: /Rebuilt/ }).textContent).not.toContain('/5');
  });
  it('makes alternatives an explicit rerun and makes Diff open highlighted changes', () => {
    const onEnhance = vi.fn();
    render(<Harness onEnhance={onEnhance} initialMeta={{ schemaVersion: 2, primaryId: 'expanded', candidates: [{ id: 'expanded', content: 'Developed instructions.' }] }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Re-run with alternatives' }));
    expect(onEnhance).toHaveBeenCalledWith(undefined, { options: { alternatives: true } });
    fireEvent.click(screen.getByRole('button', { name: 'Diff' }));
    expect(screen.getByRole('tab', { name: 'Changes' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Text-level changes for Expanded')).toBeInTheDocument();
  });
  describe('split workspace', () => {
    const modernMeta = {
      schemaVersion: 2, primaryId: 'expanded', selectedCandidateId: 'expanded',
      candidates: [{ id: 'expanded', content: 'Developed instructions with a new assumption.' }, { id: 'rebuilt', content: 'Different execution plan.' }],
      assumptions: [{ id: 'a', text: 'Only Expanded assumes this.', addedText: ' with a new assumption', candidateId: 'expanded' }],
    };

    it('shows the selected candidate assumptions count in the header and moves focus to them', () => {
      render(<Harness splitWorkspace initialMeta={modernMeta} />);
      const review = screen.getByTestId('review-assumptions');
      expect(review).toHaveTextContent('Review assumptions · 1');
      fireEvent.click(review);
      expect(screen.getByRole('heading', { name: 'Review what the model inferred' })).toHaveFocus();
      fireEvent.click(screen.getByRole('option', { name: /Rebuilt/ }));
      expect(screen.queryByTestId('review-assumptions')).toBeNull();
    });

    it('keeps one primary Save naming the selected candidate and moves Copy to the commit bar', () => {
      const onCopy = vi.fn();
      render(<Harness splitWorkspace onCopy={onCopy} initialMeta={modernMeta} />);
      expect(screen.getByTestId('save-to-library')).toHaveTextContent('Save new version · Expanded');
      expect(screen.queryByRole('button', { name: 'Re-run' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Copy selected' })).toBeNull();
      const candidateActions = screen.getByRole('toolbar', { name: 'Expanded actions' });
      expect(candidateActions).not.toHaveTextContent('Save');
      expect(candidateActions).not.toHaveTextContent('Copy');
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
      expect(onCopy).toHaveBeenCalledWith('Developed instructions with a new assumption.', 'Expanded copied');
      fireEvent.click(screen.getByRole('option', { name: /Rebuilt/ }));
      expect(screen.getByTestId('save-to-library')).toHaveTextContent('Save new version · Rebuilt');
    });

    it('leaves the stacked layout header actions unchanged', () => {
      render(<Harness />);
      expect(screen.getByRole('button', { name: 'Copy selected' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Re-run' })).toBeInTheDocument();
      expect(screen.queryByTestId('review-assumptions')).toBeNull();
    });
  });
});
