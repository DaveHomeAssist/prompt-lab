import { useMemo } from 'react';
import { renderMarkdown } from './lib/markdownLite.js';

export default function MarkdownPreview({ text, className = '' }) {
  const html = useMemo(() => renderMarkdown(text), [text]);

  const copyCode = async (event) => {
    const button = event.target.closest('button[data-copy-code]');
    if (!button || !event.currentTarget.contains(button) || button.disabled) return;
    const block = button.closest('.md-code-block');
    const code = block.querySelector('pre code');
    const status = block.querySelector('[role="status"]');
    button.disabled = true;
    status.textContent = 'Copying…';
    try {
      await navigator.clipboard.writeText(code.textContent);
      status.textContent = 'Copied';
    } catch {
      status.textContent = 'Copy failed. Select the code to copy, or try again.';
    } finally {
      button.disabled = false;
    }
  };

  return (
    <div
      className={`md-preview ${className}`}
      onClick={copyCode}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
