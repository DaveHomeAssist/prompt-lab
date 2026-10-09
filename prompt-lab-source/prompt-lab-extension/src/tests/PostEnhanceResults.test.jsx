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
  reasoning: 'The constraints now have a testable form.', provider: 'anthropic', model: 'claude-test',
  latencyMs: 420, usage: { input: 30, output: 18, total: 48 },
};
function Harness({ onSaveAsNew = vi.fn(), onSave = vi.fn(), onCopy = vi.fn(), onEnhance = vi.fn(), initialMeta = structuredMeta }) {
  const [enhanced, setEnhanced] = useState('Improved output with assumed audience.');
  const [meta, setMeta] = useState(initialMeta);
  return <PostEnhanceResults m={m} raw="Original output." enhanced={enhanced} setEnhanced={setEnhanced}
    variants={[]} resultMeta={meta} setResultMeta={setMeta} copy={onCopy} enhance={onEnhance} dismiss={vi.fn()}
    editingId="prompt-1" lib={{ pinGoldenResponse: vi.fn() }} evalRuns={[]} showInlineSaveBar
    saveTitle="Prompt title" setSaveTitle={vi.fn()} suggestedSaveTitle="Prompt title" canSavePanel
    quickSave={onSave} quickSaveAsNew={onSaveAsNew} openSavePanel={vi.fn()}
    currentEntry={{ id: 'prompt-1', title: 'Prompt title' }} />;
}

describe('PostEnhanceResults', () => {
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
});
