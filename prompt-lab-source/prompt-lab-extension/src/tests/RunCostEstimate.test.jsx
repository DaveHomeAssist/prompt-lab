import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getActiveProvider, watchActiveProvider } = vi.hoisted(() => ({
  getActiveProvider: vi.fn(),
  watchActiveProvider: vi.fn(() => () => {}),
}));

vi.mock('../lib/platform.js', () => ({
  getActiveProvider,
  watchActiveProvider,
}));

import RunCostEstimate from '../RunCostEstimate.jsx';

describe('RunCostEstimate', () => {
  beforeEach(() => {
    localStorage.setItem('pl2-provider-settings', JSON.stringify({
      provider: 'anthropic',
      anthropicModel: 'claude-sonnet-4-6',
      apiKey: 'sk-ant-present',
    }));
    getActiveProvider.mockReset();
    watchActiveProvider.mockClear();
  });

  it('prices the provider the platform helper returns, not the web localStorage key', async () => {
    getActiveProvider.mockResolvedValue({ provider: 'openai', model: 'gpt-4o-mini' });
    render(<RunCostEstimate text={'a'.repeat(400)} />);
    const note = await screen.findByTestId('run-cost-estimate');
    await waitFor(() => expect(note).toHaveTextContent('gpt-4o-mini'));
    expect(note).not.toHaveTextContent('claude-sonnet-4-6');
    expect(note.textContent).not.toContain('sk-ant-present');
    expect(getActiveProvider).toHaveBeenCalled();
    expect(watchActiveProvider).toHaveBeenCalled();
  });
});