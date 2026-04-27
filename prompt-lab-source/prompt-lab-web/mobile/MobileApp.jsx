import { useEffect, useMemo, useRef, useState } from 'react';
import {
  defaultMobileState,
  loadMobileState,
  persistMobileState,
  sampleVoiceCapture,
  shortText,
  tabMeta,
  uid,
} from './mobileState.js';
import { generateCopyReadyPrompt } from './mobileProvider.js';

export default function MobileApp() {
  const [state, setState] = useState(loadMobileState);
  const [toast, setToast] = useState(null);
  const [feedback, setFeedback] = useState({ errorTarget: null, successTarget: null });
  const providerAbortRef = useRef(null);
  const toastTimer = useRef(null);
  const voiceTimer = useRef(null);
  const feedbackTimer = useRef(null);

  useEffect(() => {
    persistMobileState(state);
  }, [state]);

  useEffect(() => () => {
    providerAbortRef.current?.abort();
    window.clearTimeout(toastTimer.current);
    window.clearTimeout(voiceTimer.current);
    window.clearTimeout(feedbackTimer.current);
  }, []);

  const patch = (next) => setState((prev) => ({ ...prev, ...next }));

  const notify = (message, type = 'neutral', target = null) => {
    setToast({ message, type });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 1800);

    if (target && type !== 'neutral') {
      setFeedback({
        errorTarget: type === 'error' ? target : null,
        successTarget: type === 'success' ? target : null,
      });
      window.clearTimeout(feedbackTimer.current);
      feedbackTimer.current = window.setTimeout(() => {
        setFeedback({ errorTarget: null, successTarget: null });
      }, type === 'error' ? 900 : 420);
    }
  };

  const closeDetails = () => patch({ detailPromptId: null, detailPadId: null });

  const activeTitle = state.detailPromptId ? 'Prompt' : state.detailPadId ? 'Pad entry' : tabMeta[state.activeTab].title;
  const activeSubtitle = state.detailPromptId
    ? 'Enhanced, original, and reuse'
    : state.detailPadId
      ? 'Edit notes and send to Composer'
      : tabMeta[state.activeTab].subtitle;

  return (
    <div className="app-shell">
      <main className="phone">
        <Topbar
          back={state.detailPromptId || state.detailPadId}
          title={activeTitle}
          subtitle={activeSubtitle}
          onBack={closeDetails}
          onSettings={() => patch({ sheet: 'settings' })}
        />
        <section className="content">
          <ActiveView
            state={state}
            patch={patch}
            setState={setState}
            notify={notify}
            feedback={feedback}
            runPrompt={() => runPrompt(state, setState, providerAbortRef, notify)}
            enhancePrompt={() => enhancePrompt(state, patch, notify)}
          />
        </section>
        <Tabbar state={state} patch={patch} />
        {state.sheet === 'settings' && <SettingsSheet state={state} patch={patch} notify={notify} />}
        {state.sheet === 'voice' && <VoiceSheet state={state} patch={patch} notify={notify} voiceTimer={voiceTimer} feedback={feedback} />}
        {toast && <div className={`toast toast-${toast.type}`}>{toast.message}</div>}
      </main>
    </div>
  );
}

function Topbar({ back, title, subtitle, onBack, onSettings }) {
  return (
    <header className="topbar">
      {back ? (
        <button className="icon-btn" type="button" onClick={onBack} aria-label="Back">&lt;</button>
      ) : (
        <div className="brand-mark">PL</div>
      )}
      <div className="topbar-title">
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <button className="icon-btn" type="button" onClick={onSettings} aria-label="Customize tabs">=</button>
    </header>
  );
}

function ActiveView({ state, patch, setState, notify, feedback, runPrompt, enhancePrompt }) {
  if (state.detailPromptId) return <PromptDetail state={state} patch={patch} notify={notify} feedback={feedback} />;
  if (state.detailPadId) return <PadDetail state={state} patch={patch} setState={setState} notify={notify} feedback={feedback} />;
  if (state.activeTab === 'library') return <LibraryView state={state} patch={patch} />;
  if (state.activeTab === 'compose') {
    return (
      <ComposerView
        state={state}
        patch={patch}
        notify={notify}
        feedback={feedback}
        runPrompt={runPrompt}
        enhancePrompt={enhancePrompt}
      />
    );
  }
  return <PadList state={state} patch={patch} setState={setState} />;
}

