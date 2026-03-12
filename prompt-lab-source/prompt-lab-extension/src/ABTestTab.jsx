import { useState, useRef } from 'react';
import Ic from './icons';
import { callModel } from './api';
import { extractTextFromAnthropic, isTransientError } from './promptUtils';

export default function ABTestTab({ m, copy, notify }) {
  const [abA, setAbA] = useState({ prompt: '', response: '', loading: false });
  const [abB, setAbB] = useState({ prompt: '', response: '', loading: false });
  const [abWinner, setAbWinner] = useState(null);
  const abReqRef = useRef({ a: 0, b: 0 });

  const inp = `w-full ${m.input} border rounded-lg p-3 text-sm resize-none focus:outline-none focus:border-violet-500 transition-colors placeholder-gray-400 ${m.text}`;

  const callWithRetry = async (payload, retries = 1) => {
    let attempt = 0;
    let lastError = null;
    while (attempt <= retries) {
      try { return await callModel(payload); }
      catch (e) {
        lastError = e;
        if (attempt >= retries || !isTransientError(e)) break;
        await new Promise(r => setTimeout(r, 350 * (attempt + 1)));
      }
      attempt += 1;
    }
    throw lastError || new Error('Request failed.');
  };

  const runAB = async side => {
    const state = side === 'a' ? abA : abB;
    const setter = side === 'a' ? setAbA : setAbB;
    const reqId = abReqRef.current[side] + 1;
    abReqRef.current = { ...abReqRef.current, [side]: reqId };
    if (!state.prompt.trim()) return;
    setter(p => ({ ...p, loading: true, response: '' }));
    try {
      const data = await callWithRetry({ model: 'claude-sonnet-4-20250514', max_tokens: 800, messages: [{ role: 'user', content: state.prompt }] });
      if (abReqRef.current[side] !== reqId) return;
      setter(p => ({ ...p, response: extractTextFromAnthropic(data), loading: false }));
    } catch (e) {
      if (abReqRef.current[side] !== reqId) return;
      setter(p => ({ ...p, response: e.message || 'Request failed.', loading: false }));
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden" style={{ height: 'calc(100vh - 44px)' }}>
      <div className={`px-4 py-2 border-b ${m.border} flex items-center justify-between shrink-0`}>
        <p className={`text-xs font-semibold ${m.textSub} uppercase tracking-wider`}>A/B Prompt Testing</p>
        <div className="flex items-center gap-3">
          {abWinner && <span className="text-xs font-bold text-green-400 flex items-center gap-1"><Ic n="Check" size={11} />Winner: {abWinner}</span>}
          <button onClick={() => { runAB('a'); runAB('b'); }} disabled={abA.loading || abB.loading}
            className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors">
            <Ic n="FlaskConical" size={12} />Run Both
          </button>
          <button onClick={() => {
            abReqRef.current = { a: abReqRef.current.a + 1, b: abReqRef.current.b + 1 };
            setAbA({ prompt: '', response: '', loading: false });
            setAbB({ prompt: '', response: '', loading: false });
            setAbWinner(null);
          }}
            className={`px-2 py-1.5 ${m.btn} rounded-lg text-xs ${m.textAlt} transition-colors`}>Reset</button>
        </div>
      </div>
      <div className={`px-4 py-2 border-b ${m.border}`}>
        <p className={`text-xs ${m.textAlt}`}>
          Each side is sent exactly as one isolated user message with no extra context.
        </p>
        <p className={`text-xs ${m.textMuted} mt-1 font-mono`}>
          Payload: <code>{`messages: [{ role: 'user', content: promptVariant }]`}</code>
        </p>
      </div>
      <div className="flex flex-1 overflow-hidden">
        {([['A', abA, setAbA], ['B', abB, setAbB]]).map(([side, state, setter]) => (
          <div key={side} className={`flex-1 flex flex-col border-r last:border-r-0 ${m.border} overflow-hidden`}>
            <div className={`px-3 py-2 border-b ${m.border} flex items-center justify-between shrink-0`}>
              <span className="text-xs font-bold text-violet-400 uppercase">Variant {side}</span>
              <div className="flex gap-2">
                <button onClick={() => runAB(side.toLowerCase())} disabled={state.loading || !state.prompt.trim()}
                  className="flex items-center gap-1 text-xs bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white px-2 py-1 rounded-lg transition-colors">
                  {state.loading ? <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Ic n="Wand2" size={10} />}Run {side}
                </button>
                {state.response && !abWinner && (
                  <button onClick={() => setAbWinner(`Variant ${side}`)} className="flex items-center gap-1 text-xs bg-green-600 hover:bg-green-500 text-white px-2 py-1 rounded-lg transition-colors"><Ic n="Check" size={10} />Pick {side}</button>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-3 p-3 flex-1 overflow-y-auto">
              <div>
                <span className={`text-xs ${m.textSub} font-semibold uppercase tracking-wider block mb-1.5`}>Prompt</span>
                <textarea rows={5} className={inp} placeholder={`Prompt variant ${side}…`} value={state.prompt} onChange={e => setter(p => ({ ...p, prompt: e.target.value }))} />
              </div>
              {(state.response || state.loading) && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs text-violet-400 font-semibold uppercase tracking-wider">Response</span>
                    {state.response && <span className={`text-xs ${m.textMuted}`}>~{Math.round(state.response.length / 4)} tokens</span>}
                  </div>
                  {state.loading
                    ? <div className={`${m.codeBlock} border ${m.border} rounded-lg p-3 flex items-center gap-2`}><span className="w-3 h-3 border-2 border-violet-500 border-t-transparent rounded-full animate-spin shrink-0" /><span className={`text-xs ${m.textSub}`}>Generating…</span></div>
                    : <div className={`${m.codeBlock} border ${m.border} rounded-lg p-3 text-xs ${m.textBody} leading-relaxed whitespace-pre-wrap max-h-72 overflow-y-auto`}>{state.response}</div>
                  }
                  {state.response && <button onClick={() => copy(state.response)} className={`flex items-center gap-1 text-xs ${m.textSub} hover:text-white transition-colors mt-1`}><Ic n="Copy" size={10} />Copy response</button>}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
