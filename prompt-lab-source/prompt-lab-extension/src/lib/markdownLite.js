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

function renderInline(text) {
  return text
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/_(.+?)_/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, href) => {
      const url = href.trim();
      if (/^(https?:\/\/|mailto:|#)/i.test(url)) {
        return `<a href="${url}" rel="noopener">${label}</a>`;
      }
      return label;
    });
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
