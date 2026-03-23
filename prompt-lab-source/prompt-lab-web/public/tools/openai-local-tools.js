(() => {
  const DEFAULT_PROVIDER = 'openai';

  function loadSettings(storageKey, defaults) {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? { provider: DEFAULT_PROVIDER, ...defaults, ...JSON.parse(raw) } : { provider: DEFAULT_PROVIDER, ...defaults };
    } catch {
      return { provider: DEFAULT_PROVIDER, ...defaults };
    }
  }

  function saveSettings(storageKey, settings) {
    localStorage.setItem(storageKey, JSON.stringify(settings));
  }

  function clearSettings(storageKey) {
    localStorage.removeItem(storageKey);
  }

  function extractError(data, fallback) {
    return data?.error?.message || fallback || 'OpenAI request failed';
  }

  function extractText(data) {
    if (typeof data?.output_text === 'string' && data.output_text.trim()) {
      return data.output_text.trim();
    }

    const outputs = Array.isArray(data?.output) ? data.output : [];
    const chunks = [];
    outputs.forEach(item => {
      const content = Array.isArray(item?.content) ? item.content : [];
      content.forEach(part => {
        if (typeof part?.text === 'string') chunks.push(part.text);
        if (typeof part?.output_text === 'string') chunks.push(part.output_text);
      });
    });
    return chunks.join('\n').trim();
  }

  function extractGeminiText(data) {
    const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
    const chunks = [];
    candidates.forEach(candidate => {
      const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
      parts.forEach(part => {
        if (typeof part?.text === 'string') chunks.push(part.text);
      });
    });
    return chunks.join('\n').trim();
  }

  function extractGeminiImage(data) {
    const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
    for (const candidate of candidates) {
      const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
      for (const part of parts) {
        const inlineData = part?.inlineData || part?.inline_data;
        const mimeType = inlineData?.mimeType || inlineData?.mime_type || 'image/png';
        const payload = inlineData?.data;
        if (payload) {
          return { mimeType, data: payload };
        }
      }
    }
    return null;
  }

  async function requestOpenAIText({ apiKey, model, systemPrompt, userPrompt, maxOutputTokens = 300, text }) {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_output_tokens: maxOutputTokens,
        input: [
          {
            role: 'system',
            content: [{ type: 'input_text', text: systemPrompt }],
          },
          {
            role: 'user',
            content: [{ type: 'input_text', text: userPrompt }],
          }
        ],
        ...(text ? { text } : {})
      })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(extractError(data, response.statusText));
    }

    const output = extractText(data);
    if (!output) {
      throw new Error('Empty response from model');
    }

    return { data, text: output };
  }

  async function requestGeminiText({ apiKey, model, systemPrompt, userPrompt, text }) {
    const wantsJson = text?.format?.type === 'json_schema';
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        model,
        system_instruction: {
          parts: [{ text: systemPrompt }]
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: userPrompt }]
          }
        ],
        ...(wantsJson ? {
          generationConfig: {
            responseMimeType: 'application/json'
          }
        } : {})
      })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(extractError(data, response.statusText));
    }

    const output = extractGeminiText(data);
    if (!output) {
      throw new Error('Empty response from model');
    }
    return { data, text: output };
  }

  async function requestAnthropicText({ apiKey, model, systemPrompt, userPrompt, maxOutputTokens = 300 }) {
    const endpoint = 'https://api.anthropic.com/v1/messages';
    const headers = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': apiKey,
    };
    const payload = JSON.stringify({
      model,
      max_tokens: maxOutputTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: payload,
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error?.message || response.statusText || 'Anthropic request failed');
    }

    const text = (data?.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n')
      .trim();
    if (!text) throw new Error('Empty response from model');
    return { data, text };
  }

  /**
   * Attempt a request through /api/proxy (server-side key injection).
   * Falls back to direct call if the proxy is unreachable (e.g. local file://).
   */
  async function proxyRequest({ provider, model, systemPrompt, userPrompt, maxOutputTokens = 300, text }) {
    let targetUrl, headers, body;

    if (provider === 'anthropic') {
      targetUrl = 'https://api.anthropic.com/v1/messages';
      headers = { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' };
      body = JSON.stringify({ model, max_tokens: maxOutputTokens, system: systemPrompt, messages: [{ role: 'user', content: userPrompt }] });
    } else if (provider === 'gemini') {
      targetUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
      headers = { 'Content-Type': 'application/json' };
      body = JSON.stringify({ model, system_instruction: { parts: [{ text: systemPrompt }] }, contents: [{ role: 'user', parts: [{ text: userPrompt }] }] });
    } else {
      targetUrl = 'https://api.openai.com/v1/responses';
      headers = { 'Content-Type': 'application/json' };
      body = JSON.stringify({ model, max_output_tokens: maxOutputTokens, input: [{ role: 'system', content: [{ type: 'input_text', text: systemPrompt }] }, { role: 'user', content: [{ type: 'input_text', text: userPrompt }] }], ...(text ? { text } : {}) });
    }

    const res = await fetch('/api/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetUrl, headers, body }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || data?.error || res.statusText);

    let output;
    if (provider === 'anthropic') {
      output = (data?.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    } else if (provider === 'gemini') {
      output = extractGeminiText(data);
    } else {
      output = extractText(data);
    }
    if (!output) throw new Error('Empty response from model');
    return { data, text: output };
  }

  async function requestText({ provider = DEFAULT_PROVIDER, apiKey, model, systemPrompt, userPrompt, maxOutputTokens = 300, text }) {
    // Try proxy first (works on hosted Vercel deployments)
    try {
      return await proxyRequest({ provider, apiKey, model, systemPrompt, userPrompt, maxOutputTokens, text });
    } catch {
      // Proxy unavailable — fall through to direct calls with local API key
    }

    if (provider === 'anthropic') {
      return requestAnthropicText({ apiKey, model, systemPrompt, userPrompt, maxOutputTokens });
    }
    if (provider === 'gemini') {
      return requestGeminiText({ apiKey, model, systemPrompt, userPrompt, text });
    }
    return requestOpenAIText({ apiKey, model, systemPrompt, userPrompt, maxOutputTokens, text });
  }

  async function generateOpenAIImage({ apiKey, model, prompt, size = '1024x1024' }) {
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        prompt,
        size,
        response_format: 'b64_json'
      })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(extractError(data, response.statusText));
    }

    const imageData = data?.data?.[0]?.b64_json;
    if (!imageData) {
      throw new Error('No image returned by model');
    }
    return { data, dataUrl: `data:image/png;base64,${imageData}` };
  }

  async function generateGeminiImage({ apiKey, model, prompt }) {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          responseModalities: ['IMAGE'],
          imageConfig: {
            aspectRatio: '1:1'
          }
        }
      })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(extractError(data, response.statusText));
    }

    const imageData = extractGeminiImage(data);
    if (!imageData?.data) {
      throw new Error('No image returned by model');
    }

    return { data, dataUrl: `data:${imageData.mimeType || 'image/png'};base64,${imageData.data}` };
  }

  async function generateImage({ provider = DEFAULT_PROVIDER, apiKey, model, prompt, size = '1024x1024' }) {
    if (provider === 'gemini') {
      return generateGeminiImage({ apiKey, model, prompt, size });
    }
    return generateOpenAIImage({ apiKey, model, prompt, size });
  }

  window.LocalOpenAIPrototype = {
    DEFAULT_PROVIDER,
    loadSettings,
    saveSettings,
    clearSettings,
    extractError,
    extractText,
    extractGeminiText,
    requestText,
    generateImage,
  };
})();
