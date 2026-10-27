import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ReportProblemHost from '../ReportProblemHost.jsx';
import ErrorBoundary from '../ErrorBoundary.jsx';

afterEach(() => { cleanup(); delete globalThis.PromptLabDiagnosticsNative; vi.restoreAllMocks(); });
it('previews explicit report text locally and keeps it out of the GitHub URL', async () => {
  render(<ReportProblemHost />);
  act(() => window.dispatchEvent(new Event('promptlab:report-problem')));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'PRIVATE_USER_DESCRIPTION' } });
  fireEvent.click(screen.getByRole('button', { name: 'Preview diagnostic report' }));
  expect(await screen.findByLabelText('Complete diagnostic report')).toHaveTextContent('PRIVATE_USER_DESCRIPTION');
  expect(screen.getByRole('link', { name: 'Open GitHub issue draft' }).href).not.toContain('PRIVATE_USER_DESCRIPTION');
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
it('shows clipboard denial instead of claiming a report was copied', async () => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
  render(<ReportProblemHost />);
  act(() => window.dispatchEvent(new Event('promptlab:report-problem')));
  fireEvent.click(screen.getByRole('button', { name: 'Preview diagnostic report' }));
  await screen.findByLabelText('Complete diagnostic report');
  fireEvent.click(screen.getByRole('button', { name: 'Copy report' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Clipboard access failed');
});
it('passes the reviewed report to native export and reports export failures', async () => {
  globalThis.PromptLabDiagnosticsNative = { read: vi.fn().mockResolvedValue({ events: [] }), export: vi.fn().mockRejectedValue(new Error('disk full')) };
  render(<ReportProblemHost />);
  act(() => window.dispatchEvent(new Event('promptlab:report-problem')));
  fireEvent.click(screen.getByRole('button', { name: 'Preview diagnostic report' }));
  await screen.findByLabelText('Complete diagnostic report');
  fireEvent.click(screen.getByRole('button', { name: 'Export report' }));
  expect(await screen.findByText(/Export failed/)).toBeInTheDocument();
  expect(globalThis.PromptLabDiagnosticsNative.export).toHaveBeenCalledWith(expect.objectContaining({ reportId: expect.any(String) }));
});
it('remains usable after an application render failure and contains keyboard focus', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  function BrokenApp() { throw new TypeError('PRIVATE_RENDER_MESSAGE'); }
  render(<><ReportProblemHost /><ErrorBoundary><BrokenApp /></ErrorBoundary></>);
  fireEvent.click(screen.getByRole('button', { name: 'Report a problem' }));
  await waitFor(() => expect(screen.getByRole('textbox')).toHaveFocus());
  fireEvent.click(screen.getByRole('button', { name: 'Preview diagnostic report' }));
  const preview = await screen.findByLabelText('Complete diagnostic report');
  expect(preview).toHaveTextContent('react_error');
  expect(preview).not.toHaveTextContent('PRIVATE_RENDER_MESSAGE');
  const last = screen.getByRole('link', { name: 'Open GitHub issue draft' });
  last.focus(); fireEvent.keyDown(last, { key: 'Tab' });
  expect(screen.getByRole('button', { name: 'Use dark mode' })).toHaveFocus();
});
it('uses only the report ID to open the native issue draft and shows launch failure', async () => {
  globalThis.PromptLabDiagnosticsNative = { read: vi.fn().mockResolvedValue({ events: [] }), openIssue: vi.fn().mockRejectedValue(new Error('unavailable')) };
  render(<ReportProblemHost />);
  act(() => window.dispatchEvent(new Event('promptlab:report-problem')));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'PRIVATE_USER_DESCRIPTION' } });
  fireEvent.click(screen.getByRole('button', { name: 'Preview diagnostic report' }));
  await screen.findByLabelText('Complete diagnostic report');
  fireEvent.click(screen.getByRole('link', { name: 'Open GitHub issue draft' }));
  expect(await screen.findByText(/Could not open the browser/)).toBeInTheDocument();
  expect(globalThis.PromptLabDiagnosticsNative.openIssue).toHaveBeenCalledWith(expect.stringMatching(/^[a-f0-9-]+$/i));
  expect(JSON.stringify(globalThis.PromptLabDiagnosticsNative.openIssue.mock.calls)).not.toContain('PRIVATE');
});
