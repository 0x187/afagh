// ═══ Dormitory residence card client ═══
import { apiGet, apiPost } from './api';

export type DormRow = {
  id: number;
  studentId: number;
  studentCode: string;
  fullName: string;
  majorName: string | null;
  degreeLevel: string | null;
  dormName: string | null;
  roomNo: string | null;
  bedNo: string | null;
  academicYear: string | null;
  validFrom: string | null;
  validTo: string | null;
  status: string;
  createdAt: string | null;
};

export type DormStudentHit = { studentId: number; studentCode: string; name: string; entryYear: number | null };

export async function listDormResidences(status = ''): Promise<DormRow[]> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  const res = await apiGet<{ ok: boolean; data: { rows: DormRow[] } }>(`/admin/dorm${qs}`);
  return res.data.rows;
}

export async function searchDormStudents(q: string): Promise<DormStudentHit[]> {
  if (q.trim().length < 2) return [];
  const res = await apiGet<{ ok: boolean; data: { hits: DormStudentHit[] } }>(`/admin/students/search?q=${encodeURIComponent(q.trim())}`);
  return res.data.hits;
}

export async function createDormResidence(input: Record<string, unknown>): Promise<number> {
  const res = await apiPost<{ ok: boolean; data: { id: number } }>('/admin/dorm', input);
  return res.data.id;
}

export async function updateDormResidence(id: number, input: Record<string, unknown>): Promise<void> {
  await apiPost('/admin/dorm/update', { id, ...input });
}

export async function deleteDormResidence(id: number): Promise<void> {
  await apiPost('/admin/dorm/delete', { id });
}
