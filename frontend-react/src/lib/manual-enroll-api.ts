// ═══ کلاینت ثبت‌نام دستی کارشناس ═══
import { apiGet, apiPost } from './api';

export type ManualStudentHit = { studentId: number; studentCode: string; name: string; entryYear: number | null };

export type ManualOffering = {
  offeringId: number; code: string; title: string; groupNumber: number;
  units: number | null; capacity: number; enrolledCount: number; professorName: string;
};

export type CatalogOffering = ManualOffering & {
  courseId: number; offered: boolean; alreadyEnrolled: boolean;
  enrollmentId: number | null; enrollmentStatus: string | null;
  prereq: string | null; prereqMissing: string | null; conflicts: string[]; scope: 'chart' | 'common' | 'other';
};

export type CatalogEnrollment = {
  enrollmentId: number; offeringId: number; courseId: number; code: string; title: string;
  groupNumber: number; units: number | null; status: string; professorName: string;
  registeredAt: string | null; override: boolean;
};

export type CatalogChart = {
  versionCode: string | null; title: string | null; chartCount: number; commonCount: number;
  otherCount: number; message?: string; effectiveMaxUnits: number | null; currentUnits: number;
};

export type CatalogResult = {
  items: CatalogOffering[]; enrolled: CatalogEnrollment[]; chart: CatalogChart;
  chartOfferedCount: number; chartTotalCount: number;
};

export type StudentWarning = { code: string; level: 'block' | 'warn'; title: string; detail: string };

export type BulkFilter = {
  termId: number; entryYear?: number | null; entryTerm?: number | null;
  majorId?: number | null; departmentId?: number | null; facultyId?: number | null;
  studentIds?: number[] | null;
};

export type ManualHistoryRow = {
  id: number; studentCode: string; studentName: string; courseCode: string; courseTitle: string;
  groupNumber: number; termTitle: string; who: string; when: string | null; override: boolean; reason: string | null;
};

export async function searchManualStudents(q: string): Promise<ManualStudentHit[]> {
  const res = await apiGet<{ ok: boolean; data: { items: ManualStudentHit[] } }>(`/admin/manual-enroll/students?q=${encodeURIComponent(q)}`);
  return res.data.items;
}

export async function listManualOfferings(termId: number): Promise<ManualOffering[]> {
  const res = await apiGet<{ ok: boolean; data: { items: ManualOffering[] } }>(`/admin/manual-enroll/offerings?termId=${termId}`);
  return res.data.items;
}

export async function getStudentCatalog(studentId: number, termId: number, q = ''): Promise<CatalogResult> {
  const res = await apiGet<{ ok: boolean; data: CatalogResult }>(`/admin/manual-enroll/catalog?studentId=${studentId}&termId=${termId}&q=${encodeURIComponent(q)}`);
  return res.data;
}

export async function getManualWarnings(studentId: number, termId: number): Promise<StudentWarning[]> {
  const res = await apiGet<{ ok: boolean; data: { items: StudentWarning[] } }>(`/admin/manual-enroll/warnings?studentId=${studentId}&termId=${termId}`);
  return res.data.items;
}

export async function manualEnroll(input: { studentId: number; offeringId: number; override: boolean; reason: string }): Promise<number> {
  const res = await apiPost<{ ok: boolean; data: { enrollmentId: number } }>('/admin/manual-enroll', input);
  return res.data.enrollmentId;
}

export async function dropManualEnrollment(enrollmentId: number, reason: string): Promise<void> {
  await apiPost('/admin/manual-enroll/drop', { enrollmentId, reason });
}

export async function countBulkStudents(filter: BulkFilter): Promise<number> {
  const res = await apiPost<{ ok: boolean; data: { count: number } }>('/admin/manual-enroll/bulk-count', { filter });
  return res.data.count;
}

export async function bulkEnroll(filter: BulkFilter, offeringIds: number[], override: boolean, reason: string): Promise<{ inserted: number; skipped: number; total: number }> {
  const res = await apiPost<{ ok: boolean; data: { inserted: number; skipped: number; total: number } }>('/admin/manual-enroll/bulk-enroll', { filter, offeringIds, override, reason });
  return res.data;
}

export async function bulkDrop(filter: BulkFilter, offeringIds: number[], reason: string): Promise<{ dropped: number; skipped: number; total: number }> {
  const res = await apiPost<{ ok: boolean; data: { dropped: number; skipped: number; total: number } }>('/admin/manual-enroll/bulk-drop', { filter, offeringIds, reason });
  return res.data;
}

export async function activateTermForFilter(filter: BulkFilter, active: boolean): Promise<number> {
  const res = await apiPost<{ ok: boolean; data: { updated: number } }>('/admin/manual-enroll/activate-term', { filter, active });
  return res.data.updated;
}

export async function manualEnrollHistory(limit = 50): Promise<ManualHistoryRow[]> {
  const res = await apiGet<{ ok: boolean; data: { items: ManualHistoryRow[] } }>(`/admin/manual-enroll/history?limit=${limit}`);
  return res.data.items;
}
