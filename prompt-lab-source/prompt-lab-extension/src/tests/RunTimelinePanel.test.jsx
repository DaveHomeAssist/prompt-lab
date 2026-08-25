import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RunTimelinePanel from '../RunTimelinePanel.jsx';

const useEvalRunsMock = vi.fn();

vi.mock('../hooks/useEvalRuns.js', () => ({
  default: (...args) => useEvalRunsMock(...args),
}));

vi.mock('../icons.jsx', () => ({
  default: () => null,
}));

const theme = {
  surface: 'bg-slate-900',
  border: 'border-slate-700',
  text: 'text-slate-100',
  textMuted: 'text-slate-400',
  textSub: 'text-slate-300',
  textBody: 'text-slate-100',
  codeBlock: 'bg-slate-800',
  input: 'bg-slate-950 text-slate-100 border-slate-700',
  btn: 'bg-slate-800',
  textAlt: 'text-slate-100',
  diffAdd: 'bg-emerald-500/20 text-emerald-100',
  diffDel: 'bg-red-500/20 text-red-100',
  diffEq: 'bg-slate-700 text-slate-100',
};

function renderPanel(overrides = {}) {
  return render(
    <RunTimelinePanel
      m={theme}
      prompt={null}
      copy={vi.fn()}
      compact={false}
      pageScroll={false}
      {...overrides}
    />
  );
}

