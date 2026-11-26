import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../lib/markdownLite.js';

describe('markdown lite inline emphasis', () => {
  it('leaves emphasis markers inside code spans as text', () => {
    expect(renderMarkdown('`__init__`')).toBe('<p><code>__init__</code></p>');
    expect(renderMarkdown('`a*b*c`')).toBe('<p><code>a*b*c</code></p>');
    expect(renderMarkdown('use `my_var_name` here')).toBe('<p>use <code>my_var_name</code> here</p>');
  });

  it('keeps underscores in a link URL and still styles the label', () => {
    expect(renderMarkdown('[docs](https://example.com/my_page_name)')).toBe(
      '<p><a href="https://example.com/my_page_name" rel="noopener">docs</a></p>',
    );
    expect(renderMarkdown('[**guide**](https://example.com/a_b)')).toBe(
      '<p><a href="https://example.com/a_b" rel="noopener"><strong>guide</strong></a></p>',
    );
  });

  it('still emphasizes ordinary text and leaves snake_case alone', () => {
    expect(renderMarkdown('**bold** and _italic_')).toBe('<p><strong>bold</strong> and <em>italic</em></p>');
    expect(renderMarkdown('my_variable_name')).toBe('<p>my_variable_name</p>');
    expect(renderMarkdown('a *b* c')).toBe('<p>a <em>b</em> c</p>');
  });
});
