// ═══ Disciplinary committee and educational council client (phase 8) ═══
import { apiGet, apiPost } from './api';

export const DISCIPLINE_STATUSES = ['در حال بررسی', 'در کمیته', 'تصمیم‌گیری‌شده', 'تجدیدنظر'];
export const DISCIPLINE_DECISIONS = ['تذکر شفاهی', 'تذکر کتبی', 'اخطار', 'تعلیق موقت', 'اخراج', 'تبرئه'];
export const DISCIPLINE_VIOLATION_TYPES = [
  'غیبت غیرموجه', 'تقلب در آزمون', 'رفتار غیراخلاقی', 'تخریب اموال',
  'عدم رعایت مقررات آموزشی', 'سایر موارد',
];

export type DisciplineCase = {
  id: number; studentId: number; studentCode: string; studentName: string;
  violationType: string; description: string | null; reporterName: string | null;
  status: string; committeeDecision: string | null; decisionNotes: string | null;
  caseDate: string | null; decidedAt: string | null; createdAt: string | null; documentCount: number;
};

export async function listDiscipline(params: {
  status?: string; q?: string; studentId?: number; dateFrom?: string; dateTo?: string; page?: number;
} = {}): Promise<{ rows: DisciplineCase[]; total: number; page: number; pageSize: number }> {
  const q = new URLSearchParams();
  if (params.status) q.set('status', params.status);
  if (params.q) q.set('q', params.q);
  if (params.studentId) q.set('studentId', String(params.studentId));
  if (params.dateFrom) q.set('dateFrom', params.dateFrom);
  if (params.dateTo) q.set('dateTo', params.dateTo);
  q.set('page', String(params.page ?? 1));
  const res = await apiGet<{ ok: boolean; data: { rows: DisciplineCase[]; total: number; page: number; pageSize: number } }>(`/admin/discipline?${q.toString()}`);
  return res.data;
}

export async function searchDisciplineStudents(q: string): Promise<{ studentId: number; studentCode: string; name: string; entryYear: number | null }[]> {
  const res = await apiGet<{ ok: boolean; data: { hits: { studentId: number; studentCode: string; name: string; entryYear: number | null }[] } }>(`/admin/discipline/students?q=${encodeURIComponent(q)}`);
  return res.data.hits;
}

export async function createDiscipline(input: { studentId: number; violationType: string; description?: string; reporterName?: string; caseDate?: string }): Promise<number> {
  const res = await apiPost<{ ok: boolean; data: { id: number } }>('/admin/discipline', input);
  return res.data.id;
}

export async function updateDiscipline(id: number, input: { status?: string; committeeDecision?: string; decisionNotes?: string }): Promise<void> {
  await apiPost<{ ok: boolean }>('/admin/discipline/update', { id, ...input });
}

export async function deleteDiscipline(id: number): Promise<void> {
  await apiPost<{ ok: boolean }>('/admin/discipline/delete', { id });
}

// ─────────────────── Council ───────────────────

export const COUNCIL_DECISION_TYPES = ['مصوبه', 'توصیه', 'درخواست تجدیدنظر'];
export const COUNCIL_IMPLEMENTATION_STATUSES = ['در انتظار اجرا', 'در حال اجرا', 'اجراشده'];

export type CouncilMeeting = {
  id: number; title: string; meetingDate: string | null; members: string | null;
  agenda: string | null; minutes: string | null; decisionsCount: number;
  createdAt: string | null; updatedAt: string | null;
};

export type CouncilDecision = {
  id: number; meetingId: number; meetingTitle: string | null; meetingDate: string | null;
  studentId: number | null; studentName: string | null; studentCode: string | null;
  decisionType: string; content: string; implementationStatus: string;
  deadline: string | null; createdAt: string | null; updatedAt: string | null;
};

export async function listCouncilMeetings(params: { q?: string; dateFrom?: string; dateTo?: string; page?: number } = {}): Promise<{ rows: CouncilMeeting[]; total: number; page: number }> {
  const q = new URLSearchParams();
  if (params.q) q.set('q', params.q);
  if (params.dateFrom) q.set('dateFrom', params.dateFrom);
  if (params.dateTo) q.set('dateTo', params.dateTo);
  q.set('page', String(params.page ?? 1));
  const res = await apiGet<{ ok: boolean; data: { rows: CouncilMeeting[]; total: number; page: number } }>(`/admin/council?${q.toString()}`);
  return res.data;
}

export async function saveCouncilMeeting(input: { id?: number; title: string; meetingDate?: string; members?: string; agenda?: string; minutes?: string }): Promise<number> {
  const res = await apiPost<{ ok: boolean; data: { id: number } }>('/admin/council', input);
  return res.data.id;
}

export async function deleteCouncilMeeting(id: number): Promise<void> {
  await apiPost<{ ok: boolean }>('/admin/council/delete', { id });
}

export async function listCouncilDecisions(params: { meetingId?: number; studentId?: number; status?: string; type?: string; page?: number } = {}): Promise<{ rows: CouncilDecision[]; total: number; page: number }> {
  const q = new URLSearchParams();
  if (params.meetingId) q.set('meetingId', String(params.meetingId));
  if (params.studentId) q.set('studentId', String(params.studentId));
  if (params.status) q.set('status', params.status);
  if (params.type) q.set('type', params.type);
  q.set('page', String(params.page ?? 1));
  const res = await apiGet<{ ok: boolean; data: { rows: CouncilDecision[]; total: number; page: number } }>(`/admin/council/decisions?${q.toString()}`);
  return res.data;
}

export async function saveCouncilDecision(input: {
  id?: number; meetingId: number; studentId?: number | null; decisionType: string;
  content: string; implementationStatus: string; deadline?: string;
}): Promise<number> {
  const res = await apiPost<{ ok: boolean; data: { id: number } }>('/admin/council/decisions', input);
  return res.data.id;
}

export async function deleteCouncilDecision(id: number): Promise<void> {
  await apiPost<{ ok: boolean }>('/admin/council/decisions/delete', { id });
}
