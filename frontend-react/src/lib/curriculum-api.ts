// ═══ کلاینت سرفصل/برنامهٔ درسی ═══
import { apiGet, apiPost } from './api';

export type CurriculumVersion = {
  id: number; majorId: number; degreeLevelId: number; trackId: number | null;
  versionCode: string; title: string; status: string;
  entryYearFrom: number; entryYearTo: number | null;
  totalRequiredUnits: string; maxUnitsPerTerm: number | null; courseCount: number;
};

export type CurriculumOverview = {
  majors: { id: number; code: string | null; name: string; degreeLevelId: number; degreeTitle: string | null }[];
  versions: CurriculumVersion[];
  tracks: { id: number; title: string | null; majorId: number }[];
};

export type CurriculumCheck = { check: string; severity: 'ERROR' | 'WARN'; message: string; affected: string[] };

export type CurriculumDetail = {
  version: CurriculumVersion;
  courses: {
    courseId: number; code: string; title: string; units: number; roleType: string;
    isRequired: number; isElective: number; isGraduationRequired: number;
    recommendedSemester: number | null; minGrade: number | null;
    passGradeStatusCode: string | null; failGradeStatusCode: string | null;
  }[];
  rules: { courseId: number; ruleType: string; logicTree: { operator: string; conditions: { course?: string; minGrade?: number; unitsPassed?: number }[] } }[];
  approvals: { id: number; approvalType: string | null; fromStatus: string | null; toStatus: string | null; decisionNote: string | null; approvedAt: string | null; approvedBy: string | null }[];
  checks: CurriculumCheck[];
  blocked: boolean;
};

export const getCurriculumOverview = () => apiGet<{ ok: boolean; data: CurriculumOverview }>('/admin/curriculum/overview').then((r) => r.data);
export const getCurriculumDetail = (id: number) => apiGet<{ ok: boolean; data: CurriculumDetail }>(`/admin/curriculum/versions/${id}`).then((r) => r.data);
export const createCurriculumVersion = (input: Record<string, unknown>) =>
  apiPost<{ ok: boolean; data: { id: number; message: string } }>('/admin/curriculum/versions', input).then((r) => r.data);
export const updateCurriculumMeta = (id: number, patch: Record<string, unknown>) =>
  apiPost<{ ok: boolean; data: { message: string } }>(`/admin/curriculum/versions/${id}/meta`, patch).then((r) => r.data);
export const curriculumAction = (id: number, action: string, note = '') =>
  apiPost<{ ok: boolean; data?: { message?: string }; error?: string }>(`/admin/curriculum/versions/${id}/${action}`, { note });
export const addCurriculumCourse = (id: number, item: Record<string, unknown>) =>
  apiPost<{ ok: boolean; data: { message: string } }>(`/admin/curriculum/versions/${id}/courses/add`, item).then((r) => r.data);
export const removeCurriculumCourse = (id: number, courseId: number) =>
  apiPost<{ ok: boolean; data: { message: string } }>(`/admin/curriculum/versions/${id}/courses/remove`, { courseId }).then((r) => r.data);
export const updateCurriculumCourse = (id: number, courseId: number, patch: Record<string, unknown>) =>
  apiPost<{ ok: boolean; data: { message: string } }>(`/admin/curriculum/versions/${id}/courses/update`, { courseId, patch }).then((r) => r.data);
export const assignCurriculumSemester = (id: number, courseId: number, semesterNo: number | null) =>
  apiPost<{ ok: boolean; data: { message: string } }>(`/admin/curriculum/versions/${id}/courses/semester`, { courseId, semesterNo, hasSemester: semesterNo != null }).then((r) => r.data);
export const setCurriculumRule = (id: number, kind: 'prereq' | 'coreq', courseId: number, tree: unknown | null, hasTree: boolean) =>
  apiPost<{ ok: boolean; data: { message: string } }>(`/admin/curriculum/versions/${id}/rules/${kind}`, { courseId, tree, hasTree }).then((r) => r.data);
export const markCurriculumGrad = (id: number) =>
  apiPost<{ ok: boolean; data: { message: string; updated: number; total: number } }>(`/admin/curriculum/versions/${id}/courses/mark-grad`, {}).then((r) => r.data);
export const syncCurriculumRoles = (id: number) =>
  apiPost<{ ok: boolean; data: { message: string; updated: number } }>(`/admin/curriculum/versions/${id}/courses/sync-roles`, {}).then((r) => r.data);
