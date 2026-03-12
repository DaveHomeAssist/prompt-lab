import { useState, useRef } from 'react';
import Ic from './icons';

const PAD_KEY = 'pl-pad';

export default function PadTab({ m, notify }) {
  const [text, setText] = useState(() => { try { return localStorage.getItem(PAD_KEY) || ''; } catch { return ''; } });
  const [stamp, setStamp] = useState(() => { try { return localStorage.getItem(PAD_KEY + '_meta') || ''; } catch { return ''; } });
  const timerRef = useRef(null);
  const wc = text.trim() ? text.trim().split(/\s+/).length : 0;

  const onChange = e => {
    const v = e.target.value;
    setText(v);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      try {
        localStorage.setItem(PAD_KEY, v);
        const s = 'Saved ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        localStorage.setItem(PAD_KEY + '_meta', s);
        setStamp(s);
      } catch {}
    }, 600);
  };

  const insertDate = () => {
    const d = new Date().toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
    const entry = `\n── ${d} ──\n`;
    const ta = document.getElementById('plPadArea');
    const pos = ta.selectionStart;
    const next = text.slice(0, pos) + entry + text.slice(ta.selectionEnd);
    setText(next);
    setTimeout(() => { ta.selectionStart = ta.selectionEnd = pos + entry.length; ta.focus(); }, 0);
    try { localStorage.setItem(PAD_KEY, next); } catch {}
  };

  const copyPad = () => {
    if (!text.trim()) return;
    try { navigator.clipboard.writeText(text); }
    catch {
      const el = document.createElement('textarea'); el.value = text;
      el.style.cssText = 'position:fixed;top:-9999px;opacity:0';
      document.body.appendChild(el); el.focus(); el.select();
      document.execCommand('copy'); document.body.removeChild(el);
    }
    notify('Pad copied!');
  };

  const clearPad = () => {
    if (!window.confirm('Clear all notes?')) return;
    setText(''); setStamp('');
    try { localStorage.removeItem(PAD_KEY); localStorage.removeItem(PAD_KEY + '_meta'); } catch {}
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden" style={{ height: 'calc(100vh - 44px)' }}>
      <div className={`flex items-center justify-between px-4 py-2 border-b ${m.border} shrink-0`}>
        <span className={`text-xs font-mono ${m.textMuted}`}>{wc} word{wc !== 1 ? 's' : ''} · {text.length} chars</span>
        <div className="flex gap-2">
          <button onClick={insertDate} className={`flex items-center gap-1 text-xs ${m.btn} ${m.textAlt} px-2 py-1 rounded-lg transition-colors`}>📅 Date</button>
          <button onClick={copyPad} className={`flex items-center gap-1 text-xs ${m.btn} ${m.textAlt} px-2 py-1 rounded-lg transition-colors`}><Ic n="Copy" size={11} />Copy</button>
          <button onClick={clearPad} className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg transition-colors text-red-400 hover:bg-red-950/30"><Ic n="Trash2" size={11} />Clear</button>
        </div>
      </div>
      <div className="flex-1 p-4 flex flex-col gap-2 overflow-hidden">
        <textarea id="plPadArea"
          className={`flex-1 w-full resize-none rounded-xl border ${m.input} border p-4 text-sm leading-relaxed focus:outline-none focus:border-violet-500 transition-colors ${m.text}`}
          placeholder={'Notes, ideas, prompt snippets…\n\nUse 📅 Date to timestamp entries.'}
          value={text} onChange={onChange} spellCheck />
        <div className={`text-xs font-mono text-right ${m.textMuted}`}>{stamp}</div>
      </div>
    </div>
  );
}
