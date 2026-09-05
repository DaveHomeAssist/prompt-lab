import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import useABTest from '../hooks/useABTest.js';
import { getConfiguredProvidersDirect } from '../lib/desktopApi.js';

const {
  callModel,
  listEvalRuns,
  listExperiments,
  saveEvalRun,
  saveExperiment,
} = vi.hoisted(() => ({
  callModel: vi.fn(),
  listEvalRuns: vi.fn(),
  listExperiments: vi.fn(),
  saveEvalRun: vi.fn(),
  saveExperiment: vi.fn(),
}));

vi.mock('../api.js', () => ({ callModel }));
vi.mock('../experimentStore.js', () => ({
  listEvalRuns,
  listExperiments,
  saveEvalRun,
  saveExperiment,
}));

describe('model arena (multi-provider A/B)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listEvalRuns.mockResolvedValue([]);
    listExperiments.mockResolvedValue([]);
    saveEvalRun.mockResolvedValue(undefined);
  });

  it('routes a side through its selected provider and records it on the eval run', async () => {
    callModel.mockResolvedValue({ provider: 'ollama', model: 'llama3.2:3b', content: [{ text: 'out' }] });
    const { result } = renderHook(() => useABTest({ notify: vi.fn() }));

    act(() => {
      result.current.loadVariant('a', 'compare me', { entryId: 'entry-1', title: 'My Prompt' });
      result.current.setSideProvider('a', { provider: 'ollama', model: 'llama3.2:3b' });
    });
    await act(async () => { await result.current.runAB('a'); });

    expect(callModel).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'ollama',
      model: 'llama3.2:3b',
    }), { signal: expect.any(AbortSignal) });
    await waitFor(() => expect(saveEvalRun).toHaveBeenCalledWith(expect.objectContaining({
      promptId: 'entry-1',
      promptTitle: 'My Prompt',
      provider: 'ollama',
      model: 'llama3.2:3b',
      mode: 'ab',
    })));
  });

  it('keeps the legacy default payload when no provider is selected', async () => {
    callModel.mockResolvedValue({ provider: 'anthropic', model: 'claude-sonnet-4-6', content: [{ text: 'out' }] });
    const { result } = renderHook(() => useABTest({ notify: vi.fn() }));

    act(() => { result.current.loadVariant('b', 'plain'); });
    await act(async () => { await result.current.runAB('b'); });

    const payload = callModel.mock.calls[0][0];
    expect(payload.model).toBe('claude-sonnet-4-6');
    expect(payload).not.toHaveProperty('provider');
    await waitFor(() => expect(saveEvalRun).toHaveBeenCalledWith(expect.objectContaining({
      promptId: null,
      variantLabel: 'Variant B',
    })));
  });

  it('clears a side selection back to the default provider', () => {
    const { result } = renderHook(() => useABTest({ notify: vi.fn() }));
    act(() => { result.current.setSideProvider('a', { provider: 'openai', model: 'gpt-4o' }); });
    expect(result.current.abProviders.a).toEqual({ provider: 'openai', model: 'gpt-4o' });
    act(() => { result.current.setSideProvider('a', null); });
    expect(result.current.abProviders.a).toBeNull();
  });

  it('scales from two to five variants and runs every populated column concurrently', async () => {
    callModel.mockResolvedValue({ provider: 'mock', model: 'mock-model', content: [{ text: 'out' }] });
    const { result } = renderHook(() => useABTest({ notify: vi.fn() }));
    act(() => {
      result.current.setAbA((prev) => ({ ...prev, prompt: 'A' }));
      result.current.setAbB((prev) => ({ ...prev, prompt: 'B' }));
      result.current.addVariant();
    });
    act(() => { result.current.addVariant(); });
    act(() => { result.current.addVariant(); });
    expect(result.current.variants.map((variant) => variant.label)).toEqual(['A', 'B', 'C', 'D', 'E']);
    act(() => {
      ['c', 'd', 'e'].forEach((id) => result.current.setVariant(id, (prev) => ({ ...prev, prompt: id.toUpperCase() })));
    });
    await act(async () => { await result.current.runAll(); });
    expect(callModel).toHaveBeenCalledTimes(5);
    expect(result.current.variants.every((variant) => variant.response === 'out')).toBe(true);
  });

  it('promotes a completed sourced variant to the prompt golden response', () => {
    const pinGoldenResponse = vi.fn(() => true);
    const { result } = renderHook(() => useABTest({ notify: vi.fn() }));
    act(() => { result.current.loadVariant('a', 'prompt', { entryId: 'entry-1', title: 'Source' }); });
    act(() => { result.current.setAbA((prev) => ({ ...prev, response: 'winning output' })); });
    expect(result.current.promoteToGolden('a', pinGoldenResponse)).toBe(true);
    expect(pinGoldenResponse).toHaveBeenCalledWith('entry-1', expect.objectContaining({ text: 'winning output' }));
  });
});

describe('getConfiguredProvidersDirect', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('lists only providers with configured credentials', async () => {
    localStorage.setItem('pl2-provider-settings', JSON.stringify({
      apiKey: 'sk-ant-test',
      openaiApiKey: 'sk-oai-test',
      openaiModel: 'gpt-4o-mini',
      ollamaBaseUrl: 'http://localhost:11434',
    }));
    const providers = await getConfiguredProvidersDirect();
    expect(providers.map((p) => p.provider).sort()).toEqual(['anthropic', 'ollama', 'openai']);
    expect(providers.find((p) => p.provider === 'openai').model).toBe('gpt-4o-mini');
    expect(providers.find((p) => p.provider === 'ollama').model).toBeTruthy();
  });

  it('returns an empty list when nothing is configured', async () => {
    localStorage.setItem('pl2-provider-settings', JSON.stringify({}));
    expect(await getConfiguredProvidersDirect()).toEqual([]);
  });
});
