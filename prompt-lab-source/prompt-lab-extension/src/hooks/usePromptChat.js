import { useEffect, useRef, useState } from 'react';
import { callModel } from '../api.js';
import { extractTextFromAnthropic } from '../promptUtils.js';
import { normalizeError } from '../lib/errorTaxonomy.js';
import { buildChatPayload } from '../lib/promptChat.js';
import { PROVIDER_SETTINGS_CHANGED } from '../lib/providerSettingsEvents.js';
import { PROVIDER_SETTINGS_KEYS } from '../lib/providerRegistry.js';
import useSensitivePreflight from './useSensitivePreflight.js';

/** One memory-only conversation per mounted app. Successful turns alone enter later requests. */
export default function usePromptChat({ prompt = '', ownerId = null, revision = 0, visible = true }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [includePrompt, setIncludePrompt] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const preflight = useSensitivePreflight();
  const active = useRef(null);
  const ownerKey = JSON.stringify([ownerId, revision, includePrompt, includePrompt ? prompt : '']);
  const requestKey = JSON.stringify([ownerKey, input, messages.map(({ role, content }) => [role, content])]);
  const current = useRef({ ownerKey, requestKey, visible });
  current.current = { ownerKey, requestKey, visible };
  const previousOwner = useRef(ownerKey);

  const abort = () => {
    active.current?.controller.abort();
    active.current = null;
  };
  const cancel = () => {
    abort();
    preflight.invalidate();
    setLoading(false);
    setNotice('Request cancelled. Your message is ready to send again.');
  };
  const clear = () => {
    abort();
    preflight.invalidate();
    setMessages([]);
    setInput('');
    setIncludePrompt(false);
    setLoading(false);
    setError('');
    setNotice('New chat started.');
  };

  useEffect(() => {
    if (previousOwner.current !== ownerKey) {
      previousOwner.current = ownerKey;
      setMessages([]);
      setError('');
      setNotice('Prompt context changed. A new chat has started.');
    }
  }, [ownerKey]);

  useEffect(() => {
    preflight.invalidate();
    setLoading(false);
    return abort;
    // Approval and requests belong to this exact composed message and transcript.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, visible]);

  useEffect(() => {
    const changed = () => {
      abort(); preflight.invalidate(); setLoading(false);
      setNotice('Provider settings changed. Review your message before sending again.');
    };
    const storage = event => { if (event.key == null || event.key === 'pl2-provider-settings') changed(); };
    const extension = (changes, area) => { if (area === 'local' && PROVIDER_SETTINGS_KEYS.some(key => key in changes)) changed(); };
    window.addEventListener(PROVIDER_SETTINGS_CHANGED, changed);
    window.addEventListener('storage', storage);
    const changes = globalThis.chrome?.storage?.onChanged;
    changes?.addListener(extension);
    return () => {
      abort();
      window.removeEventListener(PROVIDER_SETTINGS_CHANGED, changed);
      window.removeEventListener('storage', storage);
      changes?.removeListener(extension);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = async () => {
    if (active.current || !visible) return;
    let payload;
    try { payload = buildChatPayload({ messages, input, prompt, includePrompt }); }
    catch (caught) { setError(caught.message); return; }
    const sourceDraft = prompt;
    const execute = async approved => {
      if (active.current || current.current.requestKey !== requestKey || !current.current.visible) return;
      const attempt = { controller: new AbortController() };
      active.current = attempt;
      const isCurrent = () => active.current === attempt && current.current.requestKey === requestKey && current.current.visible && !attempt.controller.signal.aborted;
      setLoading(true); setError(''); setNotice('');
      try {
        const response = await callModel(approved, { signal: attempt.controller.signal });
        if (!isCurrent()) return;
        const content = extractTextFromAnthropic(response);
        if (!content.trim()) throw new Error('The provider returned an empty reply. Try sending again.');
        // Keep what actually crossed preflight, including any redacted history.
        setMessages([
          ...approved.messages.map((message, index) => ({ ...messages[index], ...message, id: messages[index]?.id || crypto.randomUUID() })),
          { id: crypto.randomUUID(), role: 'assistant', content, provider: response.provider, model: response.model, draft: sourceDraft, ownerKey },
        ]);
        setInput('');
      } catch (caught) {
        if (!isCurrent()) return;
        const normalized = normalizeError(caught, 'chat');
        setError(normalized.userMessage || 'Chat could not complete. Try sending again.');
      } finally {
        if (active.current === attempt) { active.current = null; setLoading(false); }
      }
    };
    const reviewed = preflight.review({ payload, scope: 'chat', label: 'Chat message and conversation',
      isCurrent: () => current.current.requestKey === requestKey && current.current.visible,
      resume: execute });
    if (reviewed.payload) return execute(reviewed.payload);
  };

  return { messages, input, setInput, includePrompt, setIncludePrompt, loading, error, notice, send, cancel, clear, ownerKey,
    piiWarning: preflight.piiWarning, piiSendAnyway: preflight.piiSendAnyway,
    piiRedactAndSend: preflight.piiRedactAndSend, piiCancel: preflight.piiCancel };
}
