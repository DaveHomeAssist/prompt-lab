// Accept card for a highlight enhance. Rendered in a closed shadow root so the
// page's CSS cannot restyle it, and so the card's styles cannot leak out.
// User text is assigned with textContent only. The card never parses HTML.

const THEMES = {
  dark: {
    bg: '#101018',
    panel: '#14141d',
    text: '#f0ede6',
    muted: '#b3afaa',
    border: 'rgba(255, 255, 255, 0.14)',
    accent: '#fb923c',
    accentText: '#1c1006',
    ghost: 'rgba(255, 255, 255, 0.06)',
    danger: '#fecaca',
  },
  light: {
    bg: '#ffffff',
    panel: '#f8fafc',
    text: '#0f172a',
    muted: '#475569',
    border: '#cbd5e1',
    accent: '#c2410c',
    accentText: '#fff7ed',
    ghost: '#f1f5f9',
    danger: '#991b1b',
  },
};

export function resolveHighlightTheme(explicit) {
  if (explicit === 'light' || explicit === 'dark') return explicit;
  try {
    if (typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches) return 'light';
  } catch { /* matchMedia can throw in locked-down documents. */ }
  return 'dark';
}

function css(theme) {
  return `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .card {
      width: 100%;
      max-height: min(70vh, 420px);
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 12px;
      border-radius: 14px;
      border: 1px solid ${theme.border};
      background: ${theme.bg};
      color: ${theme.text};
      font-family: system-ui, sans-serif;
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.28);
    }
    .title { margin: 0; font-family: Georgia, "Iowan Old Style", Palatino, serif; font-size: 15px; font-weight: 600; }
    .label { margin: 0; font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; color: ${theme.muted}; }
    pre, textarea {
      margin: 0;
      max-height: 7.5rem;
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-word;
      border-radius: 8px;
      border: 1px solid ${theme.border};
      background: ${theme.panel};
      color: ${theme.text};
      font: 13px/1.45 ui-monospace, "Cascadia Code", monospace;
      padding: 8px;
    }
    textarea { width: 100%; resize: vertical; min-height: 5rem; }
    .actions { display: flex; flex-wrap: wrap; gap: 6px; }
    button {
      min-height: 32px;
      border-radius: 8px;
      border: 1px solid ${theme.border};
      background: ${theme.ghost};
      color: ${theme.text};
      font: 13px/1 system-ui, sans-serif;
      padding: 0 10px;
      cursor: pointer;
    }
    button:focus-visible { outline: 2px solid ${theme.accent}; outline-offset: 2px; }
    button.primary { background: ${theme.accent}; color: ${theme.accentText}; border-color: transparent; font-weight: 650; }
    button:disabled { opacity: 0.55; cursor: default; }
    .status { margin: 0; min-height: 1.2em; font-size: 12px; color: ${theme.muted}; }
    .status[data-tone="error"] { color: ${theme.danger}; }
  `;
}

function place(host, anchor, fill) {
  host.style.all = 'initial';
  host.style.zIndex = '2147483646';
  host.style.display = 'block';
  if (fill) {
    host.style.position = 'fixed';
    host.style.inset = '0';
    host.style.width = '100%';
    host.style.height = '100%';
    return;
  }
  const width = 360;
  const height = 280;
  const margin = 8;
  const left0 = Number(anchor?.left) || margin;
  const bottom = Number(anchor?.bottom) || 40;
  const top0 = Number(anchor?.top) || margin;
  let top = bottom + margin;
  let left = left0;
  const viewWidth = host.ownerDocument.defaultView?.innerWidth || 800;
  const viewHeight = host.ownerDocument.defaultView?.innerHeight || 600;
  if (top + height > viewHeight) top = Math.max(margin, top0 - height - margin);
  if (left + width > viewWidth) left = Math.max(margin, viewWidth - width - margin);
  host.style.position = 'fixed';
  host.style.top = `${Math.max(margin, top)}px`;
  host.style.left = `${Math.max(margin, left)}px`;
  host.style.width = `${width}px`;
}

function button(doc, label, className) {
  const el = doc.createElement('button');
  el.type = 'button';
  el.textContent = label;
  if (className) el.className = className;
  return el;
}

/**
 * Mount the accept card. `onAccept` receives the text the user confirmed
 * (the edit box, when it is open). `onCopy` and `onCancel` are optional.
 * The returned handle updates the card after the enhance request settles.
 */