function LibraryView({ state, patch }) {
  const collections = useMemo(
    () => ['All', ...Array.from(new Set(state.prompts.map((prompt) => prompt.collection)))],
    [state.prompts]
  );
  const query = state.search.trim().toLowerCase();
  const prompts = state.prompts.filter((prompt) => {
    const haystack = `${prompt.title} ${prompt.collection} ${prompt.tags.join(' ')} ${prompt.body}`.toLowerCase();
    return (state.collection === 'All' || prompt.collection === state.collection) && (!query || haystack.includes(query));
  });
  const suggestedPrompt =
    state.prompts.find((prompt) => prompt.id === state.lastUsedPromptId) ||
    [...state.prompts].sort((a, b) => (b.uses || 0) - (a.uses || 0))[0];

  return (
    <>
      <div className="section-head">
        <div>
          <h2>Saved prompts</h2>
          <p>{state.prompts.length} prompts across {collections.length - 1} collections</p>
        </div>
        <a className="canvas-link" href="./canvas.html">Canvas</a>
      </div>
      <div className="stack">
        {suggestedPrompt && (
          <button
            className="suggestion-panel suggested"
            type="button"
            onClick={() => patch({ detailPromptId: suggestedPrompt.id, lastUsedPromptId: suggestedPrompt.id })}
          >
            <span>Suggested next</span>
            <strong>{suggestedPrompt.title}</strong>
            <small>{suggestedPrompt.collection} - based on your recent prompt path</small>
          </button>
        )}
        <input
          className="search"
          value={state.search}
          onChange={(event) => patch({ search: event.target.value })}
          placeholder="Search prompts, tags, text"
        />
        <div className="chip-row">
          {collections.map((collection) => (
            <button
              className={`pill-btn ${state.collection === collection ? 'active' : ''}`}
              type="button"
              key={collection}
              onClick={() => patch({ collection })}
            >
              {collection}
            </button>
          ))}
        </div>
        {prompts.length ? prompts.map((prompt) => (
          <button className="card" type="button" key={prompt.id} onClick={() => patch({ detailPromptId: prompt.id, lastUsedPromptId: prompt.id })}>
            <h3>{prompt.title}</h3>
            <p>{shortText(prompt.enhanced || prompt.body, 122)}</p>
            <div className="meta">
              <span className="badge">{prompt.collection}</span>
              <span>{prompt.uses || 0} uses</span>
              <span>{prompt.tags.map((tag) => `#${tag}`).join(' ')}</span>
            </div>
          </button>
        )) : <div className="empty">No prompts match this search.</div>}
      </div>
    </>
  );
}

