import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import MarkdownPreview from '../MarkdownPreview.jsx';

describe('MarkdownPreview', () => {
  it('adds copy controls to fenced code blocks when enabled', async () => {
    const copy = vi.fn().mockResolvedValue(undefined);

    render(
      <MarkdownPreview
        text={'```js\nconsole.log("hello");\n```'}
        enableCodeCopy
        copy={copy}
      />
    );

    const button = screen.getByRole('button', { name: 'Copy code block' });
    expect(button).toHaveTextContent('Copy');
    expect(screen.getByText('js')).toBeInTheDocument();

    fireEvent.click(button);

    await waitFor(() => {
      expect(copy).toHaveBeenCalledWith('console.log("hello");', 'Code copied');
    });

    expect(screen.getByRole('button', { name: 'Copy code block' })).toHaveTextContent('Copied');
  });

  it('does not add copy controls when disabled', () => {
    render(<MarkdownPreview text={'```txt\nhello\n```'} />);
    expect(screen.queryByRole('button', { name: 'Copy code block' })).not.toBeInTheDocument();
  });
});
