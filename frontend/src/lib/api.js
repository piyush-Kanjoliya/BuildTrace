import axios from 'axios';

/**
 * API client for the BuildTrace backend (/api/v1).
 *
 * - Attaches the Bearer token from localStorage.
 * - Unwraps the { success, data } envelope, so callers receive `data` directly.
 * - Normalizes every error into an ApiError with { message, code, details, status }.
 * - A 401 on an authenticated session broadcasts "unauthorized" so the app can
 *   drop the session once (e.g. token expired or user deleted).
 */

const TOKEN_KEY = 'buildtrace.token';

export function getToken() {
  return window.localStorage.getItem(TOKEN_KEY);
}
export function setToken(token) {
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(message, { code = 'ERROR', details = null, status = 0 } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
    this.status = status;
  }

  /** Field-level messages keyed by path, for inline form errors. */
  get fieldErrors() {
    if (!Array.isArray(this.details)) return {};
    return Object.fromEntries(
      this.details.filter((d) => d && d.path).map((d) => [d.path, d.message])
    );
  }
}

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api/v1';

const http = axios.create({
  baseURL: API_BASE_URL,
  timeout: 20000,
});

http.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

http.interceptors.response.use(
  (response) => response,
  (error) => {
    let normalized;
    if (error.response) {
      const body = error.response.data || {};
      const err = body.error || {};
      normalized = new ApiError(err.message || `Request failed (${error.response.status})`, {
        code: err.code || 'ERROR',
        details: err.details || null,
        status: error.response.status,
      });
    } else if (error.code === 'ECONNABORTED') {
      normalized = new ApiError('The request timed out. Check your connection and retry.', {
        code: 'TIMEOUT',
      });
    } else {
      normalized = new ApiError('Cannot reach the BuildTrace API. Is the server running?', {
        code: 'NETWORK',
      });
    }

    if (
      normalized.status === 401 &&
      getToken() &&
      !(error.config && error.config.url && error.config.url.includes('/auth/login'))
    ) {
      window.dispatchEvent(new CustomEvent('buildtrace:unauthorized'));
    }
    return Promise.reject(normalized);
  }
);

async function unwrap(promise) {
  const response = await promise;
  const body = response.data;
  return body && typeof body === 'object' && 'data' in body ? body.data : body;
}

export const api = {
  get: (url, config) => unwrap(http.get(url, config)),
  post: (url, data, config) => unwrap(http.post(url, data, config)),
  patch: (url, data, config) => unwrap(http.patch(url, data, config)),
  delete: (url, config) => unwrap(http.delete(url, config)),
};
