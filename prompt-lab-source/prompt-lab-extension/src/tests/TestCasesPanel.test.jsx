import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TestCasesPanel from '../TestCasesPanel.jsx';

vi.mock('../icons', () => ({ default: () => null }));

// LibraryPanel.test.jsx stubs this component out, so nothing else exercises the
// real form and row actions. That is how the Library workspace could ship with
// no reachable "Add Case" control without any test noticing.

const m = {
  textSub: 'text-sub', codeBlock: 'code-block', border: 'border-x', input: 'input',
  text: 'text', textBody: 'text-body', textMuted: 'text-muted',
};
const entry = { id: 'prompt-1', title: 'Support reply' };
const savedCase = {
  id: 'case-1', promptId: 'prompt-1', title: 'Refund request', input: 'Customer wants a refund',
  expectedTraits: ['polite', 'concise'], expectedExclusions: ['legal advice'], notes: '',
};

function renderPanel(overrides = {}) {
  const props = {
    m, entry, cases: [], evalRuns: [],
    caseFormPromptId: null, editingCaseId: null,
    caseTitle: '', setCaseTitle: vi.fn(), caseInput: '', setCaseInput: vi.fn(),
    caseTraits: '', setCaseTraits: vi.fn(), caseExclusions: '', setCaseExclusions: vi.fn(),
    caseNotes: '', setCaseNotes: vi.fn(),
    openCaseForm: vi.fn(), resetCaseForm: vi.fn(), saveCaseForPrompt: vi.fn(),
    loadCaseIntoEditor: vi.fn(), runSingleCase: vi.fn(), removeCase: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<TestCasesPanel {...props} />) };
}

describe('TestCasesPanel', () => {
  it('offers Add Case when a prompt has no cases and opens the form for that prompt', () => {
    const { props } = renderPanel();

    const region = screen.getByRole('region', { name: 'Test cases' });
    expect(within(region).getByText(/Test Cases \(0\)/)).toBeInTheDocument();
    expect(within(region).getByText('No saved test cases yet.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Test case title')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add Case' }));
    expect(props.openCaseForm).toHaveBeenCalledTimes(1);
    expect(props.openCaseForm).toHaveBeenCalledWith('prompt-1');
  });

  it('keeps the form closed when it is open for a different prompt', () => {
    renderPanel({ caseFormPromptId: 'another-prompt' });

    expect(screen.getByRole('button', { name: 'Add Case' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Test case title')).not.toBeInTheDocument();
  });

  it('binds every form field and saves for the prompt', () => {
    const { props } = renderPanel({
      caseFormPromptId: 'prompt-1', caseTitle: 'Refund request', caseInput: 'Customer wants a refund',
    });

    fireEvent.change(screen.getByLabelText('Test case title'), { target: { value: 'New title' } });
    fireEvent.change(screen.getByLabelText('Test case prompt input'), { target: { value: 'New input' } });
    fireEvent.change(screen.getByLabelText('Expected traits'), { target: { value: 'polite, concise' } });
    fireEvent.change(screen.getByLabelText('Expected exclusions'), { target: { value: 'legal advice' } });
    fireEvent.change(screen.getByLabelText('Test case notes'), { target: { value: 'Tone check' } });
    expect(props.setCaseTitle).toHaveBeenCalledWith('New title');
    expect(props.setCaseInput).toHaveBeenCalledWith('New input');
    expect(props.setCaseTraits).toHaveBeenCalledWith('polite, concise');
    expect(props.setCaseExclusions).toHaveBeenCalledWith('legal advice');
    expect(props.setCaseNotes).toHaveBeenCalledWith('Tone check');

    fireEvent.click(screen.getByRole('button', { name: 'Save Case' }));
    expect(props.saveCaseForPrompt).toHaveBeenCalledWith('prompt-1');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.resetCaseForm).toHaveBeenCalledTimes(1);
  });

  it('will not save a case without input text', () => {
    const { props } = renderPanel({ caseFormPromptId: 'prompt-1', caseTitle: 'Title only', caseInput: '   ' });

    const save = screen.getByRole('button', { name: 'Save Case' });
    expect(save).toBeDisabled();
    fireEvent.click(save);
    expect(props.saveCaseForPrompt).not.toHaveBeenCalled();
  });

  it('labels the submit button Update Case while editing an existing case', () => {
    renderPanel({ caseFormPromptId: 'prompt-1', editingCaseId: 'case-1', caseInput: 'Customer wants a refund' });

    expect(screen.getByRole('button', { name: 'Update Case' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Save Case' })).not.toBeInTheDocument();
  });

  it('lists saved cases and wires Edit, Use, Run and Delete to the right case', () => {
    const { props } = renderPanel({ cases: [savedCase] });

    expect(screen.getByText(/Test Cases \(1\)/)).toBeInTheDocument();
    expect(screen.getByText('Refund request')).toBeInTheDocument();
    expect(screen.getByText('Customer wants a refund')).toBeInTheDocument();
    expect(screen.getByText('Expect: polite, concise')).toBeInTheDocument();
    expect(screen.getByText('Avoid: legal advice')).toBeInTheDocument();
    expect(screen.queryByText('No saved test cases yet.')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(props.openCaseForm).toHaveBeenCalledWith('prompt-1', savedCase);
    fireEvent.click(screen.getByRole('button', { name: 'Use' }));
    expect(props.loadCaseIntoEditor).toHaveBeenCalledWith(savedCase);
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(props.runSingleCase).toHaveBeenCalledWith(savedCase, 'Support reply');
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(props.removeCase).toHaveBeenCalledWith(savedCase);
  });

  it('disables Run while cases are running so a double click cannot start two paid runs', () => {
    const { props } = renderPanel({ cases: [savedCase], runningCases: true });

    const run = screen.getByRole('button', { name: 'Run' });
    expect(run).toBeDisabled();
    fireEvent.click(run);
    expect(props.runSingleCase).not.toHaveBeenCalled();
    // Only Run is guarded; managing the case stays available.
    expect(screen.getByRole('button', { name: 'Edit' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled();
  });

  describe('latest verdict badge', () => {
    const verdictOf = (evalRuns) => {
      const { container, unmount } = renderPanel({ cases: [savedCase], evalRuns });
      const badge = within(container).queryByText(/^(pass|fail|mixed|error|ran)$/);
      const text = badge ? badge.textContent : null;
      unmount();
      return text;
    };

    it('shows the newest run recorded for this case', () => {
      expect(verdictOf([{ testCaseId: 'case-1', verdict: 'fail' }, { testCaseId: 'case-1', verdict: 'pass' }])).toBe('fail');
    });

    it('distinguishes pass, mixed, error and a run without a verdict', () => {
      expect(verdictOf([{ testCaseId: 'case-1', verdict: 'pass' }])).toBe('pass');
      expect(verdictOf([{ testCaseId: 'case-1', verdict: 'mixed' }])).toBe('mixed');
      expect(verdictOf([{ testCaseId: 'case-1', status: 'error', verdict: 'pass' }])).toBe('error');
      expect(verdictOf([{ testCaseId: 'case-1' }])).toBe('ran');
    });

    it('ignores runs that belong to other cases', () => {
      expect(verdictOf([{ testCaseId: 'someone-else', verdict: 'fail' }])).toBeNull();
      expect(verdictOf([])).toBeNull();
    });
  });
});
