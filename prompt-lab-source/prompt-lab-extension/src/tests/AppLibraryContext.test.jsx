import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { canonical, createCommandService, createMemoryAdapter, LibraryError } from '../../../library-storage/contract.mjs';
import { captureSourceInventory } from '../../../library-storage/source-inventory.mjs';
import { createCommandOutbox } from '../../../library-storage/command-outbox.mjs';
import { createServiceTransport } from '../../../library-storage/command-client.mjs';
import { createAppLibraryRepository } from '../lib/appLibraryRepository.js';
import { AppLibraryProvider } from '../lib/AppLibraryContext.jsx';
import useTestCases from '../hooks/useTestCases.js';
import useEvalRuns from '../hooks/useEvalRuns.js';
import useABTest from '../hooks/useABTest.js';
import ChainRunnerPanel from '../ChainRunnerPanel.jsx';
import FollowUpOrigin from '../FollowUpOrigin.jsx';
import { callModel } from '../api.js';
import { retryPendingWrites } from '../lib/writeRecovery.js';
import { emit } from '../lib/runEmitter.js';
import { createRunPersistence } from '../lib/runPersistence.js';
import { MemoryRouter } from 'react-router-dom';
import App from '../App.jsx';
import useExecutionFlow from '../hooks/useExecutionFlow.js';

vi.mock('../api.js', () => ({ callModel: vi.fn() }));
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function fixture() {
  const libraryId = crypto.randomUUID();
  const workspace = { library: [{ id: 'prompt', title: 'Folder prompt', original: 'Prompt body' }],
    evaluations: [{ id: 'eval', promptId: 'prompt', input: 'Source', output: 'Folder output', mode: 'enhance' }],
    testCases: [{ id: 'case', promptId: 'prompt', title: 'Folder case', input: 'Original case',
      future: { preserve: ['unknown', 'fields'] }, createdAt: '2026-01-01T00:00:00Z' }] };
  const entries = { 'pl2-library': JSON.stringify(workspace.library), 'pl2-library-trash': '[]' };
  const inventory = await captureSourceInventory({ surface: 'web', sourceIdentity: libraryId,
    localStorage: { length: 2, key: i => Object.keys(entries)[i], getItem: key => entries[key] ?? null },
    readIndexedStore: async () => ({ state: 'absent', reason: 'Synthetic fixture' }), archives: { reviewed: true, records: [] } });
  const service = createCommandService(createMemoryAdapter());
  const copied = await service.apply({ ...await service.preview({ mode: 'import', libraryId, expectedRevision: null,
    sourceText: JSON.stringify(workspace), sourceInventory: inventory }), idempotencyKey: 'import' });
  await service.apply({ ...await service.previewCurrentView({ libraryId, expectedRevision: copied.revision }), idempotencyKey: 'select' });
  const transport = createServiceTransport(service, { libraryId });
  let offline = false;
  function client() {
    const rows = new Map();
    return createAppLibraryRepository({ libraryId, sourceBinding: copied.sourceBinding,
      transport: { ...transport, identity: async () => {
        if (offline) throw new LibraryError('SERVICE_UNAVAILABLE', 'Service offline');
        return transport.identity();
      } },
      outbox: createCommandOutbox({
        async read(lib, op) { return structuredClone(rows.get(canonical([lib, op])) ?? null); },
        async list(lib) { return structuredClone([...rows.values()].filter(row => row.libraryId === lib)); },
        async write(row, version) {
          const key = canonical([row.libraryId, row.operationId]);
          if ((rows.get(key)?.version ?? null) !== version) throw new Error('Fixture concurrent write');
          rows.set(key, structuredClone(row));
        },
      }),
    });
  }
  const repository = client(); await repository.open();
  const wrapper = ({ children }) => <AppLibraryProvider repository={repository}>{children}</AppLibraryProvider>;
  const notify = vi.fn();
  for (const key of ['pl2-library', 'pl2-eval-run-fallback', 'pl2-test-case-fallback', 'pl2-run-fallback', 'pl2-experiment-fallback']) {
    localStorage.setItem(key, JSON.stringify([{ id: `legacy-${key}`, input: 'Unrelated local record' }]));
  }
  const legacy = { ...localStorage };
  return { libraryId, service, repository, client, wrapper, notify, legacy, setOffline: value => { offline = value; } };
}

