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

export type AdminOfferingsData = {
  term: { id: number | null; title: string; termCode: string; isEnrollmentOpen: boolean };
  window: { open: boolean; state: string; label: string; start: string | null; end: string | null };
  offerings: {
    id: number;
    code: string;
    title: string;
    group: number;
    capacity: number;
    enrolled: number;
    targetDegreeLevelId: number | null;
    targetMajorId: number | null;
    entryYearStart: number | null;
    entryYearEnd: number | null;
    offeringType: string | null;
    targetLabel: string;
  }[];
  degrees: { id: number; title: string }[];
  majors: { id: number; title: string }[];
};

export async function getAdminOfferings(): Promise<AdminOfferingsData> {
  const res = await apiGet<{ ok: boolean; data: AdminOfferingsData }>('/admin/offerings');
  return res.data;
}

export async function saveEnrollmentWindow(input: { termId: number; open: boolean; start: string; end: string }): Promise<void> {
  await apiPost('/admin/offerings/window', input);
}

export async function saveOfferingTargeting(input: {
  offeringId: number;
  degree: number | null;
  major: number | null;
  entryYearStart: number | null;
  entryYearEnd: number | null;
}): Promise<void> {
  await apiPost('/admin/offerings/targeting', input);
}

export async function saveOfferingType(offeringId: number, type: string): Promise<void> {
  await apiPost('/admin/offerings/type', { offeringId, type });
}

export type AdminEvaluationsData = {
  terms: { id: number; title: string; termCode: string }[];
  periods: { id: number; title: string; termId: number | null; termTitle: string | null; startDate: string | null; endDate: string | null; isActive: number; open: boolean }[];
};

export async function getAdminEvaluations(): Promise<AdminEvaluationsData> {
  const res = await apiGet<{ ok: boolean; data: AdminEvaluationsData }>('/admin/evaluations');
  return res.data;
}

export async function createEvaluationPeriod(input: { title: string; termId: number; start: string; end: string; isActive: boolean }): Promise<void> {
  await apiPost('/admin/evaluations', input);
}

export async function toggleEvaluationPeriod(id: number): Promise<void> {
  await apiPost('/admin/evaluations/toggle', { id });
}

export async function deleteEvaluationPeriod(id: number): Promise<void> {
  await apiPost('/admin/evaluations/delete', { id });
}

export type WeeklyBoardRow = {
  offeringId: number;
  groupNumber: number;
  courseCode: string;
  courseTitle: string;
  courseType: string;
  dayOfWeek: number | null;
  startTime: string;
  endTime: string;
  roomId: number | null;
  roomName: string | null;
  buildingName: string | null;
  professor: string;
  departmentName: string | null;
  enrolledCount: number;
  capacity: number;
};

export type WeeklyBoardData = {
  term: { id: number | null; title: string; termCode: string; isEnrollmentOpen: boolean };
  rows: WeeklyBoardRow[];
  rooms: { id: number; title: string }[];
  departments: { id: number; title: string }[];
  professors: { id: number; title: string }[];
};

export async function getWeeklyBoard(): Promise<WeeklyBoardData> {
  const res = await apiGet<{ ok: boolean; data: WeeklyBoardData }>('/admin/weekly-board');
  return res.data;
}

export type AdminSetting = { key: string; value: string; default: string; source: string; isSecret: boolean };

export async function getAdminSettings(): Promise<AdminSetting[]> {
  const res = await apiGet<{ ok: boolean; data: { settings: AdminSetting[] } }>('/admin/settings');
  return res.data.settings;
}

export async function saveAdminSetting(key: string, value: string): Promise<void> {
  await apiPost('/admin/settings', { key, value });
}

export async function resetAdminSetting(key: string): Promise<void> {
  await apiPost('/admin/settings/reset', { key });
}

export type ExamsData = {
  term: { id: number | null; title: string; termCode: string; isEnrollmentOpen: boolean };
  sessions: { id: number; termId: number | null; examDate: string; startTime: string; endTime: string; allocated: number }[];
  courses: { offeringId: number; courseCode: string; courseTitle: string; groupNumber: number; examDate: string; startTime: string; endTime: string; roomName: string | null; sessionId: number | null }[];
  halls: { id: number; name: string; capacity: number; rowsCount: number | null; colsCount: number | null; buildingName: string | null }[];
  allocatedTotal: number;
};

export async function getExams(): Promise<ExamsData> {
  const res = await apiGet<{ ok: boolean; data: ExamsData }>('/admin/exams');
  return res.data;
}

export async function createExamSession(input: { termId: number; examDate: string; start: string; end: string }): Promise<void> {
  await apiPost('/admin/exams/sessions', input);
}

export async function assignExamSession(offeringId: number, sessionId: number): Promise<void> {
  await apiPost('/admin/exams/assign', { offeringId, sessionId });
}

export async function createExamHall(input: { name: string; capacity: number; rowsCount: number; colsCount: number; buildingName: string }): Promise<void> {
  await apiPost('/admin/exams/halls', input);
}

export async function generateExamSeats(): Promise<{ allocated: number; sessionCount: number }> {
  return apiPost('/admin/exams/seats');
}
