// ═══ کلاینت پنل ادمین (فاز ۶) ═══
import { apiGet, apiPost } from './api';

export type AdminDashboardData = {
  universityTitle: string;
  stats: { studentsTotal: number; studentsActive: number; offerings: number; enrollments: number; requestsOpen: number; requestsTotal: number };
  inbox: { id: number; trackingCode: string; status: string; created: string | null; studentName: string; studentCode: string; processTitle: string | null }[];
  queueLength: number;
  warmedOfferings: number;
  gradeLive: { actor: string; actorRole: string | null; studentCode: string | null; course: string | null; grade: string | null; at: string | null }[];
};

export async function getAdminDashboard(): Promise<AdminDashboardData> {
  const res = await apiGet<{ ok: boolean; data: AdminDashboardData }>('/admin/dashboard');
  return res.data;
}

export type AdminStudentRow = {
  id: number;
  studentCode: string;
  fullName: string;
  nationalCode: string | null;
  entryYear: number;
  entryTerm: number | null;
  status: string;
  majorName: string | null;
  degreeTitle: string | null;
  isActive: number;
};

export async function getAdminStudents(params: { q?: string; status?: string; page?: number }): Promise<{ total: number; page: number; rows: AdminStudentRow[] }> {
  const q = new URLSearchParams();
  if (params.q) q.set('q', params.q);
  if (params.status) q.set('status', params.status);
  if (params.page) q.set('page', String(params.page));
  const res = await apiGet<{ ok: boolean; data: { total: number; page: number; rows: AdminStudentRow[] } }>(`/admin/students?${q.toString()}`);
  return res.data;
}

export async function setStudentActive(userId: number, active: boolean): Promise<void> {
  await apiPost('/admin/students/active', { userId, active });
}

export async function resetStudentPassword(userId: number): Promise<void> {
  await apiPost('/admin/students/reset-password', { userId });
}

export async function getAdminDepartments(): Promise<{ faculties: { id: number; name: string }[]; departments: { id: number; name: string; code: string | null; facultyId: number; facultyName: string }[] }> {
  const res = await apiGet<{ ok: boolean; data: { faculties: { id: number; name: string }[]; departments: { id: number; name: string; code: string | null; facultyId: number; facultyName: string }[] } }>('/admin/departments');
  return res.data;
}

export async function getAdminStaff(q?: string): Promise<{ id: number; staffCode: string; fullName: string; nationalCode: string | null; academicRank: string | null; staffType: string | null; departmentName: string | null; isActive: number }[]> {
  const qs = q ? `?q=${encodeURIComponent(q)}` : '';
  const res = await apiGet<{ ok: boolean; rows: { id: number; staffCode: string; fullName: string; nationalCode: string | null; academicRank: string | null; staffType: string | null; departmentName: string | null; isActive: number }[] }>(`/admin/staff${qs}`);
  return res.rows;
}
