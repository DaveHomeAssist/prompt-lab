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

    expect(screen.getByText('No evaluate runs yet.')).toBeInTheDocument();
    expect(screen.getByText('Quick Start loads a starter prompt into Create so you can generate your first saved run.')).toBeInTheDocument();

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
