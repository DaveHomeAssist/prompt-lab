import { describe, expect, it } from 'vitest';
import { buildCopyAs, redactSecrets } from '../lib/copyAs.js';

const SECRET = 'sk-ant-api03-abcdefghijklmnop';

describe('buildCopyAs', () => {
  it('copies plain text, Markdown, and a messages array', () => {
    expect(buildCopyAs('plain', 'Hello {{name}}')).toBe('Hello {{name}}');
    expect(buildCopyAs('markdown', 'Hello', { title: 'Note' })).toBe('# Note\n\nHello');
    expect(JSON.parse(buildCopyAs('json', 'Hello'))).toEqual([{ role: 'user', content: 'Hello' }]);
  });

  it('puts $API_KEY in the curl snippet and never a real key', () => {
    const snippet = buildCopyAs('curl', `Send ${SECRET} please`, {
      apiKey: 'sk-live-SUPERSECRETVALUE123456',
      authorization: 'Bearer sk-live-SUPERSECRETVALUE123456',
      model: 'claude-sonnet-4-6',
      provider: 'anthropic',
    });
    expect(snippet).toContain('x-api-key: $API_KEY');
    expect(snippet).toContain('https://api.anthropic.com/v1/messages');
    expect(snippet).not.toContain(SECRET);
    expect(snippet).not.toContain('SUPERSECRETVALUE');
    expect(snippet).not.toContain('sk-live');
    expect(redactSecrets(SECRET)).toBe('$API_KEY');
  });

  it('uses a bearer placeholder for OpenAI and no key header for a local model', () => {
    const openai = buildCopyAs('curl', 'Hello', { provider: 'openai', model: 'gpt-4o' });
    expect(openai).toContain('authorization: Bearer $API_KEY');
    expect(openai).not.toMatch(/sk-[A-Za-z0-9]/);
    const local = buildCopyAs('curl', 'Hello', { provider: 'ollama', model: 'llama3.2:3b' });
    expect(local).toContain('http://localhost:11434/api/chat');
    expect(local).not.toContain('authorization');
    expect(local).not.toContain('api-key');
  });
});
