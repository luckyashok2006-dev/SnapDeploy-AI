/// <reference types="vite/client" />

/**
 * Centralized API client helper for SnapDeploy AI frontend.
 * Configurable via VITE_API_BASE_URL (defaults to empty string for relative proxying in dev/prod).
 */

export const API_BASE = (
  typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_BASE_URL
    ? String((import.meta as any).env.VITE_API_BASE_URL)
    : ''
).replace(/\/+$/, '');

/**
 * Constructs the canonical API URL for an endpoint.
 */
export function buildApiUrl(endpoint: string): string {
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${API_BASE}${cleanEndpoint}`;
}

export interface ApiRequestOptions extends Omit<RequestInit, 'body'> {
  body?: any;
}

/**
 * Dispatches a typed JSON API request to the backend server with proper error propagation.
 */
export async function apiRequest<T = any>(
  endpoint: string,
  options: ApiRequestOptions = {}
): Promise<T> {
  const url = buildApiUrl(endpoint);
  const headers = new Headers(options.headers || {});

  let body: any = options.body;
  if (body !== undefined && typeof body === 'object' && !(body instanceof FormData) && !(body instanceof Blob)) {
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    body = JSON.stringify(body);
  }

  const res = await fetch(url, {
    ...options,
    headers,
    body
  });

  if (!res.ok) {
    let errorMsg = `API request to ${endpoint} failed (${res.status})`;
    try {
      const errData = await res.json();
      errorMsg = errData.error || errData.message || errorMsg;
    } catch {
      try {
        const text = await res.text();
        if (text) errorMsg = text;
      } catch {}
    }
    const err: any = new Error(errorMsg);
    err.status = res.status;
    throw err;
  }

  return await res.json();
}
