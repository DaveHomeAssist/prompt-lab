import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import useSensitivePreflight from '../hooks/useSensitivePreflight.js';
import { PROVIDER_SETTINGS_CHANGED } from '../lib/providerSettingsEvents.js';

const payload = () => ({ messages: [{ role: 'user', content: 'Contact person@example.com' }] });

describe('sensitive preflight approval', () => {
  it('queues scopes and binds each action to the visible immutable payload once', async () => {
    const resumeA = vi.fn();
    const resumeB = vi.fn();
    const original = payload();
    const { result } = renderHook(useSensitivePreflight);
    act(() => {
      result.current.review({ scope: 'a', payload: original, isCurrent: () => true, resume: resumeA });
      result.current.review({ scope: 'b', payload: payload(), isCurrent: () => true, resume: resumeB });
    });
    original.messages[0].content = 'Changed after review';
    const send = result.current.piiSendAnyway;
    await act(async () => { await send(); await send(); });
    expect(resumeA).toHaveBeenCalledExactlyOnceWith(payload());
    expect(resumeB).not.toHaveBeenCalled();
    expect(result.current.piiWarning.scope).toBe('b');
    await act(async () => result.current.piiRedactAndSend());
    expect(resumeB.mock.calls[0][0].messages[0].content).not.toContain('person@example.com');
  });

  it.each(['stale owner', 'cancel', 'settings', 'storage', 'unmount'])('revokes approval on %s', async (reason) => {
    const resume = vi.fn();
    let current = true;
    const { result, unmount } = renderHook(useSensitivePreflight);
    act(() => result.current.review({ scope: 'a', payload: payload(), isCurrent: () => current, resume }));
    const send = result.current.piiSendAnyway;
    act(() => {
      if (reason === 'stale owner') current = false;
      if (reason === 'cancel') result.current.piiCancel();
      if (reason === 'settings') window.dispatchEvent(new Event(PROVIDER_SETTINGS_CHANGED));
      if (reason === 'storage') window.dispatchEvent(new StorageEvent('storage', { key: 'pl2-provider-settings' }));
      if (reason === 'unmount') unmount();
    });
    await act(async () => send());
    expect(resume).not.toHaveBeenCalled();
  });
});