it('test case edits and deletion use the selected library and preserve unknown fields', async () => {
  const f = await fixture();
  const { result } = renderHook(() => useTestCases({ notify: f.notify }), { wrapper: f.wrapper });
  await waitFor(() => expect(result.current.testCasesByPrompt.prompt).toHaveLength(1));
  act(() => { result.current.openCaseForm('prompt', result.current.testCasesByPrompt.prompt[0]); result.current.setCaseInput('Edited input'); });
  await act(async () => { await result.current.saveCaseForPrompt('prompt'); });
  const record = await f.repository.readRecord('test-cases', 'case');
  expect(record).toMatchObject({ input: 'Edited input', future: { preserve: ['unknown', 'fields'] }, createdAt: '2026-01-01T00:00:00Z' });
  expect(result.current.caseFormPromptId).toBeNull();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  await act(async () => { await result.current.removeCase(result.current.testCasesByPrompt.prompt[0]); });
  expect(await f.repository.readDomain('test-cases')).toEqual([]);
  expect(Object.fromEntries(Object.keys(f.legacy).map(key => [key, localStorage.getItem(key)]))).toEqual(f.legacy);
});

it.each(['edit', 'delete'])('a stale test case %s rejects an independent client change without losing the draft', async action => {
  const f = await fixture(), other = f.client(); await other.open();
  const { result } = renderHook(() => useTestCases({ notify: f.notify }), { wrapper: f.wrapper });
  await waitFor(() => expect(result.current.testCasesByPrompt.prompt).toHaveLength(1));
  const shown = result.current.testCasesByPrompt.prompt[0];
  act(() => { result.current.openCaseForm('prompt', shown); result.current.setCaseInput('Retained draft'); });
  await other.saveRecord('test-cases', { ...await other.readRecord('test-cases', 'case'), input: 'Independent client edit' });
  await act(async () => { await result.current.refreshTestCases(); });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  await act(async () => {
    if (action === 'edit') await result.current.saveCaseForPrompt('prompt');
    else await result.current.removeCase(shown);
  });
  expect(result.current.caseInput).toBe('Retained draft');
  expect(result.current.caseFormPromptId).toBe('prompt');
  expect((await other.readRecord('test-cases', 'case')).input).toBe('Independent client edit');
  expect(f.notify).not.toHaveBeenCalledWith('Test case deleted');
  expect(f.notify).toHaveBeenLastCalledWith(expect.stringMatching(/changed|version|conflict|Reload/i));
  expect(Object.fromEntries(Object.keys(f.legacy).map(key => [key, localStorage.getItem(key)]))).toEqual(f.legacy);
  // An explicit fresh review replaces the failed intent, never an automatic retry.
  act(() => result.current.openCaseForm('prompt', result.current.testCasesByPrompt.prompt[0]));
  await act(async () => { await result.current.saveCaseForPrompt('prompt'); });
});

it('an offline case save keeps its draft and retries once in the same library', async () => {
  const f = await fixture();
  const { result } = renderHook(() => useTestCases({ notify: f.notify }), { wrapper: f.wrapper });
  await waitFor(() => expect(result.current.testCasesByPrompt.prompt).toHaveLength(1));
  act(() => { result.current.openCaseForm('prompt'); result.current.setCaseInput('Offline draft'); });
  f.setOffline(true);
  await act(async () => { await result.current.saveCaseForPrompt('prompt'); });
  expect(result.current.caseInput).toBe('Offline draft');
  expect(result.current.caseFormPromptId).toBe('prompt');
  expect(Object.fromEntries(Object.keys(f.legacy).map(key => [key, localStorage.getItem(key)]))).toEqual(f.legacy);
  f.setOffline(false);
  await act(async () => { await retryPendingWrites(); await result.current.saveCaseForPrompt('prompt'); });
  expect((await f.repository.readDomain('test-cases')).filter(row => row.input === 'Offline draft')).toHaveLength(1);
  expect(result.current.caseFormPromptId).toBeNull();
  expect(Object.fromEntries(Object.keys(f.legacy).map(key => [key, localStorage.getItem(key)]))).toEqual(f.legacy);
});

