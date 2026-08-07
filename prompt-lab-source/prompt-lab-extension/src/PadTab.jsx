import { useCallback, useEffect, useState } from 'react';
import Ic from './icons';
import { matchPadShortcut } from './lib/padShortcuts.js';
import usePads from './hooks/usePads.js';
import PadEditor from './pad/PadEditor.jsx';
import PadSidebar from './pad/PadSidebar.jsx';
import PadToolbar from './pad/PadToolbar.jsx';

function safeFileName(value) {
  return String(value || 'scratchpad')
    .trim()
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'scratchpad';
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function downloadFile(filename, value, type) {
  const blob = new Blob([value], { type });
  if (typeof navigator !== 'undefined' && typeof navigator.msSaveOrOpenBlob === 'function') {
    navigator.msSaveOrOpenBlob(blob, filename);
    return;
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default function PadTab({ m, notify, pageScroll = false, onPromoteToLibrary }) {
  const pads = usePads({ notify });
  const [editor, setEditor] = useState(null);
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const text = pads.draft.plainText;
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  const onEditorReady = useCallback((nextEditor) => setEditor(nextEditor), []);

  const startRename = (pad) => {
    setRenamingId(pad.id);
    setRenameValue(pad.name);
  };
  const cancelRename = () => {
    setRenamingId(null);
    setRenameValue('');
  };
  const commitRename = () => {
    if (!renamingId) return;
    pads.renamePad(renamingId, renameValue);
    cancelRename();
  };
  const createPad = () => {
    const id = pads.createNewPad();
    if (!id) return;
    const created = pads.payload.pads.find((pad) => pad.id === id) || { id, name: `Pad ${pads.payload.pads.length + 1}` };
    startRename(created);
  };

  const copyPlainText = useCallback(async () => {
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text);
      notify?.('Pad copied.');
    } catch {
      const element = document.createElement('textarea');
      element.value = text;
      element.style.cssText = 'position:fixed;top:-9999px;opacity:0';
      document.body.appendChild(element);
      element.select();
      document.execCommand('copy');
      element.remove();
      notify?.('Pad copied.');
    }
  }, [notify, text]);

  const exportPlainText = useCallback(() => {
    if (!text.trim()) return;
    pads.flush({ silent: true });
    const stamp = new Date().toISOString().slice(0, 10);
    downloadFile(`${safeFileName(pads.activePad.name)}-${stamp}.txt`, text, 'text/plain;charset=utf-8');
    notify?.('Plain-text pad exported.');
  }, [notify, pads, text]);

  const exportFormatted = useCallback(() => {
    if (!editor || !text.trim()) return;
    pads.flush({ silent: true });
    const stamp = new Date().toISOString().slice(0, 10);
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(pads.activePad.name)}</title></head><body><article>${editor.getHTML()}</article></body></html>`;
    downloadFile(`${safeFileName(pads.activePad.name)}-${stamp}.html`, html, 'text/html;charset=utf-8');
    notify?.('Formatted pad exported.');
  }, [editor, notify, pads, text]);

  const insertDate = useCallback(() => {
    if (!editor) return;
    const label = new Date().toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
    editor.chain().focus().insertContent({
      type: 'paragraph',
      content: [{ type: 'text', text: `--- ${label} ---` }],
    }).run();
    notify?.('Date separator inserted.');
  }, [editor, notify]);

  const clearPad = () => {
    if (!window.confirm('Clear this pad?')) return;
    editor?.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] });
    pads.clearActivePad();
    notify?.('Pad cleared.');
  };

  const deletePad = () => {
    if (pads.payload.pads.length <= 1 || !window.confirm(`Delete pad "${pads.activePad.name}"?`)) return;
    if (pads.deleteActivePad()) notify?.('Pad deleted.');
  };

  useEffect(() => {
    const onKeyDown = (event) => {
      const shortcut = matchPadShortcut(event);
      if (!shortcut) return;
      event.preventDefault();
      if (shortcut.id === 'export') exportPlainText();
      else if (shortcut.id === 'insertDate') insertDate();
      else if (shortcut.id === 'copyAll') copyPlainText();
      else if (shortcut.id === 'clear') clearPad();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [copyPlainText, exportPlainText, insertDate]);

  const saveTone = pads.saveState === 'failed'
    ? 'text-red-400'
    : pads.saveState === 'saved'
      ? 'text-emerald-400'
      : m.textMuted;
  const saveLabel = pads.saveState === 'pending'
    ? 'Saving...'
    : pads.saveState === 'failed'
      ? pads.saveMessage
      : pads.saveState === 'saved'
        ? 'Saved'
        : `Saved ${new Date(pads.activePad.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;

  return (
    <div className={`pl-tab-panel flex min-h-[calc(100vh-8rem)] flex-1 flex-col overflow-hidden sm:flex-row ${pageScroll ? 'min-h-[70vh]' : ''}`}>
      <PadSidebar
        payload={pads.payload}
        m={m}
        renamingId={renamingId}
        renameValue={renameValue}
        onRenameValue={setRenameValue}
        onStartRename={startRename}
        onCommitRename={commitRename}
        onCancelRename={cancelRename}
        onSelect={pads.selectPad}
        onCreate={createPad}
      />

      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className={`flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2 ${m.border}`}>
          <div className="min-w-0">
            <button type="button" onDoubleClick={() => startRename(pads.activePad)} className={`block max-w-full truncate text-sm font-semibold ${m.text}`} title="Double-click to rename">
              {pads.activePad.name}
            </button>
            <span className={`text-xs ${m.textMuted}`}>{wordCount} word{wordCount === 1 ? '' : 's'} · {text.length} chars</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {onPromoteToLibrary && (
              <button
                type="button"
                onClick={() => text.trim() && onPromoteToLibrary(pads.activePad.name, text)}
                disabled={!text.trim()}
                className={`ui-control flex h-8 items-center gap-1 rounded-md px-2 text-xs font-semibold ${m.btn} ${m.textAlt} disabled:opacity-40`}
                title="Save plain text to Prompt Library"
              >
                <Ic n="BookmarkPlus" size={13} />Library
              </button>
            )}
            <button type="button" onClick={insertDate} className={`ui-control flex h-8 w-8 items-center justify-center rounded-md ${m.btn} ${m.textAlt}`} title="Insert date" aria-label="Insert date"><Ic n="Calendar" size={13} /></button>
            <button type="button" onClick={exportPlainText} disabled={!text.trim()} className={`ui-control flex h-8 w-8 items-center justify-center rounded-md ${m.btn} ${m.textAlt} disabled:opacity-40`} title="Export plain text" aria-label="Export plain text"><Ic n="Download" size={13} /></button>
            <button type="button" onClick={exportFormatted} disabled={!text.trim()} className={`ui-control flex h-8 w-8 items-center justify-center rounded-md ${m.btn} ${m.textAlt} disabled:opacity-40`} title="Export formatted HTML" aria-label="Export formatted HTML"><Ic n="FileCode" size={13} /></button>
            <button type="button" onClick={copyPlainText} disabled={!text.trim()} className={`ui-control flex h-8 w-8 items-center justify-center rounded-md ${m.btn} ${m.textAlt} disabled:opacity-40`} title="Copy plain text" aria-label="Copy plain text"><Ic n="Copy" size={13} /></button>
            <button type="button" onClick={clearPad} className="ui-control flex h-8 w-8 items-center justify-center rounded-md text-red-400 hover:bg-red-950/30" title="Clear pad" aria-label="Clear pad"><Ic n="Trash2" size={13} /></button>
            <button type="button" onClick={deletePad} disabled={pads.payload.pads.length <= 1} className="ui-control flex h-8 w-8 items-center justify-center rounded-md text-red-400 hover:bg-red-950/30 disabled:opacity-40" title="Delete pad" aria-label="Delete pad"><Ic n="X" size={13} /></button>
          </div>
        </header>

        <PadToolbar editor={editor} m={m} />

        <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
          <PadEditor
            key={pads.activePad.id}
            activePad={{ ...pads.activePad, doc: pads.draft.doc }}
            onDocumentChange={pads.queueDocument}
            onEditorReady={onEditorReady}
            onBlur={() => pads.flush()}
            m={m}
            pageScroll={pageScroll}
          />
          <div role="status" aria-live="polite" className={`flex min-h-5 items-center gap-1.5 text-xs font-mono ${saveTone}`}>
            {pads.saveState === 'pending' && <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />}
            {pads.saveState === 'saved' && <Ic n="Check" size={11} />}
            {pads.saveState === 'failed' && <Ic n="X" size={11} />}
            <span>{saveLabel}</span>
          </div>
        </div>
      </section>
    </div>
  );
}
