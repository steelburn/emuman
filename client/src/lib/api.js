export class ApiError extends Error {
  constructor(message, status, payload) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

async function request(method, path, body, options = {}) {
  const headers = { Accept: 'application/json', ...(options.headers || {}) };
  let payload;
  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  if (method !== 'GET' && method !== 'HEAD') headers['x-emuman'] = '1';

  let response;
  try {
    response = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      body: payload,
      signal: options.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError('Cannot reach the emuman server', 0, null);
  }

  if (response.status === 204) return null;
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }
  if (!response.ok) {
    const message = data?.error || data?.message || `Request failed (${response.status})`;
    throw new ApiError(message, response.status, data);
  }
  return data;
}

export const api = {
  get: (path, options) => request('GET', path, undefined, options),
  post: (path, body, options) => request('POST', path, body, options),
  patch: (path, body, options) => request('PATCH', path, body, options),
  del: (path, options) => request('DELETE', path, undefined, options),
  request,
};

export function wsUrl(path) {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}${path}`;
}
