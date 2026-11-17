// "Copy as…" formats. The curl snippet never reads or embeds an API key.
// The header always says $API_KEY, and any key-shaped text in the prompt is
// replaced with that same placeholder before it is quoted into the command.

const SECRET_PATTERNS = [
  /\bsk-ant-[A-Za-z0-9_\-]{8,}\b/g,
  /\bsk-or-[A-Za-z0-9_\-]{8,}\b/g,
  /\bsk-[A-Za-z0-9_\-]{16,}\b/g,
  /\bAIza[0-9A-Za-z\-_]{20,}\b/g,
  /\bghp_[A-Za-z0-9]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
];

export const COPY_AS_FORMATS = Object.freeze([
  Object.freeze({ id: 'plain', label: 'Plain text' }),
  Object.freeze({ id: 'markdown', label: 'Markdown' }),
  Object.freeze({ id: 'json', label: 'JSON messages' }),
  Object.freeze({ id: 'curl', label: 'curl' }),
]);

export function redactSecrets(text) {
  let out = String(text ?? '');
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, '$API_KEY');
  return out;
}

function shellSingleQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function messages(text) {
  return [{ role: 'user', content: redactSecrets(text) }];
}

function curlFor(provider, model, body) {
  const quoted = shellSingleQuote(JSON.stringify(body));
  if (provider === 'openai') {
    return [
      'curl https://api.openai.com/v1/chat/completions \\',
      '  -H "authorization: Bearer $API_KEY" \\',
      '  -H "content-type: application/json" \\',
      `  -d ${quoted}`,
    ].join('\n');
  }
  if (provider === 'gemini') {
    const id = encodeURIComponent(model || 'gemini-2.5-flash');
    return [
      `curl "https://generativelanguage.googleapis.com/v1beta/models/${id}:generateContent" \\`,
      '  -H "x-goog-api-key: $API_KEY" \\',
      '  -H "content-type: application/json" \\',
      `  -d ${quoted}`,
    ].join('\n');
  }
  if (provider === 'openrouter') {
    return [
      'curl https://openrouter.ai/api/v1/chat/completions \\',
      '  -H "authorization: Bearer $API_KEY" \\',
      '  -H "content-type: application/json" \\',
      `  -d ${quoted}`,
    ].join('\n');
  }
  if (provider === 'ollama') {
    return [
      'curl http://localhost:11434/api/chat \\',
      '  -H "content-type: application/json" \\',
      `  -d ${quoted}`,
    ].join('\n');
  }
  return [
    'curl https://api.anthropic.com/v1/messages \\',
    '  -H "x-api-key: $API_KEY" \\',
    '  -H "anthropic-version: 2023-06-01" \\',
    '  -H "content-type: application/json" \\',
    `  -d ${quoted}`,
  ].join('\n');
}

export function buildCopyAs(format, text, options = {}) {
  const source = typeof text === 'string' ? text : '';
  const safe = redactSecrets(source);
  const title = String(options.title || '').trim();
  if (format === 'markdown') {
    return title ? `# ${redactSecrets(title)}\n\n${safe}` : safe;
  }
  if (format === 'json') {
    return JSON.stringify(messages(source), null, 2);
  }
  if (format === 'curl') {
    const provider = String(options.provider || 'anthropic');
    const model = redactSecrets(String(options.model || 'claude-sonnet-4-6'));
    const content = safe;
    const body = provider === 'gemini'
      ? { contents: [{ role: 'user', parts: [{ text: content }] }] }
      : provider === 'ollama'
        ? { model, messages: [{ role: 'user', content }], stream: false }
        : provider === 'anthropic'
          ? { model, max_tokens: 1024, messages: [{ role: 'user', content }] }
          : { model, messages: [{ role: 'user', content }] };
    return curlFor(provider, model, body);
  }
  return safe;
}

export function copyAsMessage(format) {
  const found = COPY_AS_FORMATS.find((item) => item.id === format);
  return found ? `Copied as ${found.label}` : 'Copied!';
}
