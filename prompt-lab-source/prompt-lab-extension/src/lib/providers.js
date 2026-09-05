/**
 * Provider execution layer.
 *
 * All provider-specific logic (endpoints, headers, payloads, response shapes)
 * lives in the descriptor objects in providerRegistry.js. This module provides
 * the generic execution pipeline: validate → build → fetch → normalize → return.
 *
 * Backward-compatible named exports (callAnthropic, callOllama, etc.) are
 * preserved so existing call sites don't need to change yet.
 */

import {
  DEFAULTS,
  DEFAULT_PROVIDER,
  normalizeBaseUrl,
  normalizeProvider,
  getProvider,
  toChatMessages,
  toGeminiContents,
} from './providerRegistry.js';
import { normalizeError, authError } from './errorTaxonomy.js';

export { DEFAULT_PROVIDER, normalizeProvider, getProvider, allProviders, providerHasCapability } from './providerRegistry.js';
export { AppError, normalizeError, isRetryable, getUserMessage } from './errorTaxonomy.js';

// ── Shared fetch helpers ────────────────────────────────────────────

async function readErrorMessage(response, fallback) {
  try {
    const data = await response.json();
    if (data?.error?.message) return data.error.message;
    if (typeof data?.error === 'string') return data.error;
    if (data?.message) return data.message;
    return fallback;
  } catch {
    return fallback;
  }
}

function responseError(response, message) {
  const error = new Error(message);
  error.status = response?.status;
  return error;
}

function fetchOrThrow(fetchImpl) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('A fetch implementation is required.');
  }
  return fetchImpl;
}

function applySignal(init, signal) {
  if (!signal) return init;
  return { ...init, signal };
}

async function readTextStream(stream, { onChunk, parser }) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  let usage = null;

  const mergeUsage = (next) => {
    if (!next) return;
    const input = next.input ?? usage?.input ?? null;
    const output = next.output ?? usage?.output ?? null;
    const nextHasCompleteBreakdown = next.input !== null && next.input !== undefined
      && next.output !== null && next.output !== undefined;
    const total = nextHasCompleteBreakdown && next.total !== null && next.total !== undefined
      ? next.total
      : (input !== null && output !== null ? input + output : (next.total ?? usage?.total ?? null));
    usage = {
      input,
      output,
      total,
    };
  };

  const emitText = (text) => {
    if (!text) return;
    fullText += text;
    if (typeof onChunk === 'function') onChunk(text, fullText);
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const result = parser(buffer);
    buffer = result.buffer;
    result.chunks.forEach(emitText);
    mergeUsage(result.usage);
  }

  if (buffer) {
    const result = parser(buffer, true);
    result.chunks.forEach(emitText);
    mergeUsage(result.usage);
  }

  return { text: fullText, usage };
}

async function executeProviderStream(descriptor, payload, settings, fetchImpl, options = {}) {
  const requestBody = descriptor.buildPayload(payload, settings, { stream: true });
  const resolvedModel = descriptor.resolveModel(payload, settings);
  const endpoint = typeof descriptor.resolveEndpoint === 'function'
    ? descriptor.resolveEndpoint(settings, payload, { stream: true })
    : descriptor.endpoint;
  const headers = descriptor.buildHeaders(settings);

  const response = await fetchOrThrow(fetchImpl)(endpoint, applySignal({
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
  }, options.signal));

  if (!response.ok) {
    throw responseError(response, await readErrorMessage(response, `${descriptor.label} request failed (${response.status})`));
  }
  if (!response.body) {
    throw new Error(`${descriptor.label} returned no stream body.`);
  }

  const streamed = await readTextStream(response.body, {
    onChunk: options.onChunk,
    parser: descriptor.parseStream,
  });

  if (!streamed.text) {
    throw new Error(`${descriptor.label} returned empty streamed content.`);
  }

  return {
    content: [{ type: 'text', text: streamed.text }],
    model: resolvedModel,
    provider: descriptor.id,
    ...(streamed.usage ? { usage: streamed.usage } : {}),
  };
}

// ── Generic provider call via registry ──────────────────────────────

async function executeProvider(descriptor, payload, settings, fetchImpl, options = {}) {
  // Auth gate
  if (descriptor.requiresApiKey && !settings[descriptor.apiKeyField]) {
    throw authError(descriptor.label);
  }

  if (options.onChunk && descriptor.parseStream) {
    return executeProviderStream(descriptor, payload, settings, fetchImpl, options);
  }

  // Build request
  const requestBody = descriptor.buildPayload(payload, settings, { stream: false });
  const resolvedModel = descriptor.resolveModel(payload, settings);
  const endpoint = typeof descriptor.resolveEndpoint === 'function'
    ? descriptor.resolveEndpoint(settings, payload, { stream: false })
    : descriptor.endpoint;
  const headers = descriptor.buildHeaders(settings);

  // Execute
  const response = await fetchOrThrow(fetchImpl)(endpoint, applySignal({
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
  }, options.signal));

  if (!response.ok) {
    throw responseError(response, await readErrorMessage(response, `${descriptor.label} request failed (${response.status})`));
  }

  const data = await response.json();
  return descriptor.normalizeResponse(data, requestBody, resolvedModel);
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Call any registered provider by ID.
 * Normalizes all errors into AppError at the boundary.
 */
export async function callProvider({ provider = DEFAULT_PROVIDER, payload, settings = {}, fetchImpl = globalThis.fetch, onChunk, signal }) {
  const resolved = normalizeProvider(provider);
  const descriptor = getProvider(resolved);
  try {
    return await executeProvider(descriptor, payload, settings, fetchImpl, { onChunk, signal });
  } catch (err) {
    throw normalizeError(err, resolved);
  }
}

// ── Backward-compatible named exports ───────────────────────────────
// These preserve the existing call signatures so nothing else needs to change.

export async function callAnthropic(payload, settings = {}, fetchImpl = globalThis.fetch) {
  return executeProvider(getProvider('anthropic'), payload, settings, fetchImpl);
}

export async function callOllama(payload, settings = {}, fetchImpl = globalThis.fetch) {
  return executeProvider(getProvider('ollama'), payload, settings, fetchImpl);
}

export async function callOpenAI(payload, settings = {}, fetchImpl = globalThis.fetch) {
  return executeProvider(getProvider('openai'), payload, settings, fetchImpl);
}

export async function callGemini(payload, settings = {}, fetchImpl = globalThis.fetch) {
  return executeProvider(getProvider('gemini'), payload, settings, fetchImpl);
}

export async function callOpenRouter(payload, settings = {}, fetchImpl = globalThis.fetch) {
  return executeProvider(getProvider('openrouter'), payload, settings, fetchImpl);
}

// ── Ollama model listing ────────────────────────────────────────────

export async function listOllamaModels(baseUrl, fetchImpl = globalThis.fetch, { timeoutMs = 8000 } = {}) {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetchOrThrow(fetchImpl)(`${normalizeBaseUrl(baseUrl, DEFAULTS.ollamaBaseUrl)}/api/tags`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Ollama returned ${response.status}`);

    const data = await response.json();
    return (data?.models || []).map((model) => ({
      name: model.name,
      size: model.size,
      modified: model.modified_at,
      family: model.details?.family || '',
      paramSize: model.details?.parameter_size || '',
    }));
  } catch (error) {
    if (timedOut) throw new Error(`Ollama model discovery timed out after ${timeoutMs}ms.`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