describe('RunTimelinePanel', () => {
  beforeEach(() => {
    localStorage.clear();
    useEvalRunsMock.mockReset();
    useEvalRunsMock.mockReturnValue({
      evalRuns: [
        {
          id: 'run-1',
          provider: 'openai',
          model: 'gpt-4.1',
          mode: 'enhance',
          status: 'success',
          createdAt: '2026-03-24T10:00:00.000Z',
          output: 'First output',
          latencyMs: 420,
        },
        {
          id: 'run-2',
          provider: 'anthropic',
          model: 'claude-3.7-sonnet',
          mode: 'ab',
          status: 'error',
          createdAt: '2026-03-24T11:00:00.000Z',
          output: 'Second output',
          latencyMs: 560,
        },
      ],
      totalRuns: 2,
      loading: false,
      error: null,
      hasMore: false,
      loadMore: vi.fn(),
      refreshEvalRuns: vi.fn(),
      updateRun: vi.fn(),
    });
  });

  // M-2: with no prompt selected the query used to pin mode:'enhance' behind
  // the panel's back, so "All modes" hid A/B and test-case runs. The Evaluate
  // timeline must request exactly what its filter controls say.
  it('queries all modes when no prompt is selected and mode is All modes', () => {
    renderPanel();

    expect(useEvalRunsMock).toHaveBeenCalled();
    const query = useEvalRunsMock.mock.calls.at(-1)[0];
    expect(query).toMatchObject({ promptId: null, mode: '' });
    expect(query).not.toHaveProperty('defaultMode');
  });

  it('rehydrates persisted Evaluate filters on mount', () => {
    localStorage.setItem('pl2-evaluate-timeline-filters', JSON.stringify({
      mode: 'ab',
      provider: 'openai',
      model: 'gpt-4.1',
      status: 'success',
      dateRange: '90d',
      search: 'latency',
      showModelCompare: true,
    }));

    renderPanel();

    expect(screen.getByLabelText('Filter by mode')).toHaveValue('ab');
    expect(screen.getByLabelText('Filter by provider')).toHaveValue('openai');
    expect(screen.getByLabelText('Filter by model')).toHaveValue('gpt-4.1');
    expect(screen.getByLabelText('Filter by status')).toHaveValue('success');
    expect(screen.getByLabelText('Filter by date range')).toHaveValue('90d');
    expect(screen.getByPlaceholderText('Search runs…')).toHaveValue('latency');
    expect(screen.getByText('Model Comparison (latest per model)')).toBeInTheDocument();
    expect(screen.getByText('Filtered view')).toBeInTheDocument();
    expect(screen.getByText('Mode: A/B')).toBeInTheDocument();
  });

  it('persists filter edits and supports resetting them', async () => {
    renderPanel();

    fireEvent.change(screen.getByLabelText('Filter by mode'), { target: { value: 'ab' } });
    fireEvent.change(screen.getByPlaceholderText('Search runs…'), { target: { value: 'regression' } });

    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem('pl2-evaluate-timeline-filters'))).toMatchObject({
        mode: 'ab',
        search: 'regression',
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Reset Filters' }));

    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem('pl2-evaluate-timeline-filters'))).toEqual({
        mode: '',
        provider: '',
        model: '',
        status: '',
        verdict: '',
        regression: false,
        dateRange: '30d',
        search: '',
        showModelCompare: false,
      });
    });

    expect(screen.getByLabelText('Filter by mode')).toHaveValue('');
    expect(screen.getByPlaceholderText('Search runs…')).toHaveValue('');
  });

  it('shows quick-start actions when the global evaluate timeline is empty', () => {
    const onQuickStart = vi.fn();
    const onOpenCompare = vi.fn();

    useEvalRunsMock.mockReturnValue({
      evalRuns: [],
      totalRuns: 0,
      loading: false,
      error: null,
      hasMore: false,
      loadMore: vi.fn(),
      refreshEvalRuns: vi.fn(),
      updateRun: vi.fn(),
    });

    renderPanel({ onQuickStart, onOpenCompare });

    expect(screen.getByText('Evaluate deck')).toBeInTheDocument();
    expect(screen.getByText('Compare saved runs and keep the winners.')).toBeInTheDocument();
    expect(screen.getByText('No evaluate runs yet.')).toBeInTheDocument();
    expect(screen.getByText('Quick Start loads a starter prompt into Create so you can generate your first saved run.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Quick Start' })).toHaveClass('bg-orange-500/90', 'hover:bg-orange-400');

    fireEvent.click(screen.getByRole('button', { name: 'Quick Start' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Compare' }));

    expect(onQuickStart).toHaveBeenCalledTimes(1);
    expect(onOpenCompare).toHaveBeenCalledTimes(1);
  });

  it('uses an Open Create CTA for prompt-scoped empty history', () => {
    const onQuickStart = vi.fn();

    useEvalRunsMock.mockReturnValue({
      evalRuns: [],
      totalRuns: 0,
      loading: false,
      error: null,
      hasMore: false,
      loadMore: vi.fn(),
      refreshEvalRuns: vi.fn(),
      updateRun: vi.fn(),
    });

    renderPanel({
      prompt: { id: 'prompt-1', title: 'Launch Notes' },
      onQuickStart,
    });

    expect(screen.getByText('No runs for this prompt yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Create' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open Compare' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open Create' }));

    expect(onQuickStart).toHaveBeenCalledTimes(1);
  });

  // M-2: Evaluate rendered a verdict select and a "Regressions only" toggle,
  // badged them as active filters, and never passed either into the query --
  // so both controls changed the chrome while the run list stayed put.
  it('passes the verdict and regression filters into the run query', async () => {
    renderPanel();

    fireEvent.change(screen.getByLabelText('Filter by verdict'), { target: { value: 'fail' } });

    await waitFor(() => {
      expect(useEvalRunsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ verdict: 'fail' })
      );
    });

    fireEvent.click(screen.getByRole('button', { name: 'Regressions' }));

    await waitFor(() => {
      expect(useEvalRunsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ verdict: 'fail', regression: true })
      );
    });
  });

  it('rehydrates a persisted verdict and regression filter into the query', () => {
    localStorage.setItem('pl2-evaluate-timeline-filters', JSON.stringify({
      mode: '',
      provider: '',
      model: '',
      status: '',
      verdict: 'pass',
      regression: true,
      dateRange: '30d',
      search: '',
      showModelCompare: false,
    }));

    renderPanel();

    expect(screen.getByLabelText('Filter by verdict')).toHaveValue('pass');
    expect(useEvalRunsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ verdict: 'pass', regression: true })
    );
  });

  it('shows a no-match state when filters are active but no runs match', () => {
    localStorage.setItem('pl2-evaluate-timeline-filters', JSON.stringify({
      mode: '',
      provider: '',
      model: '',
      status: '',
      dateRange: '30d',
      search: 'regression',
      showModelCompare: false,
    }));

    useEvalRunsMock.mockReturnValue({
      evalRuns: [],
      totalRuns: 0,
      loading: false,
      error: null,
      hasMore: false,
      loadMore: vi.fn(),
      refreshEvalRuns: vi.fn(),
      updateRun: vi.fn(),
    });

    renderPanel();

    expect(screen.getByText('No runs match current filters.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset All Filters' })).toBeInTheDocument();
  });

  it('keeps the Compare Models toggle visible when the persisted compare view is active', () => {
    localStorage.setItem('pl2-evaluate-timeline-filters', JSON.stringify({
      mode: '',
      provider: '',
      model: '',
      status: '',
      dateRange: '30d',
      search: '',
      showModelCompare: true,
    }));

    useEvalRunsMock.mockReturnValue({
      evalRuns: [
        {
          id: 'run-1',
          provider: 'openai',
          model: 'gpt-4.1',
          mode: 'enhance',
          status: 'success',
          createdAt: '2026-03-24T10:00:00.000Z',
          output: 'First output',
          latencyMs: 420,
        },
      ],
      totalRuns: 1,
      loading: false,
      error: null,
      hasMore: false,
      loadMore: vi.fn(),
      refreshEvalRuns: vi.fn(),
      updateRun: vi.fn(),
    });

    renderPanel();

    expect(screen.getByRole('button', { name: 'Compare Models' })).toBeInTheDocument();
    expect(screen.getByText('Model compare')).toBeInTheDocument();
  });

  it('renders an error banner and retries the timeline fetch', () => {
    const refreshEvalRuns = vi.fn();

    useEvalRunsMock.mockReturnValue({
      evalRuns: [],
      totalRuns: 0,
      loading: false,
      error: 'IndexedDB unavailable',
      hasMore: false,
      loadMore: vi.fn(),
      refreshEvalRuns,
      updateRun: vi.fn(),
    });

    renderPanel();

    expect(screen.getByRole('alert')).toHaveTextContent('Evaluate timeline unavailable');
    expect(screen.getByRole('alert')).toHaveTextContent('IndexedDB unavailable');

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(refreshEvalRuns).toHaveBeenCalledTimes(1);
  });
});
