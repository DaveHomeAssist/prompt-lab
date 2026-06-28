import { describe, expect, it, vi } from 'vitest';
import {
  resolveDiscoveryFeedbackEndpoint,
  sanitizeDiscoveryFeedbackPayload,
  submitDiscoveryFeedback,
} from '../lib/discoveryReporter.js';

describe('discoveryReporter', () => {
  it('uses same-origin endpoint in web mode', () => {
    expect(resolveDiscoveryFeedbackEndpoint({
      isWeb: true,
      locationOrigin: 'https://promptlab.tools',
    })).toBe('https://promptlab.tools/api/discovery-report');
  });

  it('falls back to hosted endpoint outside web mode', () => {
    expect(resolveDiscoveryFeedbackEndpoint({
      isWeb: false,
      locationOrigin: 'chrome-extension://abc123',
    })).toBe('https://promptlab.tools/api/discovery-report');
  });

  it('sanitizes discovery fields without prompt context', () => {
    const payload = sanitizeDiscoveryFeedbackPayload({
      worthPayingFor: '  advanced eval history  ',
      economicWorkflow: '  client prompt audits  ',
      supportTemplatesEvals: '  templates and support  ',
      priceSensitivity: '  $10-20/mo  ',
      consultantPain: '  client data cannot leave local device  ',
      context: {
        browser: '  Chrome  ',
        blank: '',
      },
      promptContext: {
        raw: 'must not be carried',
      },
    });

    expect(payload.worthPayingFor).toBe('advanced eval history');
    expect(payload.economicWorkflow).toBe('client prompt audits');
    expect(payload.supportTemplatesEvals).toBe('templates and support');
    expect(payload.priceSensitivity).toBe('$10-20/mo');
    expect(payload.consultantPain).toBe('client data cannot leave local device');
    expect(payload.context).toEqual({ browser: 'Chrome' });
    expect(payload.promptContext).toBeUndefined();
  });

  it('submits sanitized payloads to the resolved endpoint', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });

    await submitDiscoveryFeedback(
      { worthPayingFor: 'Pro when evals save client time' },
      { fetchImpl, isWeb: true, locationOrigin: 'https://promptlab.tools' },
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe('https://promptlab.tools/api/discovery-report');
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.worthPayingFor).toBe('Pro when evals save client time');
  });
});
