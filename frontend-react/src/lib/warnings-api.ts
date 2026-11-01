// ═══ Scheduled warnings client ═══
import { apiGet, apiPost } from './api';

export type WarningRow = {
  id: number;
  studentId: number;
  studentCode: string | null;
  studentName: string | null;
  warningType: string | null;
  title: string | null;
  message: string | null;
  sendAt: string;
  sentAt: string | null;
  status: string;
  createdAt: string | null;
};

export type WarningStudentHit = {
  studentId: number;
  studentCode: string;
  name: string;
  entryYear: number | null;
};

export type WarningFilters = {
  q?: string;
  status?: string;
  type?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
};

export async function listWarnings(filters: WarningFilters): Promise<{ rows: WarningRow[]; total: number; page: number; pageSize: number }> {
  const q = new URLSearchParams();
  if (filters.q?.trim()) q.set('q', filters.q.trim());
  if (filters.status) q.set('status', filters.status);
  if (filters.type) q.set('type', filters.type);
  if (filters.dateFrom) q.set('dateFrom', filters.dateFrom);
  if (filters.dateTo) q.set('dateTo', filters.dateTo);
  if (filters.page && filters.page > 1) q.set('page', String(filters.page));
  const res = await apiGet<{ ok: boolean; data: { rows: WarningRow[]; total: number; page: number; pageSize: number } }>(
    `/admin/warnings${q.toString() ? `?${q.toString()}` : ''}`,
  );
  return res.data;
}

export async function searchWarningStudents(query: string): Promise<WarningStudentHit[]> {
  if (query.trim().length < 2) return [];
  const res = await apiGet<{ ok: boolean; data: { hits: WarningStudentHit[] } }>(
    `/admin/warnings/students?q=${encodeURIComponent(query.trim())}`,
  );
  return res.data.hits;
}

export async function createWarning(input: {
  studentId: number;
  warningType: string;
  title?: string | null;
  message?: string | null;
  sendAt: string;
}): Promise<number> {
  const res = await apiPost<{ ok: boolean; data: { id: number } }>('/admin/warnings', input);
  return res.data.id;
}

export async function updateWarning(id: number, patch: Record<string, unknown>): Promise<void> {
  await apiPost<{ ok: boolean }>('/admin/warnings/update', { id, ...patch });
}

export async function deleteWarning(id: number): Promise<void> {
  await apiPost<{ ok: boolean }>('/admin/warnings/delete', { id });
}
