function isWebRequest(request) {
  return Boolean(
    request
      && typeof request.method === 'string'
      && typeof request.url === 'string'
      && request.headers
      && typeof request.headers.get === 'function'
  );
}

function normalizeNodeHeaders(headers = {}) {
  const normalized = new Headers();
  for (const [key, value] of Object.entries(headers || {})) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      normalized.set(key, value.join(', '));
    } else {
      normalized.set(key, String(value));
    }
  }
  return normalized;
}

function getHeader(headers, name) {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers || {})) {
    if (key.toLowerCase() === target) {
      return Array.isArray(value) ? value[0] : String(value || '');
    }
  }
  return '';
}

async function readNodeBody(request) {
  if (request.body != null) {
    if (Buffer.isBuffer(request.body)) return request.body;
    if (typeof request.body === 'string') return Buffer.from(request.body);
    if (typeof request.body === 'object') return Buffer.from(JSON.stringify(request.body));
  }

  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function toWebRequest(request) {
  const method = String(request.method || 'GET').toUpperCase();
  const headers = normalizeNodeHeaders(request.headers);
  const rawUrl = String(request.url || '/');
  const url = /^https?:\/\//i.test(rawUrl)
    ? rawUrl
    : `${getHeader(request.headers, 'x-forwarded-proto') || 'https'}://${getHeader(request.headers, 'host') || 'promptlab.tools'}${rawUrl}`;
  const body = ['GET', 'HEAD'].includes(method) ? undefined : await readNodeBody(request);

  return new Request(url, {
    method,
    headers,
    ...(body && body.length > 0 ? { body } : {}),
  });
}

async function writeNodeResponse(response, webResponse) {
  response.statusCode = webResponse.status;
  webResponse.headers.forEach((value, key) => {
    response.setHeader(key, value);
  });

  const body = Buffer.from(await webResponse.arrayBuffer());
  response.end(body);
}

export function createNodeCompatibleHandler(webHandler) {
  return async function nodeCompatibleHandler(request, response) {
    if (isWebRequest(request) || !response) {
      return webHandler(request);
    }

    const webRequest = await toWebRequest(request);
    const webResponse = await webHandler(webRequest);
    await writeNodeResponse(response, webResponse);
  };
}
