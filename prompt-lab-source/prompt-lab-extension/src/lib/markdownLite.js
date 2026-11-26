/**
 * Lightweight markdown-to-HTML renderer for prompt preview.
 * Supports: headings, bold, italic, inline code, code blocks, lists, blockquotes, links, paragraphs.
 * No external dependencies.
 */

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function emphasize(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, (_match, body) => `<strong>${body}</strong>`)
    .replace(/__(.+?)__/g, (_match, body) => `<strong>${body}</strong>`)
    .replace(/\*(.+?)\*/g, (_match, body) => `<em>${body}</em>`)
    .replace(/(^|\W)_(\S.*?\S|\S)_(?=\W|$)/g, (_match, prefix, body) => `${prefix}<em>${body}</em>`);
}

// Code spans and links are held out of the emphasis pass. Otherwise `_` and
// `*` inside them become tags, including inside an href.
function renderInline(text) {
  const slots = [];
  const hold = (html) => {
    const token = `\u0000md${slots.length}\u0000`;
    slots.push(html);
    return token;
  };
  const restore = (value) => {
    let current = value;
    for (let pass = 0; pass <= slots.length; pass += 1) {
      const next = current.replace(/\u0000md(\d+)\u0000/g, (_match, index) => slots[Number(index)] ?? '');
      if (next === current) return current;
      current = next;
    }
    return current;
  };

  let working = text.replace(/`([^`]+)`/g, (_match, code) => hold(`<code>${code}</code>`));
  working = working.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, href) => {
    const url = href.trim();
    const renderedLabel = emphasize(label);
    if (/^(https?:\/\/|mailto:|#)/i.test(url)) {
      return hold(`<a href="${url}" rel="noopener">${renderedLabel}</a>`);
    }
    return renderedLabel;
  });
  return restore(emphasize(working));
}

function renderCodeBlock(lines, language = '') {
  return `<div class="md-code-block"><div class="md-code-toolbar"><button type="button" data-copy-code>Copy code</button><span role="status" aria-live="polite"></span></div><pre><code${language ? ` class="language-${escapeHtml(language)}"` : ''}>${escapeHtml(lines.join('\n'))}</code></pre></div>`;
}

export function renderMarkdown(src) {
  if (!src || typeof src !== 'string') return '';

  const lines = src.split('\n');
  const out = [];
  let inCode = false;
  let codeLang = '';
  let codeLines = [];
  let inList = false;
  let listType = '';

  function closeList() {
    if (inList) {
      out.push(listType === 'ol' ? '</ol>' : '</ul>');
      inList = false;
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code fence
    if (line.trimStart().startsWith('```')) {
      if (!inCode) {
        closeList();
        inCode = true;
        codeLang = line.trimStart().slice(3).trim();
        codeLines = [];
      } else {
        out.push(renderCodeBlock(codeLines, codeLang));
        inCode = false;
        codeLang = '';
        codeLines = [];
      }
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    // Blank line
    if (!line.trim()) {
      closeList();
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      closeList();
      const level = headingMatch[1].length;
      out.push(`<h${level}>${renderInline(escapeHtml(headingMatch[2]))}</h${level}>`);
      continue;
    }

    // Blockquote
    if (line.startsWith('> ')) {
      closeList();
      out.push(`<blockquote>${renderInline(escapeHtml(line.slice(2)))}</blockquote>`);
      continue;
    }

    // Unordered list
    const ulMatch = line.match(/^[\s]*[-*+]\s+(.+)/);
    if (ulMatch) {
      if (!inList || listType !== 'ul') {
        closeList();
        out.push('<ul>');
        inList = true;
        listType = 'ul';
      }
      out.push(`<li>${renderInline(escapeHtml(ulMatch[1]))}</li>`);
      continue;
    }

    // Ordered list
    const olMatch = line.match(/^[\s]*\d+[.)]\s+(.+)/);
    if (olMatch) {
      if (!inList || listType !== 'ol') {
        closeList();
        out.push('<ol>');
        inList = true;
        listType = 'ol';
      }
      out.push(`<li>${renderInline(escapeHtml(olMatch[1]))}</li>`);
      continue;
    }

    // Horizontal rule
    if (/^[-*_]{3,}\s*$/.test(line)) {
      closeList();
      out.push('<hr>');
      continue;
    }

    // Paragraph
    closeList();
    out.push(`<p>${renderInline(escapeHtml(line))}</p>`);
  }

  // Close any unclosed blocks
  if (inCode) {
    out.push(renderCodeBlock(codeLines, codeLang));
  }
  closeList();

  return out.join('\n');
}