function PromptDetail({ state, patch, notify, feedback }) {
  const prompt = state.prompts.find((item) => item.id === state.detailPromptId);
  if (!prompt) return <div className="empty">Prompt not found.</div>;
  const text = prompt.enhanced || prompt.body;

  return (
    <div className="stack">
      <div className="section-head">
        <div>
          <h2>{prompt.title}</h2>
          <p>{prompt.collection} - {prompt.uses || 0} uses</p>
        </div>
      </div>
      <div className={`output ${feedback.successTarget === 'prompt' ? 'is-success' : ''}`}>
        <h3>Enhanced</h3>
        <p>{text}</p>
      </div>
      <article className="card">
        <h3>Original</h3>
        <p>{prompt.body}</p>
        <div className="meta">{prompt.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div>
      </article>
      <div className="split">
        <button
          className="primary-btn"
          type="button"
          onClick={() => {
            patch({ composerText: text, activeTab: 'compose', detailPromptId: null, lastUsedPromptId: prompt.id });
            notify('Loaded into Composer', 'success', 'composer');
          }}
        >
          Use prompt
        </button>
        <button className="quiet-btn" type="button" onClick={() => copyText(text, notify)}>Copy</button>
      </div>
    </div>
  );
}

function ComposerView({ state, patch, notify, feedback, runPrompt, enhancePrompt }) {
  const hasText = Boolean(state.composerText.trim());
  const hasOutput = Boolean(state.output.trim());
  const lastPrompt =
    state.prompts.find((prompt) => prompt.id === state.lastUsedPromptId) ||
    state.prompts[0];
  const latestPad = state.pads[0];
  const preferredSave = state.lastSavedTarget === 'pad' ? 'pad' : 'library';

  return (
    <>
      <div className="section-head">
        <div>
          <h2>Compose</h2>
          <p>Write, improve, run, then save what works.</p>
        </div>
        <button className="pill-btn" type="button" onClick={() => patch({ sheet: 'voice' })}>Voice</button>
      </div>
      <div className="stack">
        <textarea
          className={`field ${feedback.errorTarget === 'composer' ? 'is-error' : ''} ${feedback.successTarget === 'composer' ? 'is-success' : ''}`}
          value={state.composerText}
          onChange={(event) => patch({ composerText: event.target.value })}
          placeholder="Write or paste a rough prompt"
        />
        <div className="next-panel" aria-label="Suggested next actions">
          {!hasText && lastPrompt && (
            <button
              className="quick-action suggested"
              type="button"
              onClick={() => {
                patch({ composerText: lastPrompt.enhanced || lastPrompt.body, lastUsedPromptId: lastPrompt.id });
                notify('Started from recent prompt', 'success', 'composer');
              }}
            >
              Start from recent prompt
            </button>
          )}
          {!hasText && latestPad && (
            <button
              className="quick-action"
              type="button"
              onClick={() => {
                patch({ composerText: `Turn these notes into a reusable prompt:\n\n${latestPad.body}` });
                notify('Loaded latest pad', 'success', 'composer');
              }}
            >
              Use latest pad
            </button>
          )}
          {hasText && !hasOutput && (
            <button
              className={`quick-action ${state.lastComposerAction === 'run' ? '' : 'suggested'}`}
              type="button"
              onClick={state.lastComposerAction === 'run' ? runPrompt : enhancePrompt}
            >
              Likely next: {state.lastComposerAction === 'run' ? 'Run' : 'Refine'}
            </button>
          )}
          {hasOutput && !state.streaming && (
            <button
              className="quick-action suggested"
              type="button"
              onClick={() => preferredSave === 'pad' ? saveOutputToPad(state, patch, notify) : saveOutputToLibrary(state, patch, notify)}
            >
              Save to {preferredSave === 'pad' ? 'Pad' : 'Library'}
            </button>
          )}
        </div>
        <div className="action-row">
          <button className={`primary-btn ${hasText && !hasOutput && state.lastComposerAction !== 'run' ? 'suggested' : ''}`} type="button" onClick={enhancePrompt}>Refine prompt</button>
          <button className={`pill-btn ${hasText && !hasOutput && state.lastComposerAction === 'run' ? 'suggested' : ''}`} type="button" onClick={runPrompt}>Run</button>
          <button className="quiet-btn" type="button" onClick={() => patch({ composerText: '', output: '', streaming: false })}>Clear</button>
        </div>
        {state.output || state.streaming ? (
          <>
            <div className={`output ${feedback.errorTarget === 'output' ? 'is-error' : ''} ${feedback.successTarget === 'output' ? 'is-success' : ''}`}>
              <h3>{state.streaming ? 'Provider streaming' : 'Copy-ready prompt'}</h3>
              {!state.streaming && state.lastProvider && (
                <div className="provider-meta">{state.lastProvider} / {state.lastModel || 'default model'}</div>
              )}
              <p>{state.output}{state.streaming && <span className="cursor" />}</p>
            </div>
            <div className="output-actions">
              <button className="primary-btn" type="button" disabled={state.streaming} onClick={() => saveOutputToLibrary(state, patch, notify)}>Save to Library</button>
              <button className="pill-btn" type="button" disabled={state.streaming} onClick={() => copyText(state.output, notify)}>Copy prompt</button>
              <button className="quiet-btn" type="button" disabled={state.streaming} onClick={() => saveOutputToPad(state, patch, notify)}>Save to Pad</button>
            </div>
          </>
        ) : (
          <div className="empty">Run a prompt to generate a copy-ready provider response here.</div>
        )}
      </div>
    </>
  );
}

function PadList({ state, patch, setState }) {
  const createPad = () => {
    const pad = { id: uid('n'), title: 'Untitled note', updated: 'Just now', body: '' };
    setState((prev) => ({ ...prev, pads: [pad, ...prev.pads], activeTab: 'pad', detailPadId: pad.id }));
  };

  return (
    <>
      <div className="section-head">
        <div>
          <h2>Pad</h2>
          <p>Capture loose notes and turn them into prompts.</p>
        </div>
        <button className="primary-btn" type="button" onClick={createPad}>New</button>
      </div>
      <div className="stack">
        {state.pads.map((pad) => (
          <button className="card" type="button" key={pad.id} onClick={() => patch({ detailPadId: pad.id })}>
            <h3>{pad.title}</h3>
            <p>{shortText(pad.body, 138)}</p>
            <div className="meta"><span>{pad.updated}</span><span>{pad.body.split(/\s+/).filter(Boolean).length} words</span></div>
          </button>
        ))}
      </div>
    </>
  );
}

function PadDetail({ state, patch, setState, notify, feedback }) {
  const pad = state.pads.find((item) => item.id === state.detailPadId);
  if (!pad) return <div className="empty">Pad note not found.</div>;

  const updatePad = (updates) => {
    setState((prev) => ({
      ...prev,
      pads: prev.pads.map((item) => item.id === pad.id ? { ...item, ...updates, updated: 'Just now' } : item),
    }));
  };

  const deletePad = () => {
    setState((prev) => ({
      ...prev,
      pads: prev.pads.filter((item) => item.id !== pad.id),
      detailPadId: null,
      activeTab: 'pad',
    }));
    notify('Pad deleted', 'success', 'pad');
  };

  return (
    <div className="stack">
      <input className="search" value={pad.title} onChange={(event) => updatePad({ title: event.target.value })} aria-label="Pad title" />
      <textarea className={`note-field ${feedback.successTarget === 'pad' ? 'is-success' : ''}`} value={pad.body} onChange={(event) => updatePad({ body: event.target.value })} aria-label="Pad body" />
      <div className="split">
        <button className="primary-btn" type="button" onClick={() => patch({ composerText: `Turn these notes into a reusable prompt:\n\n${pad.body}`, activeTab: 'compose', detailPadId: null })}>To Composer</button>
        <button className="quiet-btn" type="button" onClick={() => copyText(pad.body, notify)}>Copy</button>
      </div>
      <button className="danger-btn" type="button" onClick={deletePad}>Delete note</button>
    </div>
  );
}

function Tabbar({ state, patch }) {
  return (
    <nav className="tabbar" style={{ '--tab-count': state.tabOrder.length }} aria-label="Mobile tabs">
      {state.tabOrder.map((id) => (
        <button
          className={`tab-btn ${state.activeTab === id ? 'active' : ''}`}
          type="button"
          key={id}
          onClick={() => patch({ activeTab: id, detailPromptId: null, detailPadId: null })}
        >
          <span>{tabMeta[id].icon}</span>
          <span>{tabMeta[id].label}</span>
        </button>
      ))}
    </nav>
  );
}

function SettingsSheet({ state, patch, notify }) {
  const [draggingId, setDraggingId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);

  const moveTab = (id, direction) => {
    const index = state.tabOrder.indexOf(id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= state.tabOrder.length) return;
    const next = [...state.tabOrder];
    const [item] = next.splice(index, 1);
    next.splice(nextIndex, 0, item);
    patch({ tabOrder: next, activeTab: next[0] });
    notify('Tab order saved', 'success', 'tabs');
  };

  const dropTab = (targetId) => {
    if (!draggingId || draggingId === targetId) {
      setDraggingId(null);
      setDragOverId(null);
      return;
    }
    const next = [...state.tabOrder];
    const from = next.indexOf(draggingId);
    const to = next.indexOf(targetId);
    if (from >= 0 && to >= 0) {
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      patch({ tabOrder: next, activeTab: next[0] });
      notify('Tab order snapped into place', 'success', 'tabs');
    }
    setDraggingId(null);
    setDragOverId(null);
  };

  return (
    <Sheet onClose={() => patch({ sheet: null })}>
      <div className="section-head">
        <div>
          <h2>Customize tabs</h2>
          <p>Choose the order that fits your thumb path. The first tab becomes your startup tab.</p>
        </div>
        <button className="icon-btn" type="button" onClick={() => patch({ sheet: null })} aria-label="Close">x</button>
      </div>
      <div className="stack">
        {state.tabOrder.map((id, index) => (
          <div
            className={`row reorder-row ${draggingId === id ? 'is-dragging' : ''} ${dragOverId === id && draggingId !== id ? 'is-drag-over' : ''}`}
            key={id}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('text/plain', id);
              setDraggingId(id);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              setDragOverId(id);
            }}
            onDragLeave={() => setDragOverId((current) => current === id ? null : current)}
            onDrop={(event) => {
              event.preventDefault();
              dropTab(id);
            }}
            onDragEnd={() => {
              setDraggingId(null);
              setDragOverId(null);
            }}
          >
            <div className="row-title">
              <span className="brand-mark" style={{ width: 34, height: 34, borderRadius: 11 }}>{tabMeta[id].icon}</span>
              <span>
                <strong>{tabMeta[id].label}</strong>
                <small>{index === 0 ? 'Startup tab' : tabMeta[id].subtitle}</small>
              </span>
            </div>
            <div className="move-controls">
              <button type="button" onClick={() => moveTab(id, -1)} disabled={index === 0}>Up</button>
              <button type="button" onClick={() => moveTab(id, 1)} disabled={index === state.tabOrder.length - 1}>Down</button>
            </div>
          </div>
        ))}
        <button className="quiet-btn" type="button" onClick={() => patch(defaultMobileState())}>Reset mobile state</button>
        <a className="canvas-link" href="/mobile/canvas.html">Open original design canvas</a>
        <a className="canvas-link" href="/mobile/prototype.html">Open static prototype</a>
      </div>
    </Sheet>
  );
}

