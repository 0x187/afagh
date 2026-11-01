// ═══ Courses, curriculum chart, and grade status codes client ═══
import { apiGet, apiPatch, apiPost } from './api';

export type GradeStatusCodeItem = {
  code: string; title: string; passed: boolean;
  affectsGpa: boolean; affectsTermGpa: boolean; isDropped: boolean;
};

export type GradeMajor = { id: number; code: string; name: string };
export type SimpleOption = { id: number; name: string };
export type GradeVersion = {
  id: number; versionCode: string; title: string; status: string;
  majorId: number; entryYearFrom: number | null; entryYearTo: number | null;
};

export type CurriculumCourse = {
  courseId: number; code: string; title: string; units: string | null;
  passGradeStatusCode: string | null; failGradeStatusCode: string | null;
  roleType: string; recommendedSemester: number | null;
};

export type OfferedCourse = {
  id: number; courseId: number; courseCode: string; courseTitle: string;
  units: string | null; roleType: string; recommendedSemester: number | null;
  minGrade: string | null; passGradeStatusCode: string | null; failGradeStatusCode: string | null;
  isRequired: number | null; isElective: number | null;
  versionId: number; versionCode: string; versionTitle: string; status: string;
  majorId: number; majorName: string;
  degreeLevelId: number | null; degreeLevelTitle: string | null;
  entryYearFrom: number | null; entryYearTo: number | null;
};

export type BankCourse = {
  id: number; code: string; title: string;
  theoreticalUnits: string | null; practicalUnits: string | null; units: string;
  courseType: string | null; gradingType: string | null; affectsGpa: number | null;
  departmentId: number | null; departmentName: string | null;
  degreeLevelId: number | null; degreeLevelTitle: string | null;
  clusterId: number | null; clusterTitle: string | null;
  offeringScope: string | null; locationType: string | null;
  courseNature: string | null; englishName: string | null; description: string | null;
  weeklyTheoryHours: string | null; weeklyPracticalHours: string | null;
  isThesis: number | null; hasProject: number | null; internshipUnits: string | null;
  minPassedMark: string | null; defaultAcceptMarkState: string | null; defaultRejectMarkState: string | null;
  courseIsActive: number | null; emergencyWithdrawal: number | null; coRequisites: string | null;
  facesHours: string | null; equivalentCourseCodes: string | null;
};

export type BankPage = { courses: BankCourse[]; total: number; page: number; limit: number };
export type Threshold = { label: string; minValue: string; maxValue: string; passed: boolean };

export async function getGradeStatusCodeOptions(): Promise<GradeStatusCodeItem[]> {
  const res = await apiGet<{ ok: boolean; data: { codes: GradeStatusCodeItem[] } }>('/admin/grade-status-codes');
  return res.data.codes;
}

export async function getGradeMajors(): Promise<GradeMajor[]> {
  const res = await apiGet<{ ok: boolean; data: { majors: GradeMajor[] } }>('/admin/curriculum/majors');
  return res.data.majors;
}

export async function getGradeDepartments(): Promise<SimpleOption[]> {
  const res = await apiGet<{ ok: boolean; data: { departments: SimpleOption[] } }>('/admin/curriculum/departments');
  return res.data.departments;
}

export async function getGradeClusters(): Promise<SimpleOption[]> {
  const res = await apiGet<{ ok: boolean; data: { clusters: SimpleOption[] } }>('/admin/curriculum/clusters');
  return res.data.clusters;
}

export async function getGradeDegreeLevels(): Promise<SimpleOption[]> {
  const res = await apiGet<{ ok: boolean; data: { degreeLevels: SimpleOption[] } }>('/admin/curriculum/degree-levels');
  return res.data.degreeLevels;
}

export async function getGradeVersions(majorId: number): Promise<GradeVersion[]> {
  const res = await apiGet<{ ok: boolean; data: { versions: GradeVersion[] } }>(`/admin/curriculum/versions?majorId=${majorId}`);
  return res.data.versions;
}

export async function getGradeCurriculumCourses(versionId: number): Promise<CurriculumCourse[]> {
  const res = await apiGet<{ ok: boolean; data: { courses: CurriculumCourse[] } }>(`/admin/curriculum/courses?versionId=${versionId}`);
  return res.data.courses;
}

export async function getOfferedCourses(params: { q?: string; majorId?: number | null; degreeLevelId?: number | null; versionId?: number | null }): Promise<OfferedCourse[]> {
  const sp = new URLSearchParams();
  if (params.q) sp.set('q', params.q);
  if (params.majorId) sp.set('majorId', String(params.majorId));
  if (params.degreeLevelId) sp.set('degreeLevelId', String(params.degreeLevelId));
  if (params.versionId) sp.set('versionId', String(params.versionId));
  const res = await apiGet<{ ok: boolean; data: { courses: OfferedCourse[] } }>(`/admin/curriculum/offered?${sp}`);
  return res.data.courses;
}

export async function getBankCourses(q: string, page = 1, limit = 100): Promise<BankPage> {
  const res = await apiGet<{ ok: boolean; data: BankPage }>(
    `/admin/curriculum/bank?q=${encodeURIComponent(q)}&page=${page}&limit=${limit}`,
  );
  return res.data;
}

export async function createBankCourse(payload: Record<string, unknown>): Promise<{ id: number }> {
  const res = await apiPost<{ ok: boolean; data: { id: number } }>('/admin/curriculum/bank', payload);
  return res.data;
}

export async function updateBankCourse(id: number, payload: Record<string, unknown>): Promise<void> {
  await apiPatch(`/admin/curriculum/bank?id=${id}`, payload);
}

export async function updateCurriculumGradeCodes(
  versionId: number, courseId: number, passCode: string | null, failCode: string | null,
): Promise<void> {
  await apiPatch(`/admin/curriculum/grade-codes?versionId=${versionId}&courseId=${courseId}`, {
    passGradeStatusCode: passCode,
    failGradeStatusCode: failCode,
  });
}

export async function getGradeThresholds(degreeLevelId: number): Promise<{ thresholds: Threshold[]; displayMode: string }> {
  const res = await apiGet<{ ok: boolean; data: { thresholds: { label: string; minValue: string; maxValue: string; passed: number }[]; transcriptDisplayMode: string } }>(
    `/admin/grade-thresholds?degreeLevelId=${degreeLevelId}`,
  );
  return {
    thresholds: res.data.thresholds.map((t) => ({ label: t.label, minValue: t.minValue, maxValue: t.maxValue, passed: t.passed === 1 })),
    displayMode: res.data.transcriptDisplayMode || 'NUMERIC',
  };
}

export async function saveGradeThresholds(degreeLevelId: number, displayMode: string, thresholds: Threshold[]): Promise<void> {
  await apiPost('/admin/grade-thresholds', {
    degreeLevelId,
    transcriptDisplayMode: displayMode,
    thresholds: thresholds.map((t) => ({
      label: t.label,
      minValue: Number(t.minValue),
      maxValue: Number(t.maxValue),
      passed: t.passed,
    })),
  });
}
