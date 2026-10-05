import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LibraryWorkspace from '../LibraryWorkspace.jsx';
import useTestCases from '../hooks/useTestCases.js';

vi.mock('../icons.jsx', () => ({ default: () => null }));
vi.mock('../PackStudioPanel.jsx', () => ({ default: () => null }));

// Drives the Library Tests tab end to end with the real useTestCases hook and
// the real experiment store. jsdom has no IndexedDB, so the store uses its
// localStorage fallback, which lets these tests assert what was persisted.
const FALLBACK_KEY = 'pl2-test-case-fallback';

const alpha = {
  id: 'alpha', title: 'Alpha prompt', original: 'Summarize the incident report.',
  enhanced: 'Summarize the incident report in five bullet points.', favorite: false, collection: '', tags: [],
  useCount: 0, updatedAt: '2026-08-19T00:00:00Z', createdAt: '2026-08-19T00:00:00Z',
  metadata: { purpose: '', status: '', compatibility: [] }, versions: [], inputs: [], variants: [], testCases: [],
};
const lib = {
  library: [alpha], trash: [], filtered: [alpha], collections: [], setCollections: vi.fn(), deleteCollection: vi.fn(),
  allLibTags: [], search: '', setSearch: vi.fn(), sortBy: 'newest', setSortBy: vi.fn(),
  activeCollection: null, setActiveCollection: vi.fn(), activeTag: null, setActiveTag: vi.fn(),
  exportLib: vi.fn(), importLib: vi.fn(), updateEntries: vi.fn(), trackRecentAccess: vi.fn(),
};

// The same wiring App performs: hook state and handlers in, one object out.
function Harness({ notify, loadCaseIntoEditor = vi.fn(), runSingleCase = vi.fn() }) {
  const cases = useTestCases({ notify });
  return <LibraryWorkspace
    m={{}} lib={lib} loadEntry={vi.fn()} copy={vi.fn()}
    testCasesByPrompt={cases.testCasesByPrompt}
    testCaseControls={{
      evalRuns: [], runningCases: cases.runningCases,
      caseFormPromptId: cases.caseFormPromptId, editingCaseId: cases.editingCaseId,
      caseTitle: cases.caseTitle, setCaseTitle: cases.setCaseTitle,
      caseInput: cases.caseInput, setCaseInput: cases.setCaseInput,
      caseTraits: cases.caseTraits, setCaseTraits: cases.setCaseTraits,
      caseExclusions: cases.caseExclusions, setCaseExclusions: cases.setCaseExclusions,
      caseNotes: cases.caseNotes, setCaseNotes: cases.setCaseNotes,
      openCaseForm: cases.openCaseForm, resetCaseForm: cases.resetCaseForm,
      saveCaseForPrompt: cases.saveCaseForPrompt, removeCase: cases.removeCase,
      loadCaseIntoEditor, runSingleCase,
    }}
  />;
}

