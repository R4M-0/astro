const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

let accessToken: string | null = null;
let activeOrgId: string | null = null;
let refreshPromise: Promise<boolean> | null = null;
let onUnauthorized: (() => void) | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}
export function getAccessToken() {
  return accessToken;
}
export function setActiveOrgId(orgId: string | null) {
  activeOrgId = orgId;
  if (typeof window !== 'undefined') {
    if (orgId) localStorage.setItem('astro.orgId', orgId);
    else localStorage.removeItem('astro.orgId');
  }
}
export function getStoredOrgId(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('astro.orgId');
}
export function setOnUnauthorized(handler: () => void) {
  onUnauthorized = handler;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

/** Rotate the refresh cookie into a new access token. Deduplicates concurrent calls. */
export async function tryRefresh(): Promise<boolean> {
  refreshPromise ??= (async () => {
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) return false;
      const body = (await res.json()) as { accessToken: string };
      accessToken = body.accessToken;
      return true;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

export async function api<T = unknown>(
  path: string,
  options: RequestInit & { skipAuthRetry?: boolean } = {},
): Promise<T> {
  const doFetch = () =>
    fetch(`${API_URL}${path}`, {
      ...options,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...(activeOrgId ? { 'X-Organization-Id': activeOrgId } : {}),
        ...options.headers,
      },
    });

  let res = await doFetch();

  if (res.status === 401 && !options.skipAuthRetry && !path.startsWith('/auth/')) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      res = await doFetch();
    } else {
      onUnauthorized?.();
      throw new ApiError(401, 'Session expired');
    }
  }

  if (!res.ok) {
    let message = res.statusText;
    let details: unknown;
    try {
      details = await res.json();
      const d = details as { message?: string | string[] };
      message = Array.isArray(d.message) ? d.message.join(', ') : (d.message ?? message);
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message, details);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Workforce graph service (apps/graph) — same access token and tenant header as the API. */
export const GRAPH_URL = process.env.NEXT_PUBLIC_GRAPH_URL ?? 'http://localhost:3012';
export async function graphApi<T = unknown>(path: string, body?: unknown): Promise<T> {
  const doFetch = () =>
    fetch(`${GRAPH_URL}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...(activeOrgId ? { 'X-Organization-Id': activeOrgId } : {}),
      },
    });
  let res = await doFetch();
  if (res.status === 401 && (await tryRefresh())) res = await doFetch();
  if (!res.ok) {
    const d = (await res.json().catch(() => ({}))) as { message?: string };
    throw new ApiError(res.status, d.message ?? res.statusText);
  }
  return (await res.json()) as T;
}

export const apiGet = <T>(path: string) => api<T>(path);
export const apiPost = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
export const apiPatch = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) });
export const apiPut = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) });
export const apiDelete = <T>(path: string) => api<T>(path, { method: 'DELETE' });

/** Authenticated fetch without a JSON body (multipart uploads, file downloads). */
async function rawFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const doFetch = () =>
    fetch(`${API_URL}${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...(activeOrgId ? { 'X-Organization-Id': activeOrgId } : {}),
        ...init.headers,
      },
    });
  let res = await doFetch();
  if (res.status === 401 && (await tryRefresh())) res = await doFetch();
  if (!res.ok) {
    let message = res.statusText;
    let details: unknown;
    try {
      details = await res.json();
      const d = details as { message?: string | string[] };
      message = Array.isArray(d.message) ? d.message.join(', ') : (d.message ?? message);
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message, details);
  }
  return res;
}

/** POST multipart/form-data (the browser sets the boundary header). */
export async function apiUpload<T>(path: string, form: FormData): Promise<T> {
  const res = await rawFetch(path, { method: 'POST', body: form });
  return (await res.json()) as T;
}

/** Authenticated request returning the raw body as a Blob (file viewers, server-side exports). */
export async function apiBlob(path: string, init: { method?: string; body?: unknown } = {}): Promise<Blob> {
  const res = await rawFetch(path, {
    method: init.method ?? 'GET',
    ...(init.body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(init.body) }),
  });
  return res.blob();
}

/** Save a Blob under `name` (client-side exports). */
export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Download an authenticated file and save it under the server-provided name. */
export async function apiDownload(path: string, fallbackName: string): Promise<void> {
  const res = await rawFetch(path);
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const name = /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * POST a JSON body and read a server-sent-events response (`data: {…}` lines),
 * handing each parsed event to `onEvent` as it arrives (AI assistant streaming).
 */
export async function apiStream<E = Record<string, unknown>>(
  path: string,
  body: unknown,
  onEvent: (event: E) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await rawFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const data = frame
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
        .join('\n');
      if (data) onEvent(JSON.parse(data) as E);
    }
  }
}
