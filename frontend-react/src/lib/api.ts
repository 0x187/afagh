// ═══ لایهٔ تماس با API v2 (بکند Go) ═══
//
// همه‌چیز same-origin است (SPA پشت همان لبهٔ Go سرو می‌شود)؛ کوکی سشن
// خودکار همراه می‌رود و CSRF هم سمت سرور با Origin چک می‌شود.
// پاکت پاسخ: {ok, error?, ...} — خطاها همیشه پیام فارسی آمادهٔ نمایش دارند.

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
    /* پاسخ غیر JSON — پایین خطای عمومی می‌دهیم */
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

// ── انواع مشترک ──

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
