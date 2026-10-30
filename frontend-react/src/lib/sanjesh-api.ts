// ═══ کلاینت درون‌ریزی فایل سنجش ═══
import { ApiError } from './api';

export type SanjeshRow = Record<string, string>;
export type SanjeshPreview = { count: number; sample: SanjeshRow[] };
export type SanjeshCommitResult = { updated: number; notFound: number; total: number };

async function postForm<T>(path: string, form: FormData): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v2${path}`, { method: 'POST', body: form, credentials: 'same-origin', headers: { Accept: 'application/json' } });
  } catch {
    throw new ApiError('ارتباط با سرور برقرار نشد.', 0);
  }
  let payload: unknown = null;
  try { payload = await res.json(); } catch { /* غیر JSON */ }
  if (!res.ok) {
    const msg = payload && typeof payload === 'object' && 'error' in payload && typeof (payload as { error: unknown }).error === 'string'
      ? (payload as { error: string }).error : `خطای سرور (${res.status})`;
    throw new ApiError(msg, res.status);
  }
  return payload as T;
}

function buildForm(structure: string, file: File): FormData {
  const fd = new FormData();
  fd.set('structure', structure);
  fd.set('file', file);
  return fd;
}

export async function previewSanjesh(structure: string, file: File): Promise<SanjeshPreview> {
  const res = await postForm<{ ok: boolean; data: SanjeshPreview }>('/admin/sanjesh/preview', buildForm(structure, file));
  return res.data;
}

export async function commitSanjesh(structure: string, file: File): Promise<SanjeshCommitResult> {
  const res = await postForm<{ ok: boolean; data: SanjeshCommitResult }>('/admin/sanjesh/commit', buildForm(structure, file));
  return res.data;
}
