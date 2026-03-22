import { describe, expect, it, vi } from 'vitest';
import {
  resolveBugReportEndpoint,
  sanitizeBugReportPayload,
  submitBugReport,
} from '../lib/bugReporter.js';

describe('bugReporter', () => {
  it('uses same-origin endpoint in web mode', () => {
    expect(resolveBugReportEndpoint({
      isWeb: true,
      locationOrigin: 'https://promptlab.tools',
    })).toBe('https://promptlab.tools/api/bug-report');
  });

  it('falls back to hosted endpoint outside web mode', () => {
    expect(resolveBugReportEndpoint({
      isWeb: false,
      locationOrigin: 'chrome-extension://abc123',
    })).toBe('https://promptlab.tools/api/bug-report');
  });

  it('sanitizes and truncates payload fields', () => {
    const payload = sanitizeBugReportPayload({
      title: `  ${'x'.repeat(200)}  `,
      severity: 'Nope',
      steps: '  reproduce  ',
      context: {
        browser: '  Chrome  ',
        blank: '',
      },
      promptContext: {
        raw: '  hello  ',
      },
    });

    expect(payload.title.length).toBe(160);
    expect(payload.severity).toBe('Medium');
    expect(payload.steps).toBe('reproduce');
    expect(payload.context).toEqual({ browser: 'Chrome' });
    expect(payload.promptContext.raw).toBe('hello');
  });

  it('submits sanitized payloads to the resolved endpoint', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });

    await submitBugReport(
      { title: 'Bug', severity: 'Low', steps: '1. Do thing' },
      { fetchImpl, isWeb: true, locationOrigin: 'https://promptlab.tools' },
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe('https://promptlab.tools/api/bug-report');
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.title).toBe('Bug');
    expect(body.severity).toBe('Low');
    expect(body.steps).toBe('1. Do thing');
  });
});