it('Evaluate reads and updates the selected library with no local fallback on failure', async () => {
  const f = await fixture();
  const { result } = renderHook(() => useEvalRuns({ tab: 'history' }), { wrapper: f.wrapper });
  await waitFor(() => expect(result.current.evalRuns).toHaveLength(1));
  expect(result.current.evalRuns[0].output).toBe('Folder output');
  await act(async () => expect(await result.current.updateRun('eval', { notes: 'Reviewed' })).toBe(true));
  expect((await f.repository.readRecord('evaluations', 'eval')).notes).toBe('Reviewed');
  f.setOffline(true);
  await act(async () => { await result.current.refreshEvalRuns(); });
  expect(result.current.error).toBe('Service offline');
  expect(result.current.evalRuns).toEqual([]);
  expect(Object.fromEntries(Object.keys(f.legacy).map(key => [key, localStorage.getItem(key)]))).toEqual(f.legacy);
});

it('Evaluate rejects an edit to the displayed version even if another read refreshes the repository', async () => {
  const f = await fixture(), other = f.client(); await other.open();
  const { result } = renderHook(() => useEvalRuns({ tab: 'history' }), { wrapper: f.wrapper });
  await waitFor(() => expect(result.current.evalRuns).toHaveLength(1));
  await other.saveRecord('evaluations', { ...await other.readRecord('evaluations', 'eval'), notes: 'Independent review' });
  await f.repository.readDomain('evaluations');
  await act(async () => expect(await result.current.updateRun('eval', { notes: 'Stale review' })).toBe(false));
  expect((await other.readRecord('evaluations', 'eval')).notes).toBe('Independent review');
  await act(async () => { await result.current.refreshEvalRuns(); });
  await act(async () => expect(await result.current.updateRun('eval', { notes: 'Reviewed current version' })).toBe(true));
});

it('a test case acknowledgement cannot clear text typed while its save is pending', async () => {
  const f = await fixture();
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  const entered = vi.fn();
  const held = { ...f.repository, saveRecord: async (...args) => { entered(); await barrier; return f.repository.saveRecord(...args); } };
  const wrapper = ({ children }) => <AppLibraryProvider repository={held}>{children}</AppLibraryProvider>;
  const { result } = renderHook(() => useTestCases({ notify: f.notify }), { wrapper });
  await waitFor(() => expect(result.current.testCasesByPrompt.prompt).toHaveLength(1));
  act(() => { result.current.openCaseForm('prompt'); result.current.setCaseInput('First draft'); });
  let saving;
  act(() => { saving = result.current.saveCaseForPrompt('prompt'); });
  await waitFor(() => expect(entered).toHaveBeenCalledOnce());
  act(() => result.current.setCaseInput('Newer draft'));
  await act(async () => { release(); await saving; });
  expect(result.current.caseInput).toBe('Newer draft');
  expect(result.current.caseFormPromptId).toBe('prompt');
  expect((await f.repository.readDomain('test-cases')).filter(row => row.input === 'First draft')).toHaveLength(1);
  await act(async () => { await result.current.saveCaseForPrompt('prompt'); });
  const cases = await f.repository.readDomain('test-cases');
  expect(cases).toHaveLength(2);
  expect(cases.some(row => row.input === 'Newer draft')).toBe(true);
  expect(result.current.caseFormPromptId).toBeNull();
});

it('Compare saves its model result and winning experiment in the selected library', async () => {
  const f = await fixture();
  callModel.mockResolvedValue({ content: [{ text: 'Compared answer' }], provider: 'anthropic', model: 'fixture' });
  const { result } = renderHook(() => useABTest({ notify: f.notify }), { wrapper: f.wrapper });
  act(() => result.current.setVariant('a', state => ({ ...state, prompt: 'Comparison input' })));
  await act(async () => { await result.current.runAB('a'); });
  await act(async () => { await result.current.pickWinner('A'); });
  expect((await f.repository.readDomain('evaluations')).find(row => row.mode === 'ab')).toMatchObject({ input: 'Comparison input', output: 'Compared answer' });
  expect(await f.repository.readDomain('experiments')).toHaveLength(1);
  expect(callModel).toHaveBeenCalledTimes(1);
  expect(Object.fromEntries(Object.keys(f.legacy).map(key => [key, localStorage.getItem(key)]))).toEqual(f.legacy);
});

