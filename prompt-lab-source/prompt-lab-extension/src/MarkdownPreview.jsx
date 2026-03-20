import { useMemo } from 'react';
import { renderMarkdown } from './lib/markdownLite.js';

export default function MarkdownPreview({ text, className = '' }) {
  const html = useMemo(() => renderMarkdown(text), [text]);

  return (
    <div
      className={`md-preview ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
