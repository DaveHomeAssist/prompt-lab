import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { callModel } from '../api.js';
import usePromptChat from '../hooks/usePromptChat.js';
import { buildChatPayload, CHAT_MAX_CHARS, CHAT_MAX_MESSAGES } from '../lib/promptChat.js';
import { PROVIDER_SETTINGS_CHANGED } from '../lib/providerSettingsEvents.js';

vi.mock('../api.js', () => ({ callModel: vi.fn() }));
const response = text => ({ content: [{ type: 'text', text }], provider: 'anthropic', model: 'selected-model' });
beforeEach(() => { callModel.mockReset(); localStorage.clear(); });
afterEach(cleanup);
const useChat = props => renderHook(current => usePromptChat({ prompt: 'Original prompt', ownerId: 'one', ...current }), { initialProps: props || {} });

it('builds a real multi-turn envelope and excludes prompt context by default', () => {
  const payload = buildChatPayload({ messages: [{ role: 'user', content: 'First' }, { role: 'assistant', content: 'Reply' }], input: 'Next', prompt: 'PRIVATE CONTEXT' });
  expect(payload.messages.map(message => message.role)).toEqual(['user', 'assistant', 'user']);
  expect(JSON.stringify(payload)).not.toContain('PRIVATE CONTEXT');
  expect(payload.max_tokens).toBe(1024);
  expect(buildChatPayload({ input: 'Ask', prompt: 'Context', includePrompt: true }).system).toContain('Context');
  expect(() => buildChatPayload({ input: ' '.repeat(3) })).toThrow('Write a message');
  expect(() => buildChatPayload({ input: 'a'.repeat(CHAT_MAX_CHARS) })).toThrow('too long');
  expect(() => buildChatPayload({ input: 'Next', messages: Array.from({length: CHAT_MAX_MESSAGES}, () => ({role:'user',content:'old'})) })).toThrow('full');
});

it('does not call on mount and sends successful history without duplicating turns', async () => {
  callModel.mockResolvedValueOnce(response('First answer')).mockResolvedValueOnce(response('Second answer'));
  const { result } = useChat();
  expect(callModel).not.toHaveBeenCalled();
  act(() => result.current.setInput('First question'));
  await act(async () => { await result.current.send(); });
  expect(result.current.messages).toHaveLength(2);
  expect(result.current.input).toBe('');
  expect(result.current.messages[1]).toMatchObject({content:'First answer', model:'selected-model',draft:'Original prompt'});
  act(() => result.current.setInput('Second question'));
  await act(async () => { await result.current.send(); });
  expect(callModel.mock.calls[1][0].messages).toEqual([{role:'user',content:'First question'},{role:'assistant',content:'First answer'},{role:'user',content:'Second question'}]);
  expect(result.current.messages).toHaveLength(4);
  expect(localStorage.length).toBe(0);
});

it('guards duplicate sends, cancels transport and ignores a late successful response', async () => {
  let resolve;
  callModel.mockImplementation(() => new Promise(done => { resolve = done; }));
  const { result } = useChat();
  act(() => result.current.setInput('Question'));
  let pending;
  act(() => { pending = result.current.send(); result.current.send(); });
  expect(callModel).toHaveBeenCalledTimes(1);
  expect(result.current.loading).toBe(true);
  act(() => result.current.cancel());
  expect(callModel.mock.calls[0][1].signal.aborted).toBe(true);
  await act(async () => { resolve(response('Too late')); await pending; });
  expect(result.current.messages).toEqual([]);
  expect(result.current.input).toBe('Question');
});

it('preserves input on failure and retries without including a failed duplicate', async () => {
  callModel.mockRejectedValueOnce(new Error('Connection failed')).mockResolvedValueOnce(response('Retry answer'));
  const { result } = useChat();
  act(() => result.current.setInput('Question'));
  await act(async () => { await result.current.send(); });
  expect(result.current.error).toBeTruthy();
  expect(result.current.messages).toHaveLength(0);
  expect(result.current.input).toBe('Question');
  await act(async () => { await result.current.send(); });
  expect(callModel).toHaveBeenCalledTimes(2);
  expect(callModel.mock.calls[1][0].messages).toEqual([{role:'user',content:'Question'}]);
  expect(result.current.messages).toHaveLength(2);
});

