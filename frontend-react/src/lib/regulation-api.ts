// ═══ کلاینت پایش طرح درس و بررسی آیین‌نامه ═══
import { apiGet, apiPost } from './api';

export type LessonPlanRow = {
  offeringId: number; courseTitle: string; professorName: string; status: string;
  sessionsCount: number; weightsSum: number; updatedAt: string | null;
};

export type LessonPlansData = {
  rows: LessonPlanRow[]; required: boolean; notice: string | null; universityTitle: string;
};

export type SamaMismatchRow = {
  enrollmentId: number; studentId: number; studentCode: string; studentName: string;
  courseCode: string; courseTitle: string; termCode: string; gradeValue: number | null;
  currentCode: string | null; correctCode: string | null; correctTitle: string;
  originalCode: string | null; regulationTitle: string | null;
};

export type SamaScanResult = { rows: SamaMismatchRow[]; scanned: number; truncated: boolean };

export type StatusMismatchRow = {
  studentId: number; studentCode: string; studentName: string;
  graduateDate: string | null; regulationTitle: string | null;
};

export async function getLessonPlans(): Promise<LessonPlansData> {
  const res = await apiGet<{ ok: boolean; data: LessonPlansData }>('/admin/lesson-plans');
  return res.data;
}

export async function saveLessonPlanSettings(input: { isRequired: boolean; notice: string }): Promise<void> {
  await apiPost('/admin/lesson-plans/settings', input);
}

export async function scanSamaMismatches(): Promise<SamaScanResult> {
  const res = await apiPost<{ ok: boolean; data: SamaScanResult }>('/admin/regulation-check/scan', {});
  return res.data;
}

export async function applySamaFixes(enrollmentIds: number[]): Promise<{ applied: number }> {
  const res = await apiPost<{ ok: boolean; data: { applied: number } }>('/admin/regulation-check/apply', { enrollmentIds });
  return res.data;
}

export async function scanGraduatedWithoutGrades(limit = 200): Promise<{ rows: StatusMismatchRow[]; total: number }> {
  const res = await apiPost<{ ok: boolean; data: { rows: StatusMismatchRow[]; total: number } }>(
    '/admin/regulation-check/status-scan', { limit },
  );
  return res.data;
}

/** درخواست توکن تأیید دومرحله‌ای برای یک دامنه (مثلاً grades:edit). */
export async function requestStepUp(scope: string, password: string): Promise<void> {
  await apiPost('/step-up/request', { scope, password });
}

export async function getStepUpStatus(scope: string): Promise<boolean> {
  const res = await apiGet<{ ok: boolean; data: { scope: string; valid: boolean } }>(
    `/step-up/status?scope=${encodeURIComponent(scope)}`,
  );
  return res.data.valid;
}