function VoiceSheet({ state, patch, notify, voiceTimer, feedback }) {
  const startVoice = () => {
    window.clearTimeout(voiceTimer.current);
    patch({ voiceStatus: 'listening' });
    voiceTimer.current = window.setTimeout(() => {
      patch({ voiceTranscript: sampleVoiceCapture, voiceStatus: 'idle' });
    }, 900);
  };

  const useText = () => {
    if (!state.voiceTranscript.trim()) {
      notify('Capture or type transcript first', 'error', 'voice');
      return;
    }
    patch({ composerText: state.voiceTranscript, activeTab: 'compose', sheet: null });
  };

  return (
    <Sheet onClose={() => patch({ sheet: null })}>
      <div className="section-head">
        <div>
          <h2>Voice capture</h2>
          <p>Capture a rough idea, then send it into Composer.</p>
        </div>
        <button className="icon-btn" type="button" onClick={() => patch({ sheet: null })} aria-label="Close">x</button>
      </div>
      <div className={`voice-orb ${state.voiceStatus === 'listening' ? 'listening' : ''}`}>
        <strong>{state.voiceStatus === 'listening' ? 'Listening' : 'Mic'}</strong>
      </div>
      <div className="stack">
        <textarea
          className={`field ${feedback.errorTarget === 'voice' ? 'is-error' : ''} ${state.voiceTranscript ? 'is-success' : ''}`}
          value={state.voiceTranscript}
          onChange={(event) => patch({ voiceTranscript: event.target.value })}
          placeholder="Transcript appears here"
        />
        <div className="split">
          <button className="primary-btn" type="button" onClick={startVoice}>{state.voiceStatus === 'listening' ? 'Listening...' : 'Start'}</button>
          <button className="quiet-btn" type="button" onClick={useText}>Use text</button>
        </div>
        <p className="small">Prototype fallback fills a sample capture so this flow stays testable.</p>
      </div>
    </Sheet>
  );
}

