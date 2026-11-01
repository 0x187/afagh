// ═══ API v2 call layer (Go backend) ═══
//
// Everything is same-origin (the SPA is served behind the same Go edge); the session cookie
// travels automatically and CSRF is checked server-side via Origin too.
// Response envelope: {ok, error?, ...} — errors always carry a ready-to-display Persian message.

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v2${path}`, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}) },
      ...init,
    });
  } catch {
    throw new ApiError('ارتباط با سرور برقرار نشد.', 0);
  }
  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    /* Non-JSON response — the generic error is given below */
  }
  if (!res.ok) {
    const msg =
      payload && typeof payload === 'object' && 'error' in payload && typeof (payload as { error: unknown }).error === 'string'
        ? (payload as { error: string }).error
        : `خطای سرور (${res.status})`;
    throw new ApiError(msg, res.status);
  }
  return payload as T;
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path);
}

export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: 'POST', body: body === undefined ? '{}' : JSON.stringify(body) });
}

export function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: 'PATCH', body: body === undefined ? '{}' : JSON.stringify(body) });
}

export function apiDelete<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'DELETE' });
}

// ── Shared types ──

export type SessionUser = {
  id: number;
  name: string;
  roles: string[];
  mustChangePassword: boolean;
  universityId: number | null;
};

export type SessionResponse = {
  ok: boolean;
  user: SessionUser | null;
  pendingPasswordChange?: boolean;
};

export type HealthChecks = { db: string; redis: string; minio: string };

export type HealthResponse = {
  ok: boolean;
  checks: HealthChecks;
  version: string;
};
