import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ScratchWorkspace from '../ScratchWorkspace.jsx';
let writeText;
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('pl2-pads', JSON.stringify({ pads: [{ id: 'note', name: 'Copy test', content: 'Keep this note', timestamp: 10 }], activePadId: 'note' }));
  localStorage.setItem('pl2-pads-schema-version', '4');
  writeText = vi.fn();
  vi.stubGlobal('navigator', { clipboard: { writeText } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); delete document.execCommand; });
it('waits for modern clipboard acknowledgement before success', async () => {
  let resolve; writeText.mockImplementation(() => new Promise(done => { resolve = done; }));
  const notify = vi.fn(); render(<ScratchWorkspace m={{}} notify={notify} />);
  fireEvent.click(screen.getByRole('button', { name: 'Copy note', exact: true }));
  expect(notify).not.toHaveBeenCalledWith('Note copied.');
  resolve(); await waitFor(() => expect(notify).toHaveBeenCalledWith('Note copied.'));
});
it.each(['false', 'throw', 'success'])('handles a %s fallback honestly and removes the temporary textarea', async mode => {
  writeText.mockRejectedValue(new Error('Denied'));
  document.execCommand = vi.fn(() => { if (mode === 'throw') throw new Error('Unavailable'); return mode === 'success'; });
  const notify = vi.fn(); render(<ScratchWorkspace m={{}} notify={notify} />);
  const button = screen.getByRole('button', { name: 'Copy note', exact: true }); button.focus(); fireEvent.click(button);
  await waitFor(() => expect(notify).toHaveBeenCalledWith(mode === 'success' ? 'Note copied.' : expect.stringContaining('Copy failed.')));
  if (mode !== 'success') expect(notify).not.toHaveBeenCalledWith('Note copied.');
  expect(document.querySelector('textarea[style*="top: -9999px"]')).toBeNull();
  expect(button).toHaveFocus();
  expect(JSON.parse(localStorage.getItem('pl2-pads')).pads[0].content).toBe('Keep this note');
});
