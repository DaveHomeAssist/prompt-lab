import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import usePromptVariableGate from '../hooks/usePromptVariableGate.js';

describe('usePromptVariableGate prompt key', () => {
  beforeEach(() => { localStorage.clear(); });

  it('remembers values for the copied prompt, not the prompt open in Write, and keeps them after the text changes', async () => {
    const { result } = renderHook(() => usePromptVariableGate({ promptId: 'handoff' }));
    const copied = 'Hello {{customer_name}} from {{company}}';

    let pending;
    await act(async () => { pending = result.current.prepare(copied, 'id:followup'); });
    await waitFor(() => expect(result.current.request?.promptKey).toBe('id:followup'));
    await act(async () => { result.current.submit({ customer_name: 'Maya', company: 'Acme' }); });
    await expect(pending).resolves.toEqual({ cancelled: false, text: 'Hello Maya from Acme' });

    await act(async () => { pending = result.current.prepare('Hello {{customer_name}} from {{company}} — edited', 'id:followup'); });
    await waitFor(() => expect(result.current.request?.values).toEqual({ customer_name: 'Maya', company: 'Acme' }));
    expect(result.current.request.promptKey).toBe('id:followup');
    await act(async () => { result.current.cancel(); });
    await pending;

    await act(async () => { pending = result.current.prepare(copied); });
    await waitFor(() => expect(result.current.request?.promptKey).toBe('id:handoff'));
    expect(result.current.request.values.customer_name).toBe('');
    expect(result.current.request.values.company).toBe('');
    await act(async () => { result.current.cancel(); });

    const stored = JSON.parse(localStorage.getItem('pl2-prompt-variable-values'));
    expect(stored['id:followup'].customer_name.last).toBe('Maya');
    expect(stored['id:handoff']).toBeUndefined();
  });

  it('accepts the key on an options object and prefers it over the open prompt', async () => {
    const { result } = renderHook(() => usePromptVariableGate({ promptId: 'handoff' }));
    let pending;
    await act(async () => { pending = result.current.prepare('Hi {{name}}', { promptKey: 'id:followup' }); });
    await waitFor(() => expect(result.current.request?.promptKey).toBe('id:followup'));
    await act(async () => { result.current.cancel(); });
    await pending;
  });
});
