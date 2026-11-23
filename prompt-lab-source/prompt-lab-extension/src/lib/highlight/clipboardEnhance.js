// Clipboard save/restore for the desktop highlight shortcut.
// The Rust side (prompt-lab-desktop/src-tauri/src/highlight.rs) performs the
// same steps against the OS clipboard. Keep the two in step:
//   1. Remember the clipboard, write a sentinel, simulate copy.
//   2. If the clipboard is still the sentinel or empty, restore and stop.
//      Never send the sentinel or the previous clipboard to the model.
//   3. Restore the original clipboard immediately, before enhance starts.
//   4. On accept, remember whatever is on the clipboard now, write the
//      enhanced text, paste, then put that remembered value back.

export const CLIPBOARD_SETTLE_MS = 80;

const defaultWait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

export function clipboardSentinel(nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`) {
  return `\u0000promptlab-${nonce}`;
}

export async function captureSelectionFromClipboard({ read, write, copy, wait = defaultWait, nonce } = {}) {
  if (typeof read !== 'function' || typeof write !== 'function' || typeof copy !== 'function') {
    return { ok: false, code: 'copy-failed', message: 'Clipboard access is unavailable.' };
  }
  let original = '';
  try {
    original = String(await read() ?? '');
  } catch {
    original = '';
  }
  const sentinel = clipboardSentinel(nonce);
  try {
    await write(sentinel);
    await copy();
    await wait(CLIPBOARD_SETTLE_MS);
    const selected = String(await read() ?? '');
    await write(original);
    const restored = String(await read() ?? '');
    if (restored !== original) {
      return { ok: false, code: 'restore-failed', message: 'Couldn\'t restore the clipboard after copying the selection.' };
    }
    if (selected === sentinel) {
      return { ok: false, code: 'copy-failed', message: 'Couldn\'t copy the selection. On macOS, grant Accessibility permission and try again.' };
    }
    if (!selected.trim()) {
      return { ok: false, code: 'empty', message: 'No text was selected.' };
    }
    return { ok: true, original, selected };
  } catch (error) {
    try { await write(original); } catch { /* The message below covers a clipboard that could not be put back. */ }
    return { ok: false, code: 'copy-failed', message: error?.message || 'Couldn\'t copy the selection.' };
  }
}

export async function pasteEnhancedAndRestore({ read, write, paste, enhanced, wait = defaultWait } = {}) {
  if (typeof read !== 'function' || typeof write !== 'function' || typeof paste !== 'function') {
    return { ok: false, code: 'paste-failed', message: 'Clipboard access is unavailable.' };
  }
  const text = String(enhanced ?? '');
  if (!text) return { ok: false, code: 'empty', message: 'There is no enhanced text to paste.' };
  let current = '';
  try { current = String(await read() ?? ''); } catch { current = ''; }
  try {
    await write(text);
    await wait(CLIPBOARD_SETTLE_MS);
    await paste();
    await wait(CLIPBOARD_SETTLE_MS);
  } catch (error) {
    try { await write(current); } catch { /* Reported with the paste error. */ }
    return { ok: false, code: 'paste-failed', message: error?.message || 'Couldn\'t paste the enhanced text.' };
  }
  try {
    await write(current);
    const restored = String(await read() ?? '');
    if (restored !== current) {
      return { ok: false, code: 'restore-failed', message: 'The enhanced text was pasted, but the clipboard could not be restored.' };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, code: 'restore-failed', message: error?.message || 'The enhanced text was pasted, but the clipboard could not be restored.' };
  }
}