it('reviews sensitive content in the message and optional prompt before any send', async () => {
  callModel.mockResolvedValue(response('Redacted answer'));
  const { result } = useChat({ prompt: 'Contact test@example.com' });
  act(() => { result.current.setInput('Help me'); result.current.setIncludePrompt(true); });
  await act(async () => { await result.current.send(); });
  expect(callModel).not.toHaveBeenCalled();
  expect(result.current.piiWarning).toBeTruthy();
  await act(async () => { await result.current.piiRedactAndSend(); });
  expect(callModel).toHaveBeenCalledTimes(1);
  expect(callModel.mock.calls[0][0].system).not.toContain('test@example.com');
  expect(callModel.mock.calls[0][0].system).toContain('[EMAIL]');
});

it('keeps the actual redacted message in future history', async () => {
  callModel.mockResolvedValue(response('Answer'));
  const { result } = useChat();
  act(() => result.current.setInput('Contact test@example.com'));
  await act(async () => { await result.current.send(); });
  await act(async () => { await result.current.piiRedactAndSend(); });
  expect(result.current.messages[0].content).not.toContain('test@example.com');
  act(() => result.current.setInput('Continue'));
  await act(async () => { await result.current.send(); });
  expect(JSON.stringify(callModel.mock.calls[1][0])).not.toContain('test@example.com');
});

it('revokes stale approval when the composed message changes', async () => {
  const { result } = useChat();
  act(() => result.current.setInput('Contact test@example.com'));
  await act(async () => { await result.current.send(); });
  const staleApprove = result.current.piiSendAnyway;
  act(() => result.current.setInput('Different message'));
  await act(async () => { await staleApprove(); });
  expect(callModel).not.toHaveBeenCalled();
  expect(result.current.piiWarning).toBeNull();
});

it('clears earlier context when prompt inclusion or included text changes', async () => {
  callModel.mockResolvedValue(response('Answer'));
  const { result, rerender } = useChat({ prompt:'First prompt' });
  act(() => { result.current.setInput('Question'); result.current.setIncludePrompt(true); });
  await act(async () => { await result.current.send(); });
  expect(result.current.messages).toHaveLength(2);
  rerender({ prompt:'Changed prompt' });
  await waitFor(() => expect(result.current.messages).toEqual([]));
  act(() => result.current.setInput('Fresh'));
  await act(async () => { await result.current.send(); });
  act(() => result.current.setIncludePrompt(false));
  expect(result.current.messages).toEqual([]);
  act(() => result.current.setInput('No context'));
  await act(async () => { await result.current.send(); });
  expect(JSON.stringify(callModel.mock.calls.at(-1)[0])).not.toContain('Changed prompt');
});

it.each(['owner', 'hidden', 'provider'])('cancels and rejects late replies when %s changes', async reason => {
  let resolve;
  callModel.mockImplementation(() => new Promise(done => { resolve = done; }));
  const { result, rerender } = useChat({ ownerId:'one', visible:true });
  act(() => result.current.setInput('Question'));
  let pending; act(() => { pending = result.current.send(); });
  if (reason === 'provider') act(() => window.dispatchEvent(new Event(PROVIDER_SETTINGS_CHANGED)));
  else rerender(reason === 'owner' ? {ownerId:'two',visible:true} : {ownerId:'one',visible:false});
  expect(callModel.mock.calls[0][1].signal.aborted).toBe(true);
  await act(async () => { resolve(response('Late')); await pending; });
  expect(result.current.messages).toHaveLength(0);
});

it('retains the session conversation when hidden, and clears it explicitly or on remount', async () => {
  callModel.mockResolvedValue(response('Answer'));
  const { result, rerender, unmount } = useChat({visible:true});
  act(() => result.current.setInput('Question'));
  await act(async () => { await result.current.send(); });
  rerender({visible:false}); rerender({visible:true});
  expect(result.current.messages).toHaveLength(2);
  act(() => result.current.clear());
  expect(result.current.messages).toHaveLength(0);
  unmount();
  const fresh = useChat();
  expect(fresh.result.current.messages).toHaveLength(0);
  expect(callModel).toHaveBeenCalledTimes(1);
});
