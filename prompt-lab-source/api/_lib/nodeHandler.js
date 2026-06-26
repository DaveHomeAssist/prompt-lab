function getRequestUrl(req) {
  const rawUrl = String(req?.url || '/');
  if (/^https?:\/\//i.test(rawUrl)) return rawUrl;
  const host = req?.headers?.host || 'promptlab.tools';
  const protocol = req?.headers?.['x-forwarded-proto'] || 'https';
  return `${protocol}://${host}${rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`}`;
}

function getRequestHeaders(req) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req?.headers || {})) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else if (value != null) {
      headers.set(key, String(value));
    }
  }
  return headers;
}

function isWebRequest(request) {
  return typeof Request !== 'undefined' && request instanceof Request;
}

function createWebRequest(req) {
  const method = String(req?.method || 'GET').toUpperCase();
  const init = {
    method,
    headers: getRequestHeaders(req),
  };

  if (method !== 'GET' && method !== 'HEAD') {
    init.body = req;
    init.duplex = 'half';
  }

  return new Request(getRequestUrl(req), init);
}

async function writeWebResponse(res, response) {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  const body = Buffer.from(await response.arrayBuffer());
  res.end(body);
}

export function createNodeCompatibleHandler(webHandler) {
  return async function nodeCompatibleHandler(req, res) {
    if (!res || isWebRequest(req)) {
      return webHandler(req);
    }

    try {
      const response = await webHandler(createWebRequest(req));
      return writeWebResponse(res, response);
    } catch (error) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        error: error?.message || 'Internal server error.',
      }));
    }
  };
}