function Sheet({ children, onClose }) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <section className="sheet" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        {children}
      </section>
    </div>
  );
}

function enhancePrompt(state, patch, notify) {
  const text = state.composerText.trim();
  if (!text) {
    notify('Write a prompt first', 'error', 'composer');
    return;
  }
  patch({
    composerText: `You are helping produce a high-quality result.\n\nTask:\n${text}\n\nRequirements:\n- Ask only for missing context that blocks the work.\n- Return a structured answer with concise headings.\n- Include assumptions, risks, and a concrete next action.\n- Keep the tone direct and practical.`,
    lastComposerAction: 'refine',
  });
  notify('Prompt refined', 'success', 'composer');
}

async function runPrompt(state, setState, providerAbortRef, notify) {
  const text = state.composerText.trim();
  if (!text) {
    notify('Write a prompt first', 'error', 'composer');
    return;
  }
  providerAbortRef.current?.abort();
  const abortController = new AbortController();
  providerAbortRef.current = abortController;
  setState((prev) => ({ ...prev, output: '', streaming: true, lastComposerAction: 'run' }));

  try {
    const result = await generateCopyReadyPrompt(text, {
      signal: abortController.signal,
      onChunk: (fullText) => {
        setState((prev) => ({
          ...prev,
          output: fullText,
          streaming: true,
        }));
      },
    });

    setState((prev) => ({
      ...prev,
      output: result.text,
      streaming: false,
      lastProvider: result.provider,
      lastModel: result.model,
    }));
    notify('Prompt generated', 'success', 'output');
  } catch (error) {
    if (abortController.signal.aborted) return;
    setState((prev) => ({ ...prev, streaming: false }));
    notify(error?.message || 'Provider request failed', 'error', 'output');
  } finally {
    if (providerAbortRef.current === abortController) {
      providerAbortRef.current = null;
    }
  }
}

