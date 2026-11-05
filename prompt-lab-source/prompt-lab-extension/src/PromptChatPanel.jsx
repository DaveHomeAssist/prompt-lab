import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import MarkdownPreview from './MarkdownPreview.jsx';
import HostedQuotaBadge from './HostedQuotaBadge.jsx';

export default function PromptChatPanel({ chat, prompt = '', m = {}, colorMode, onUseReply, onOpenSettings }) {
  const end = useRef(null);
  const root = useRef(null);
  const [copyFeedback, setCopyFeedback] = useState('');
  useLayoutEffect(() => {
    const node = root.current;
    // The extension's editor can scroll independently of the viewport. Keep
    // the composer inside the visible portion of its sticky side panel.
    const fit = () => { node.style.maxHeight = `${Math.max(0, window.innerHeight - node.getBoundingClientRect().top - 8)}px`; };
    fit();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
    observer?.observe(node.parentElement);
    const main = document.getElementById('prompt-lab-main');
    if (main) observer?.observe(main);
    window.addEventListener('resize', fit);
    window.addEventListener('scroll', fit, { capture: true, passive: true });
    return () => { observer?.disconnect(); window.removeEventListener('resize', fit); window.removeEventListener('scroll', fit, true); };
  }, []);
  useEffect(() => { end.current?.scrollIntoView?.({ block: 'nearest' }); }, [chat.messages.length, chat.loading]);
  const copyReply = async message => {
    try { await navigator.clipboard.writeText(message.content); setCopyFeedback('Reply copied.'); }
    catch { setCopyFeedback('Copy failed. Select the reply and copy it manually, or try again.'); }
  };
  return (
    <section ref={root} className="pl-prompt-chat" aria-label="AI chat">
      <div className="pl-chat-context">
        <div className="pl-chat-heading"><strong>Think it through</strong><button type="button" onClick={chat.clear} className="ui-control pl-secondary-button">New chat</button></div>
        <p className={m.textSub}>Chat stays in this page session. Reload clears it.</p>
        <button type="button" className="pl-text-button" onClick={onOpenSettings}>Provider Settings</button>
        <label><input type="checkbox" checked={chat.includePrompt} onChange={event => chat.setIncludePrompt(event.target.checked)} /> Include current prompt</label>
        <p className={m.textSub}>Changing prompt context starts a new chat.</p>
        {chat.includePrompt && <details><summary>Review prompt context ({prompt.length} characters)</summary><pre className="pl-chat-context-preview">{prompt || 'The current prompt is empty.'}</pre></details>}
      </div>
      <div className="pl-chat-transcript" role="log" aria-label="Chat conversation" aria-live="polite" aria-relevant="additions">
        {!chat.messages.length && !chat.loading && <div className="pl-chat-empty"><h3>A second perspective, beside your draft</h3><p>Ask a question, explore an approach or work through a prompt. Your draft is included only when you choose it above.</p></div>}
        {chat.messages.map(message => <article key={message.id} className={`pl-chat-message is-${message.role}`}>
          <header><strong>{message.role === 'user' ? 'You' : 'Assistant'}</strong>{message.model && <small>{message.model}</small>}</header>
          <MarkdownPreview text={message.content} />
          {message.role === 'assistant' && <footer>
            <button type="button" className="ui-control pl-secondary-button" onClick={() => copyReply(message)}>Copy reply</button>
            <button type="button" className="ui-control pl-secondary-button" disabled={chat.loading || message.ownerKey !== chat.ownerKey || message.draft !== prompt} onClick={() => onUseReply(message)}>Use as new prompt</button>
            {message.draft !== prompt && <small>Your draft changed. Copy this reply or start a new chat to use it.</small>}
          </footer>}
        </article>)}
        {chat.loading && <p role="status">Waiting for a reply…</p>}
        <div ref={end} />
      </div>
      <form className="pl-chat-composer" onSubmit={event => { event.preventDefault(); chat.send(); }}>
        {chat.notice && <p role="status">{chat.notice}</p>}
        {chat.error && <p role="alert">{chat.error}</p>}
        {copyFeedback && <p role="status">{copyFeedback}</p>}
        <label htmlFor="prompt-chat-message">Message</label>
        <textarea id="prompt-chat-message" data-side-autofocus value={chat.input} disabled={chat.loading} onChange={event => chat.setInput(event.target.value)} placeholder="Ask about your prompt…" rows={3} className={m.input || ''} onKeyDown={event => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); chat.send(); }
        }} />
        <div className="pl-chat-actions"><span className={m.textSub}>Uses your selected provider and normal usage limits.</span>{chat.loading
          ? <button key="cancel" type="button" onClick={chat.cancel} className="ui-control pl-secondary-button">Cancel request</button>
          : <button key="send" type="submit" disabled={!chat.input.trim()} className="ui-control pl-primary-button">Send message</button>}</div>
        <HostedQuotaBadge m={m} colorMode={colorMode} onOpenSettings={onOpenSettings} />
      </form>
    </section>
  );
}