export function mountAcceptCard(doc, {
  theme: themeName,
  anchor,
  fill = false,
  onAccept,
  onCopy,
  onCancel,
} = {}) {
  const theme = THEMES[resolveHighlightTheme(themeName)];
  const host = doc.createElement('div');
  host.setAttribute('data-prompt-lab-highlight', '');
  place(host, anchor, fill);
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = doc.createElement('style');
  style.textContent = css(theme);
  const card = doc.createElement('section');
  card.className = 'card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Enhanced selection');
  card.tabIndex = -1;

  const title = doc.createElement('h2');
  title.className = 'title';
  title.textContent = 'Prompt Lab';
  const originalLabel = doc.createElement('p');
  originalLabel.className = 'label';
  originalLabel.textContent = 'Original';
  const original = doc.createElement('pre');
  original.tabIndex = 0;
  const enhancedLabel = doc.createElement('p');
  enhancedLabel.className = 'label';
  enhancedLabel.textContent = 'Enhanced';
  const enhanced = doc.createElement('pre');
  enhanced.tabIndex = 0;
  const editor = doc.createElement('textarea');
  editor.setAttribute('aria-label', 'Edit enhanced text');
  editor.hidden = true;
  const status = doc.createElement('p');
  status.className = 'status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'assertive');
  const actions = doc.createElement('div');
  actions.className = 'actions';
  const acceptBtn = button(doc, 'Accept', 'primary');
  const editBtn = button(doc, 'Edit');
  const copyBtn = button(doc, 'Copy');
  const cancelBtn = button(doc, 'Cancel');
  actions.append(acceptBtn, editBtn, copyBtn, cancelBtn);
  card.append(title, originalLabel, original, enhancedLabel, enhanced, editor, status, actions);
  shadow.append(style, card);
  doc.documentElement.append(host);

  let closed = false;
  let pending = false;
  let editing = false;
  const currentText = () => (editing ? editor.value : enhanced.textContent);

  const setStatus = (message, tone) => {
    if (closed) return;
    status.textContent = message || '';
    if (tone) status.dataset.tone = tone;
    else delete status.dataset.tone;
  };
  const close = () => {
    if (closed) return;
    closed = true;
    host.remove();
  };
  const setPending = (isPending) => {
    pending = Boolean(isPending);
    acceptBtn.disabled = pending;
    editBtn.disabled = pending;
    copyBtn.disabled = pending;
    if (pending) setStatus('Enhancing…');
  };

  const accept = async () => {
    if (closed || pending || acceptBtn.disabled) return;
    acceptBtn.disabled = true;
    try {
      const outcome = await onAccept?.(currentText());
      if (outcome?.message) setStatus(outcome.message, outcome.ok === false ? 'error' : undefined);
      // Keep the card up when the page could not be edited, so the paste notice stays visible.
      if (outcome?.ok !== false && !outcome?.fallback) close();
      else acceptBtn.disabled = false;
    } catch (error) {
      setStatus(error?.message || 'Couldn\'t apply the enhanced text.', 'error');
      acceptBtn.disabled = false;
    }
  };
  const cancel = () => {
    if (closed) return;
    try { onCancel?.(); } catch { /* Closing still has to happen. */ }
    close();
  };

  acceptBtn.addEventListener('click', () => { void accept(); });
  cancelBtn.addEventListener('click', cancel);
  editBtn.addEventListener('click', () => {
    editing = !editing;
    editor.hidden = !editing;
    enhanced.hidden = editing;
    editBtn.textContent = editing ? 'Preview' : 'Edit';
    if (editing) {
      editor.value = enhanced.textContent;
      editor.focus();
    } else {
      enhanced.textContent = editor.value;
      acceptBtn.focus();
    }
  });
  copyBtn.addEventListener('click', async () => {
    const text = currentText();
    try {
      if (onCopy) await onCopy(text);
      else await navigator.clipboard.writeText(text);
      setStatus('Copied.');
    } catch (error) {
      editing = true;
      editor.hidden = false;
      enhanced.hidden = true;
      editor.value = text;
      editor.focus();
      editor.select();
      setStatus(error?.message || 'Copy failed. The text is selected in the box.', 'error');
    }
  });

  shadow.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancel();
      return;
    }
    if (event.key !== 'Enter' || event.shiftKey) return;
    if (event.target === editor) {
      event.preventDefault();
      void accept();
      return;
    }
    if (event.target !== acceptBtn) {
      event.preventDefault();
      void accept();
    }
  });

  const showResult = ({ originalText = '', enhancedText = '', error = '', pending: isPending = false } = {}) => {
    original.textContent = originalText;
    enhanced.textContent = enhancedText || '';
    editor.value = enhancedText || '';
    const failed = Boolean(error);
    const hasText = Boolean(enhancedText);
    enhancedLabel.hidden = !hasText;
    enhanced.hidden = !hasText || editing;
    acceptBtn.hidden = failed || !hasText;
    editBtn.hidden = failed || !hasText;
    copyBtn.hidden = !hasText;
    setPending(isPending);
    if (error) setStatus(error, 'error');
    else if (!isPending) setStatus('Enter accepts. Esc cancels.');
    if (!isPending && !failed) acceptBtn.focus();
    else if (!isPending) cancelBtn.focus();
  };

  return {
    host,
    shadow,
    close,
    setStatus,
    setPending,
    showResult,
    /** @internal test hook. The shadow root is closed to the page. */
    query: (selector) => shadow.querySelector(selector),
  };
}
