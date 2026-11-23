import type { PublicBootstrapData } from '../types/platform';

let inMemoryAuthToken: string | null = null;
let onUnauthorizedHandler: (() => void) | null = null;

export function setInMemoryAuthToken(token: string | null): void {
  inMemoryAuthToken = token;
}

export function getInMemoryAuthToken(): string | null {
  return inMemoryAuthToken;
}

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorizedHandler = handler;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

let preferVercelQueryRouting = false;

function toVercelQueryUrl(path: string): string | null {
  if (!path.startsWith('/api/')) return null;
  const queryIndex = path.indexOf('?');
  const rawPathname = queryIndex >= 0 ? path.slice(0, queryIndex) : path;
  const rawQuery = queryIndex >= 0 ? path.slice(queryIndex + 1) : '';
  const subpath = rawPathname.slice('/api/'.length).replace(/^\/+/, '');
  const params = new URLSearchParams(rawQuery);
  params.set('__vercel_api_path', subpath);
  return `/api/index?${params.toString()}`;
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit & { skipUnauthorizedCallback?: boolean } = {}
): Promise<T> {
  const { skipUnauthorizedCallback, headers: customHeaders, body, ...rest } = options;
  const headers = new Headers(customHeaders);
  headers.set('X-Requested-With', 'XMLHttpRequest');

  if (inMemoryAuthToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${inMemoryAuthToken}`);
  }
  if (body && !(body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const initialUrl = preferVercelQueryRouting ? (toVercelQueryUrl(path) ?? path) : path;
  let response = await fetch(initialUrl, {
    ...rest,
    headers,
    body,
    credentials: 'include'
  });

  let contentType = (response.headers.get('content-type') || '').toLowerCase();
  const isUnexpectedHtmlOr404 =
    path.startsWith('/api/') &&
    ((response.status === 404 && !contentType.includes('application/json')) ||
      contentType.includes('text/html'));

  if (!preferVercelQueryRouting && isUnexpectedHtmlOr404) {
    const fallbackUrl = toVercelQueryUrl(path);
    if (fallbackUrl) {
      const fallbackResponse = await fetch(fallbackUrl, {
        ...rest,
        headers,
        body,
        credentials: 'include'
      });
      const fallbackType = (fallbackResponse.headers.get('content-type') || '').toLowerCase();
      if (fallbackType.includes('application/json')) {
        preferVercelQueryRouting = true;
        response = fallbackResponse;
        contentType = fallbackType;
      }
    }
  }

  if (response.status === 401 && !skipUnauthorizedCallback && onUnauthorizedHandler) {
    onUnauthorizedHandler();
  }

  if (contentType.includes('application/json')) {
    const data = await response.json();
    if (!response.ok) {
      throw new ApiError(data?.error || `Request failed (${response.status})`, response.status);
    }
    return data as T;
  }

  if (path.startsWith('/api/') && contentType.includes('text/html')) {
    throw new ApiError(
      'Backend API returned HTML instead of JSON. Ensure /api/* routes to api/index.js on Vercel.',
      response.status === 200 ? 502 : response.status
    );
  }

  if (!response.ok) {
    throw new ApiError(`Request failed (${response.status})`, response.status);
  }
  return (await response.text()) as unknown as T;
}

export async function fetchPublicBootstrap(): Promise<PublicBootstrapData> {
  return apiRequest<PublicBootstrapData>('/api/public/bootstrap', {
    skipUnauthorizedCallback: true
  });
}
