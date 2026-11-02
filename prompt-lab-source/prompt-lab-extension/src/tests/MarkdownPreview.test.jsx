import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import MarkdownPreview from '../MarkdownPreview.jsx';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('copies only the selected block, preserving literal markup and whitespace', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  const code = '  <tag>& "quoted" $& {{input}}\n\t雪\n';
  render(<MarkdownPreview text={'```html\n' + code + '\n```\n\n```js\nsecond()\n```\nInline `no button`'} />);
  const buttons = screen.getAllByRole('button', { name: 'Copy code' });
  expect(buttons).toHaveLength(2);
  fireEvent.click(buttons[0]);
  await waitFor(() => expect(screen.getAllByRole('status')[0]).toHaveTextContent('Copied'));
  expect(writeText).toHaveBeenLastCalledWith(code);
  fireEvent.click(buttons[1]);
  await waitFor(() => expect(writeText).toHaveBeenLastCalledWith('second()'));
});

it('waits for acknowledgement and permits retry after clipboard rejection', async () => {
  let reject;
  const writeText = vi.fn().mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; })).mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  render(<MarkdownPreview text={'```\nretry\n```'} />);
  const button = screen.getByRole('button', { name: 'Copy code' });
  fireEvent.click(button);
  expect(button).toBeDisabled();
  expect(screen.getByRole('status')).toHaveTextContent('Copying');
  reject(new Error('Denied'));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Copy failed'));
  expect(button).toBeEnabled();
  fireEvent.click(button);
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Copied'));
});

it('handles an unavailable clipboard and an unfinished fence without changing source', async () => {
  vi.stubGlobal('navigator', {});
  const { container } = render(<MarkdownPreview text={'```html\n<img src=x onerror=alert(1)>'} />);
  expect(container.querySelector('img')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Copy failed'));
  expect(container.querySelector('code').textContent).toBe('<img src=x onerror=alert(1)>');
});
