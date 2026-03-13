import { describe, it, expect } from 'vitest';
import { scanSensitiveData, redactPayload } from '../piiScanner.js';

describe('piiScanner', () => {
  it('detects email addresses', () => {
    const { matches } = scanSensitiveData({ prompt: 'contact me at test@example.com' });
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].type).toBe('email');
  });

  it('detects API keys', () => {
    const { matches } = scanSensitiveData({ prompt: 'my key is sk-abcdefghijklmnopqrstuvwxyz1234' });
    expect(matches.some(m => m.type === 'api_key')).toBe(true);
  });

  it('validates credit cards with Luhn', () => {
    const { matches: good } = scanSensitiveData({ prompt: 'card: 4111111111111111' });
    expect(good.some(m => m.type === 'credit_card')).toBe(true);

    const { matches: bad } = scanSensitiveData({ prompt: 'card: 4111111111111112' });
    expect(bad.some(m => m.type === 'credit_card')).toBe(false);
  });

  it('returns empty when disabled', () => {
    const { matches } = scanSensitiveData({ prompt: 'test@example.com' }, { enabled: false });
    expect(matches).toEqual([]);
  });

  it('redacts matched values', () => {
    const { matches } = scanSensitiveData({ payload: { messages: [{ role: 'user', content: 'email test@example.com' }] } });
    const redacted = redactPayload({ messages: [{ role: 'user', content: 'email test@example.com' }] }, matches);
    expect(redacted.messages[0].content).toContain('[EMAIL]');
    expect(redacted.messages[0].content).not.toContain('test@example.com');
  });
});
