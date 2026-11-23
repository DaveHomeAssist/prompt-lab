import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rememberVariableValues } = vi.hoisted(() => ({
  rememberVariableValues: vi.fn(() => {
    throw new Error('quota');
  }),
}));

vi.mock('../lib/promptVariables.js', async (importOriginal) => ({
  ...(await importOriginal()),
  rememberVariableValues,
}));

import usePromptVariableGate from '../hooks/usePromptVariableGate.js';

describe('usePromptVariableGate', () => {
  beforeEach(() => { rememberVariableValues.mockClear(); });

  it('submits the entered values when remembering them throws', async () => {
    const { result } = renderHook(() => usePromptVariableGate({ promptId: 'prompt-1' }));
    let pending;
    await act(async () => { pending = result.current.prepare('Hello {{name|Ada}}'); });
    await waitFor(() => expect(result.current.request?.manual?.[0]?.name).toBe('name'));
    await act(async () => { result.current.submit({ name: 'Sam' }); });
    await expect(pending).resolves.toEqual({ cancelled: false, text: 'Hello Sam' });
    expect(result.current.request).toBeNull();
    expect(rememberVariableValues).toHaveBeenCalled();
  });
});