function openTestsTab() {
  fireEvent.click(screen.getByRole('button', { name: 'Inspect Alpha prompt' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Tests' }));
}

const casesRegion = () => screen.getByRole('region', { name: 'Test cases' });
const storedCases = () => JSON.parse(localStorage.getItem(FALLBACK_KEY) || '[]');

describe('Library Tests tab case workflow', () => {
  let confirmSpy;

  beforeEach(() => {
    localStorage.clear();
    confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    confirmSpy.mockRestore();
  });

  it('creates, edits and deletes a test case for a saved prompt', async () => {
    const notify = vi.fn();
    render(<Harness notify={notify} />);
    openTestsTab();
    expect(within(casesRegion()).getByText(/Test Cases \(0\)/)).toBeInTheDocument();

    // Create
    fireEvent.click(screen.getByRole('button', { name: 'Add Case' }));
    fireEvent.change(screen.getByLabelText('Test case title'), { target: { value: 'Executive brevity' } });
    fireEvent.change(screen.getByLabelText('Test case prompt input'), { target: { value: 'Summarize the Q3 outage report for the board.' } });
    fireEvent.change(screen.getByLabelText('Expected traits'), { target: { value: 'bullet points, executive' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Case' }));

    await waitFor(() => expect(within(casesRegion()).getByText(/Test Cases \(1\)/)).toBeInTheDocument());
    expect(casesRegion()).toHaveTextContent('Executive brevity');
    expect(casesRegion()).toHaveTextContent('Expect: bullet points, executive');
    expect(screen.queryByLabelText('Test case title')).not.toBeInTheDocument();
    expect(notify).toHaveBeenCalledWith('Saved test case: Executive brevity');
    expect(storedCases()).toHaveLength(1);
    expect(storedCases()[0]).toMatchObject({
      promptId: 'alpha', title: 'Executive brevity', input: 'Summarize the Q3 outage report for the board.',
      expectedTraits: ['bullet points', 'executive'], expectedExclusions: [],
    });
    const caseId = storedCases()[0].id;

    // Edit: the form reopens prefilled and updates the same record in place.
    fireEvent.click(within(casesRegion()).getByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText('Test case title')).toHaveValue('Executive brevity');
    expect(screen.getByLabelText('Expected traits')).toHaveValue('bullet points, executive');
    fireEvent.change(screen.getByLabelText('Expected exclusions'), { target: { value: 'jargon' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update Case' }));

    await waitFor(() => expect(casesRegion()).toHaveTextContent('Avoid: jargon'));
    expect(within(casesRegion()).getByText(/Test Cases \(1\)/)).toBeInTheDocument();
    expect(notify).toHaveBeenCalledWith('Updated test case: Executive brevity');
    expect(storedCases()).toHaveLength(1);
    expect(storedCases()[0]).toMatchObject({ id: caseId, expectedExclusions: ['jargon'] });

    // Delete
    fireEvent.click(within(casesRegion()).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(within(casesRegion()).getByText(/Test Cases \(0\)/)).toBeInTheDocument());
    expect(confirmSpy).toHaveBeenCalledWith('Delete test case "Executive brevity"?');
    expect(notify).toHaveBeenCalledWith('Test case deleted');
    expect(storedCases()).toEqual([]);
  });

  it('keeps the case when deletion is not confirmed', async () => {
    confirmSpy.mockReturnValue(false);
    render(<Harness notify={vi.fn()} />);
    openTestsTab();
    fireEvent.click(screen.getByRole('button', { name: 'Add Case' }));
    fireEvent.change(screen.getByLabelText('Test case prompt input'), { target: { value: 'Keep me' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Case' }));
    await waitFor(() => expect(within(casesRegion()).getByText(/Test Cases \(1\)/)).toBeInTheDocument());

    fireEvent.click(within(casesRegion()).getByRole('button', { name: 'Delete' }));

    expect(within(casesRegion()).getByText(/Test Cases \(1\)/)).toBeInTheDocument();
    expect(storedCases()).toHaveLength(1);
  });

  it('shows saved cases again after the workspace remounts', async () => {
    const first = render(<Harness notify={vi.fn()} />);
    openTestsTab();
    fireEvent.click(screen.getByRole('button', { name: 'Add Case' }));
    fireEvent.change(screen.getByLabelText('Test case title'), { target: { value: 'Survives reload' } });
    fireEvent.change(screen.getByLabelText('Test case prompt input'), { target: { value: 'Persist this input' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Case' }));
    await waitFor(() => expect(storedCases()).toHaveLength(1));
    first.unmount();

    render(<Harness notify={vi.fn()} />);
    openTestsTab();
    await waitFor(() => expect(within(casesRegion()).getByText(/Test Cases \(1\)/)).toBeInTheDocument());
    expect(casesRegion()).toHaveTextContent('Survives reload');
    expect(casesRegion()).toHaveTextContent('Persist this input');
  });

  it('hands the saved case to the Run and Use handlers', async () => {
    const runSingleCase = vi.fn();
    const loadCaseIntoEditor = vi.fn();
    render(<Harness notify={vi.fn()} runSingleCase={runSingleCase} loadCaseIntoEditor={loadCaseIntoEditor} />);
    openTestsTab();
    fireEvent.click(screen.getByRole('button', { name: 'Add Case' }));
    fireEvent.change(screen.getByLabelText('Test case title'), { target: { value: 'Runnable' } });
    fireEvent.change(screen.getByLabelText('Test case prompt input'), { target: { value: 'Run this' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Case' }));
    await waitFor(() => expect(within(casesRegion()).getByText(/Test Cases \(1\)/)).toBeInTheDocument());

    fireEvent.click(within(casesRegion()).getByRole('button', { name: 'Run' }));
    expect(runSingleCase).toHaveBeenCalledWith(expect.objectContaining({ promptId: 'alpha', title: 'Runnable', input: 'Run this' }), 'Alpha prompt');
    fireEvent.click(within(casesRegion()).getByRole('button', { name: 'Use' }));
    expect(loadCaseIntoEditor).toHaveBeenCalledWith(expect.objectContaining({ promptId: 'alpha', title: 'Runnable' }));
  });
});
