import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import usePromptVariableGate from '../hooks/usePromptVariableGate.js';

describe('usePromptVariableGate', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('uses the entered values when recent-value storage throws', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    const { result } = renderHook(() => usePromptVariableGate({ promptId: 'prompt-1' }));
    let pending;
    await act(async () => { pending = result.current.prepare('Hello {{name|Ada}}'); });
    await waitFor(() => expect(result.current.request?.manual?.[0]?.name).toBe('name'));
    await act(async () => { result.current.submit({ name: 'Sam' }); });
    await expect(pending).resolves.toEqual({ cancelled: false, text: 'Hello Sam' });
    expect(result.current.request).toBeNull();
  });
});