function saveOutputToLibrary(state, patch, notify) {
  const promptText = (state.output || state.composerText).trim();
  if (!promptText) {
    notify('Nothing to save', 'error', state.output ? 'output' : 'composer');
    return;
  }
  const prompt = {
    id: uid('p'),
    title: promptTitle(promptText),
    collection: 'Mobile',
    tags: ['mobile'],
    uses: 0,
    body: promptText,
    enhanced: promptText,
  };
  patch({
    prompts: [prompt, ...state.prompts],
    activeTab: 'library',
    detailPromptId: prompt.id,
    lastUsedPromptId: prompt.id,
    lastSavedTarget: 'library',
  });
  notify('Saved to Library', 'success', 'prompt');
}

function promptTitle(text) {
  const taskIndex = text.indexOf('\nTask\n');
  if (taskIndex >= 0) {
    const task = text.slice(taskIndex + 6).split(/\n\n/)[0];
    return shortText(task, 46) || 'Mobile prompt';
  }
  return shortText(text.split('\n').find((line) => line.trim() && line.trim() !== 'Copy-ready prompt') || text, 46) || 'Mobile prompt';
}

function saveOutputToPad(state, patch, notify) {
  const body = state.output || state.composerText;
  if (!body.trim()) {
    notify('Nothing to save', 'error', 'output');
    return;
  }
  const pad = {
    id: uid('n'),
    title: shortText(state.composerText.split('\n')[0], 42) || 'Composer note',
    updated: 'Just now',
    body,
  };
  patch({
    pads: [pad, ...state.pads],
    activeTab: 'pad',
    detailPadId: pad.id,
    lastSavedTarget: 'pad',
  });
  notify('Saved to Pad', 'success', 'pad');
}

function copyText(text, notify) {
  if (navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(text);
  }
  notify('Copied', 'success', 'output');
}