it('provenance reads the selected library source output', async () => {
  const f = await fixture();
  render(<FollowUpOrigin origin={{ sourceRunId: 'eval', sourceTitle: 'Source' }} />, { wrapper: f.wrapper });
  fireEvent.click(screen.getByRole('button', { name: 'View source output' }));
  expect(await screen.findByText('Folder output')).toBeVisible();
  expect(Object.fromEntries(Object.keys(f.legacy).map(key => [key, localStorage.getItem(key)]))).toEqual(f.legacy);
});

it('the actual App opens the selected library rather than the legacy prompt list', async () => {
  const f = await fixture();
  render(<MemoryRouter initialEntries={['/library']}><App libraryRepository={f.repository} /></MemoryRouter>);
  expect(await screen.findByText('Folder prompt')).toBeVisible();
  expect(screen.queryByText('Unrelated local record')).not.toBeInTheDocument();
  expect(Object.fromEntries(Object.keys(f.legacy).map(key => [key, localStorage.getItem(key)]))).toEqual(f.legacy);
});

it('the execution controller saves a test case result in the selected library', async () => {
  const f = await fixture();
  callModel.mockResolvedValue({ content: [{ text: JSON.stringify({ enhanced: 'Executed case result' }) }], provider: 'anthropic', model: 'fixture' });
  const { result } = renderHook(() => useExecutionFlow({
    ui: { notify: f.notify, setTab() {}, tab: 'editor' }, lib: { library: [] },
    editor: { raw: '', enhanced: '', variants: [], notes: '', enhMode: 'balanced' },
    persistence: { editingId: 'prompt', saveTitle: 'Folder prompt' },
  }), { wrapper: f.wrapper });
  await act(async () => {
    await result.current.runSingleCase({ id: 'case', promptId: 'prompt', title: 'Folder case', input: 'Run this case' }, 'Folder prompt');
  });
  expect((await f.repository.readDomain('evaluations')).find(row => row.testCaseId === 'case')).toMatchObject({ input: 'Run this case', output: 'Executed case result' });
  expect(Object.fromEntries(Object.keys(f.legacy).map(key => [key, localStorage.getItem(key)]))).toEqual(f.legacy);
});

it('Chain Lab stores complete trace history before displaying its graph', async () => {
  const f = await fixture();
  const output = 'Complete step result. '.repeat(1000) + 'Retained ending.';
  callModel.mockResolvedValue({ content: [{ text: output }] });
  render(<ChainRunnerPanel m={{}} notify={f.notify} library={[{ id: 'chain', title: 'Chain',
    metadata: { chain: { version: 1, steps: [{ label: 'One', template: 'Produce a result' }] } } }]} />, { wrapper: f.wrapper });
  fireEvent.click(screen.getByRole('button', { name: 'Run Chain' }));
  expect(await screen.findByTestId('chain-trace-graph')).toBeVisible();
  const records = await f.repository.readDomain('execution-traces');
  expect(records).toHaveLength(2);
  expect(records.find(row => row.run_type === 'llm').outputs.text).toBe(output);
  expect(f.notify).toHaveBeenCalledWith('Chain finished: 1 steps.');
  expect(Object.fromEntries(Object.keys(f.legacy).map(key => [key, localStorage.getItem(key)]))).toEqual(f.legacy);
});

it('trace ownership drains pending writes, rejects failed persistence and ignores other traces', async () => {
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  const saved = [];
  const persistence = createRunPersistence({ traceId: 'owned', saveRecord: async record => {
    await barrier; saved.push(record.run_id);
    if (record.run_id === 'failure') throw new Error('Disk unavailable');
  } });
  emit('run:end', { trace_id: 'other', run_id: 'unrelated' });
  emit('run:end', { trace_id: 'owned', run_id: 'first' });
  emit('run:error', { trace_id: 'owned', run_id: 'failure' });
  let settled = false;
  const finished = persistence.finish();
  const assertion = expect(finished).rejects.toThrow('Disk unavailable').then(() => { settled = true; });
  await Promise.resolve(); expect(settled).toBe(false);
  emit('run:end', { trace_id: 'owned', run_id: 'after-finish' });
  release(); await assertion;
  expect(saved).toEqual(['first', 'failure']);
  expect(persistence.finish()).toBe(finished);
});
