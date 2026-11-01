// ═══ Course registration confirmation and certificate issuance client ═══
import { apiGet, apiPost } from './api';

export type EnrollApprovalRow = {
  id: number;
  studentId: number;
  studentCode: string;
  studentName: string;
  offeringId: number;
  courseTitle: string;
  courseCode: string;
  termTitle: string;
  groupNumber: number | null;
  status: string;
  note: string | null;
  requestedBy: number | null;
  decidedBy: number | null;
  decidedAt: string | null;
  createdAt: string | null;
};

export type ApprovalStudentHit = { studentId: number; studentCode: string; name: string; entryYear: number | null };
export type ApprovalOfferingHit = {
  offeringId: number; courseTitle: string; courseCode: string; termTitle: string;
  groupNumber: number | null; capacity: number; enrolledCount: number;
};

export async function listEnrollApprovals(params: { q?: string; status?: string; page?: number }): Promise<{ rows: EnrollApprovalRow[]; total: number; page: number; pageSize: number }> {
  const qs = new URLSearchParams();
  if (params.q?.trim()) qs.set('q', params.q.trim());
  if (params.status) qs.set('status', params.status);
  if (params.page && params.page > 1) qs.set('page', String(params.page));
  const res = await apiGet<{ ok: boolean; data: { rows: EnrollApprovalRow[]; total: number; page: number; pageSize: number } }>(
    `/admin/enrollment-approvals${qs.toString() ? `?${qs}` : ''}`,
  );
  return res.data;
}

export async function searchApprovalStudents(q: string): Promise<ApprovalStudentHit[]> {
  if (!q.trim()) return [];
  const res = await apiGet<{ ok: boolean; data: { hits: ApprovalStudentHit[] } }>(`/admin/enrollment-approvals?action=students&q=${encodeURIComponent(q.trim())}`);
  return res.data.hits;
}

export async function searchApprovalOfferings(q: string): Promise<ApprovalOfferingHit[]> {
  const res = await apiGet<{ ok: boolean; data: { hits: ApprovalOfferingHit[] } }>(`/admin/enrollment-approvals?action=offerings&q=${encodeURIComponent(q.trim())}`);
  return res.data.hits;
}

export async function createEnrollApproval(input: { studentId: number; offeringId: number; note?: string | null }): Promise<number> {
  const res = await apiPost<{ ok: boolean; data: { id: number } }>('/admin/enrollment-approvals', input);
  return res.data.id;
}

export async function updateEnrollApproval(id: number, patch: { status?: string; note?: string | null }): Promise<void> {
  await apiPost('/admin/enrollment-approvals/update', { id, ...patch });
}

export async function deleteEnrollApproval(id: number): Promise<void> {
  await apiPost('/admin/enrollment-approvals/delete', { id });
}

export type AdminTerm = { id: number; title: string; isCurrent: number };

export async function getConfirmationTerms(): Promise<AdminTerm[]> {
  const res = await apiGet<{ ok: boolean; data: { terms: AdminTerm[] } }>('/admin/enrollment-confirmation?action=terms');
  return res.data.terms;
}

export async function issueEnrollmentConfirmation(studentId: number, termId: number): Promise<{ token: string; verifyUrl: string; expiresAt: string }> {
  const res = await apiGet<{ ok: boolean; data: { token: string; verifyUrl: string; expiresAt: string } }>(
    `/admin/enrollment-confirmation?studentId=${studentId}&termId=${termId}`,
  );
  return res.data;
}
