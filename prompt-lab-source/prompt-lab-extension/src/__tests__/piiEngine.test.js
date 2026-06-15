import { describe, expect, it } from 'vitest';
import { patterns, redactText, scanForPII } from '../lib/piiEngine.js';

describe('piiEngine', () => {
  it('exposes the shared built-in registry', () => {
    expect(patterns).toEqual(expect.objectContaining({
      ssn: expect.any(Object),
      credit_card: expect.any(Object),
      email: expect.any(Object),
      phone: expect.any(Object),
      ip: expect.any(Object),
    }));
  });

  it('detects multiple built-in PII types from a string', () => {
    const { hasPII, findings } = scanForPII(
      'Reach me at test@example.com, 212-555-7890, 192.168.0.10, and 123-45-6789.',
    );

    expect(hasPII).toBe(true);
    expect(findings.map((finding) => finding.type)).toEqual(
      expect.arrayContaining(['email', 'phone', 'ip', 'ssn']),
    );
  });

  it('detects AWS access key identifiers as API keys', () => {
    const { findings } = scanForPII('AWS key AKIAIOSFODNN7EXAMPLE');
    expect(findings.some((finding) => finding.type === 'api_key')).toBe(true);
  });

  it('validates credit cards with Luhn', () => {
    expect(scanForPII('4111 1111 1111 1111').findings.some((finding) => finding.type === 'credit_card')).toBe(true);
    expect(scanForPII('4111 1111 1111 1112').findings.some((finding) => finding.type === 'credit_card')).toBe(false);
  });

  it('supports limiting enabled patterns', () => {
    const { findings } = scanForPII('test@example.com 123-45-6789', {
      patterns: {
        email: true,
        ssn: false,
      },
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].type).toBe('email');
  });

  it('redacts findings with configurable placeholder style', () => {
    const text = 'Email test@example.com and call 212-555-7890.';
    const findings = scanForPII(text).findings;

    expect(redactText(text, { findings })).toBe('Email EMAIL and call PHONE.');
    expect(redactText(text, { findings, placeholderStyle: 'brackets' })).toBe('Email [EMAIL] and call [PHONE].');
  });
});
