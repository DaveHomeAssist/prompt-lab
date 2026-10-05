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
      bearer_token: expect.objectContaining({ label: 'Bearer token', placeholder: 'BEARER_TOKEN' }),
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

  it('validates credit cards with Luhn', () => {
    expect(scanForPII('4111 1111 1111 1111').findings.some((finding) => finding.type === 'credit_card')).toBe(true);
    expect(scanForPII('4111 1111 1111 1112').findings.some((finding) => finding.type === 'credit_card')).toBe(false);
  });

  it('detects AWS access key IDs as API credentials', () => {
    const { findings } = scanForPII('aws AKIAIOSFODNN7EXAMPLE');

    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'api_key', value: 'AKIAIOSFODNN7EXAMPLE' }),
    ]));
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

describe('piiEngine send-time redaction regressions', () => {
  describe('secret_value captures the whole value', () => {
    it('replaces the full secret, not just its first 10 characters', () => {
      const text = 'password: correcthorsebatterystaple';
      const { findings } = scanForPII(text);

      expect(findings).toEqual([
        expect.objectContaining({ type: 'secret_value', value: 'correcthorsebatterystaple', start: 10, end: 35 }),
      ]);
      expect(redactText(text)).toBe('password: SECRET');
    });

    it.each([
      ['double-quoted', 'token = "abcdefghijklmnop1234"', 'token = "SECRET"'],
      ['single-quoted and followed by text', "secret: 'abcdefghijklmnop1234' and more text", "secret: 'SECRET' and more text"],
      ['followed by a query-string delimiter', 'client_secret=abcdefghijklmnop1234&next=1', 'client_secret=SECRET&next=1'],
      ['a dot-joined JWT', 'token: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlMTIzNDU2', 'token: SECRET'],
      ['base64-padded', 'secret = c3VwZXJzZWNyZXR2YWx1ZQ==', 'secret = SECRET'],
      ['followed by a sentence period', 'The password: correcthorsebatterystaple.', 'The password: SECRET.'],
    ])('redacts the whole value when it is %s', (_name, text, expected) => {
      expect(redactText(text)).toBe(expected);
    });

    it('has no upper length cap, so a very long secret is still replaced whole', () => {
      expect(redactText(`password: ${'a'.repeat(200)}`)).toBe('password: SECRET');
    });

    it.each([
      'The password must be at least 12 characters long.',
      'Never share your password: it is private.',
      'Use a strong password and rotate the token regularly.',
      'password: short',
      'password: {{db_password}}',
      'Set the password = $DB_PASSWORD_PROD before deploying.',
    ])('leaves ordinary prose and template references alone: %s', (text) => {
      expect(scanForPII(text)).toEqual({ hasPII: false, findings: [] });
      expect(redactText(text)).toBe(text);
    });
  });

  describe('api_key assignment captures the whole value', () => {
    it('does not stop at a hyphen inside the value', () => {
      expect(redactText('api_key: abcdefghijkl-mnopqrstuvwxyz')).toBe('API_KEY');
    });
  });

  describe('bearer_token', () => {
    it('detects a bare Authorization bearer token', () => {
      const text = 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789';
      const { hasPII, findings } = scanForPII(text);

      expect(hasPII).toBe(true);
      expect(findings).toEqual([
        expect.objectContaining({
          type: 'bearer_token',
          placeholder: 'BEARER_TOKEN',
          value: 'abcdefghijklmnopqrstuvwxyz0123456789',
          start: 22,
          end: 58,
        }),
      ]);
      expect(redactText(text)).toBe('Authorization: Bearer BEARER_TOKEN');
      expect(redactText(text, { placeholderStyle: 'brackets' })).toBe('Authorization: Bearer [BEARER_TOKEN]');
    });

    it.each([
      ['a lowercase scheme', 'authorization: bearer abcdefghijklmnopqrstuvwxyz0123456789', 'authorization: bearer BEARER_TOKEN'],
      ['an uppercase scheme', 'AUTHORIZATION: BEARER abcdefghijklmnopqrstuvwxyz0123456789', 'AUTHORIZATION: BEARER BEARER_TOKEN'],
      [
        'a curl header with text after it',
        'curl -H "Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789" https://api.example.com',
        'curl -H "Authorization: Bearer BEARER_TOKEN" https://api.example.com',
      ],
      [
        'a JWT',
        'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlMTIzNDU2',
        'Authorization: Bearer BEARER_TOKEN',
      ],
    ])('redacts %s', (_name, text, expected) => {
      expect(redactText(text)).toBe(expected);
    });

    it('does not double-redact a token that is also an API key', () => {
      const text = 'Authorization: Bearer sk-abcdefghijklmnopqrstuvwxyz0123 and then more text';
      const { findings } = scanForPII(text);

      // One region, one finding. On an exact tie the more specific api_key label wins.
      expect(findings).toHaveLength(1);
      expect(findings[0]).toEqual(expect.objectContaining({ type: 'api_key', value: 'sk-abcdefghijklmnopqrstuvwxyz0123' }));
      expect(redactText(text)).toBe('Authorization: Bearer API_KEY and then more text');
    });

    it('covers the whole token when it extends past the API key match inside it', () => {
      const text = 'Authorization: Bearer ghp_abcdefghijklmnopqrstuvwxyz0123456789.extra-segment_here ok';
      const { findings } = scanForPII(text);

      expect(findings).toEqual([expect.objectContaining({ type: 'bearer_token' })]);
      expect(redactText(text)).toBe('Authorization: Bearer BEARER_TOKEN ok');
    });

    it.each([
      'The bearer of this letter is trusted.',
      'Bearer authentication is described in RFC 6750.',
      'Send Bearer {{token}} with the request.',
      'Send Bearer $API_TOKEN with the request.',
      'Authorization: Bearer short',
      'The pallbearer abcdefghijklmnopqrstuvwxyz0123456789 arrived.',
    ])('leaves prose, placeholders and short values alone: %s', (text) => {
      expect(scanForPII(text)).toEqual({ hasPII: false, findings: [] });
      expect(redactText(text)).toBe(text);
    });

    it('can be switched off like every other detector', () => {
      const text = 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789';

      expect(scanForPII(text, { patterns: { bearer_token: false } }).hasPII).toBe(false);
      expect(scanForPII(text, { enabledTypes: ['email'] }).hasPII).toBe(false);
      expect(scanForPII(text, { enabledTypes: ['bearer_token'] }).hasPII).toBe(true);
    });
  });

  describe('phone numbers with a leading paren or plus', () => {
    it.each([
      ['parenthesized area code', 'Contact jane.doe@example.com or (555) 123-4567.', 'Contact EMAIL or PHONE.'],
      ['parenthesized area code with no space', 'call (555)123-4567 now', 'call PHONE now'],
      ['plus-prefixed country code', 'call +1 555 123 4567 now', 'call PHONE now'],
      ['plus-prefixed country code and parenthesized area code', 'call +1 (555) 123-4567 now', 'call PHONE now'],
      ['plain dashed number before a period', 'call 555-123-4567.', 'call PHONE.'],
    ])('redacts a %s as one span', (_name, text, expected) => {
      expect(redactText(text)).toBe(expected);
    });

    it('includes the opening paren in the reported finding', () => {
      const text = 'Contact jane.doe@example.com or (555) 123-4567.';
      const phone = scanForPII(text).findings.find((finding) => finding.type === 'phone');

      expect(phone).toEqual(expect.objectContaining({ value: '(555) 123-4567', start: 32, end: 46 }));
    });

    it('still needs a word boundary before bare digits', () => {
      expect(scanForPII('ref abc5551234567 only').findings.some((finding) => finding.type === 'phone')).toBe(false);
    });
  });

  describe('overlapping findings', () => {
    it('keeps one finding when a phone-shaped local part belongs to an email address', () => {
      const text = 'mail 5551234567@example.com please';
      const { findings } = scanForPII(text);

      expect(findings).toEqual([expect.objectContaining({ type: 'email', start: 5, end: 27 })]);
      expect(redactText(text)).toBe('mail EMAIL please');
    });

    it('keeps the text after an assignment that is both an api_key and a secret_value', () => {
      const text = 'private_key: abcdefghij1234567890 and then more words';

      expect(scanForPII(text).findings).toHaveLength(1);
      expect(redactText(text)).toBe('API_KEY and then more words');
    });

    it('widens the kept finding on a partial overlap so no tail survives', () => {
      const text = 'Contact jane.doe@example.com now';
      const options = { customPatterns: ['Contact jane'] };
      const { findings } = scanForPII(text, options);

      expect(findings).toEqual([
        expect.objectContaining({ type: 'custom', value: 'Contact jane.doe@example.com', start: 0, end: 28 }),
      ]);
      expect(redactText(text, options)).toBe('REDACTED now');
    });

    it('resolves overlaps in findings supplied by the caller', () => {
      const text = 'mail 5551234567@example.com please';
      const findings = [
        { type: 'phone', placeholder: 'PHONE', value: '5551234567', start: 5, end: 15 },
        { type: 'email', placeholder: 'EMAIL', value: '5551234567@example.com', start: 5, end: 27 },
      ];

      expect(redactText(text, { findings })).toBe('mail EMAIL please');
    });
  });
});
