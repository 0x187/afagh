// ═══ Typed client for the comprehensive student dossier manager ═══
//
// One-to-one with the Go endpoints registered in AdminAPI.RegisterStudentsDossier
// (backend-go/internal/httpapi/admin_students_dossier.go) — the port of
// afagh-next/src/app/admin/students actions.ts + page.tsx + grade actions.
//
// All calls are same-origin /api/v2 with the session cookie; errors carry
// ready-to-display Persian messages (ApiError).

import { apiGet, apiPost } from './api';

// ── Contracts (types.ts port) ──

export type StudentItem = {
  id: number;
  studentCode: string;
  nationalCode: string;
  firstName: string;
  lastName: string;
  mobile: string;
  entryYear: number;
  entryTerm: number;
  entryDate?: string | null;
  status: string;
  samaStatusCode?: string | null;
  quotaType: string;
  currentTermNo: number;
  majorName: string;
  majorCode: string;
  facultyName?: string;
  degreeLevel: string;
  degreeLevelId: number;
  degreeCode: string;
  regulationTitle: string;
  fatherName?: string;
  birthCertNo?: string;
  birthDate?: string | null;
  gender?: string | null;
  isActive?: number | null;
  userId?: number | null;
  placeOfBirth?: string;
  placeOfIssue?: string;
  nationality?: string | null;
  photoKey?: string | null;
  acceptanceType?: string | null;
  acceptanceAllocation?: string | null;
  studyingMode?: string | null;
  trainingMethod?: string | null;
  graduateDate?: string | null;
  graduateDegreeLevelId?: number | null;
  regulationId?: number | null;
  firstNameEn?: string | null;
  lastNameEn?: string | null;
  passportNumber?: string | null;
  role: string;
  // ── Sama supplementary dossier ──
  advisorCode?: string | null;
  documentStatus?: string | null;
  scholarshipType?: string | null;
  militaryStatus?: string | null;
  militaryExemptionNo?: string | null;
  homeTell?: string | null;
  studentCardStatus?: string | null;
  archiveNo?: string | null;
  parvandehNo?: string | null;
  dormName?: string | null;
  dormRoom?: string | null;
  hasDorm?: number | null;
  guardianJobTitle?: string | null;
  guardianPhone?: string | null;
  guardianAddress?: string | null;
  guardianEmail?: string | null;
  diplomaType?: string | null;
  diplomaPlace?: string | null;
  diplomaYear?: string | null;
  diplomaGrade?: string | null;
  pishdPlace?: string | null;
  pishdYear?: string | null;
  pishdGrade?: string | null;
  tuitionType?: string | null;
  tuitionPayer?: number | null;
  englishExamType?: string | null;
  englishScore?: string | null;
  insertDate?: string | null;
  insertTime?: string | null;
  certIssued3m?: number | null;
  documentDeficiency?: string | null;
  unitsRemaining?: number | null;
  eqSemesters?: number | null;
  email?: string | null;
  postalCode?: string | null;
  address?: string | null;
  universityId?: number | null;
  senderUniversityCode?: string | null;
};

export type StaffItem = {
  id: number;
  staffCode: string;
  nationalCode: string;
  firstName: string;
  lastName: string;
  mobile: string;
  academicRank: string;
  degree: string;
  staffType: string;
  role: string;
  departmentName?: string;
  departmentCode?: string | null;
  facultyName?: string;
  facultyCode?: string | null;
  fieldOfStudy?: string | null;
  fieldMain?: string | null;
  lastDegreeUniversity?: string | null;
  lastDegreeCountryCode?: string | null;
  personnelNo?: string | null;
  hireDate?: string | null;
  bankAccountNo?: string | null;
  cooperationType?: string | null;
  birthDate?: string | null;
  phone?: string | null;
  address?: string | null;
  email?: string | null;
  maritalStatus?: string | null;
  academicBase?: string | null;
  isActive?: number | null;
  userId?: number | null;
  userIsActive?: number | null;
  photoKey?: string | null;
};

export type RegulationPick = { id: number; title: string; degreeLevelId: number };

export type DossierPagination = {
  total: number;
  page: number;
  per: number;
  totalPages: number;
  q: string;
  status: string;
  degree: number;
  sort?: string;
  f_code?: string;
  f_name?: string;
  f_nc?: string;
  f_major?: string;
  f_year?: string;
};

export type StatusCount = { status: string; n: number };

export type DossierListResponse = {
  total: number;
  page: number;
  per: number;
  totalPages: number;
  q: string;
  status: string;
  degree: number;
  sort: string;
  f_code: string;
  f_name: string;
  f_major: string;
  f_year: string;
  rows: StudentItem[];
  statusCounts: StatusCount[];
};

export type PickRow = { id: number; title: string };
export type GeoPlace = { title: string; ministryCode: string | null };
export type CodeLabels = {
  accept: Record<string, string>;
  acceptByTarget: Record<string, string>;
  period: Record<string, string>;
  quota: Record<string, string>;
};
export type RoleRow = { id: number; code: string; title: string; isSystem: number | boolean | null };
export type UniversityPick = { id: number; code: string; title: string; kind: string; saminCode?: string | null };

export type DossierMeta = {
  degrees: PickRow[];
  regulations: RegulationPick[];
  geoPlaces: GeoPlace[];
  codeLabels: CodeLabels;
  universities: UniversityPick[];
  rolesAll: RoleRow[];
  statusCounts: StatusCount[];
  currentUniversityCode: string;
  currentUniversityId: number | null;
  logoUrl: string;
  canEditGrades: boolean;
};

export type TermStateRow = { termCode: string; statusTitle: string | null; probation: boolean | null };

export type GradeAuditRow = {
  id: number;
  enrollmentId: number;
  offeringId: number;
  action: string;
  oldGradeValue: string | null;
  newGradeValue: string | null;
  oldGradeStatus: string | null;
  newGradeStatus: string | null;
  oldSamaStatusCode: string | null;
  newSamaStatusCode: string | null;
  reason: string | null;
  actorUserId: number | null;
  actorRole: string | null;
  createdAt: string | null;
  actorName: string;
  courseCode: string | null;
  courseTitle: string | null;
  termCode: string | null;
  termTitle: string | null;
};

export type StudentDossier = {
  student: StudentItem;
  termStates: TermStateRow[];
  gradeActivity: GradeAuditRow[];
  enrollmentCount: number;
  finalizedCount: number;
  documentStatus: string | null;
  documentDeficiency: string | null;
  archiveNo: string | null;
  parvandehNo: string | null;
};

export type TranscriptRow = {
  enrollmentId?: number | null;
  offeringId?: number | null;
  termCode: string;
  termTitle: string | null;
  courseCode: string;
  courseTitle: string;
  units: string | null;
  courseType: string | null;
  gradeValue: string | null;
  gradeStatus: string;
  gradeStatusTitle: string | null;
  gradeStatusCode: string | null;
  offeringType: string | null;
  termStatusTitle: string | null;
  termProbation: boolean | null;
  _excludedByRegulation?: string;
};

/** Minimal RegulationConfig shape consumed by the transcript core (regThresholds). */
export type RegulationConfig = {
  grading_and_gpa?: {
    default_passing_grade?: number;
    retakeMinGrade?: number;
    failed_course_gpa_policy?: string;
    regulationLabel?: string;
    dedupeRepeatedCourses?: boolean;
  };
  probation_and_tenure?: { probation_gpa_threshold?: number };
  regular_term_rules?: { min_units?: number };
  levels?: {
    LONG?: { min_units?: number };
    SHORT?: { min_units?: number };
  };
};

export type TranscriptRegulation = { title: string | null; config: RegulationConfig | null };

export type CohortStats = {
  scope: 'year' | 'term';
  rank: number | null;
  total: number;
  avgGpa: number | null;
  avgPassed: number | null;
};

export type StaffBundle = {
  ok: boolean;
  staffList?: StaffItem[];
  userRoleIds?: Record<number, number[]>;
  total?: number;
  error?: string;
};

export type StudentProfilePatch = Record<string, string | number | null>;
export type StaffProfilePatch = Record<string, string | number | null>;

export type BulkScope = 'student' | 'professor';
export type BulkPasswordRow = { nationalCode: string; password: string };

export type TranscriptVerifyQr = { url: string; qr?: string; expiresAt: string | null };

// ── Read endpoints ──

export function getDossierList(params: {
  q?: string;
  status?: string;
  degree?: number;
  page?: number;
  sort?: string;
  f_code?: string;
  f_name?: string;
  f_major?: string;
  f_year?: string;
  /** National-code column filter — kept out of the SPA URL (privacy). */
  f_nc?: string;
}): Promise<DossierListResponse> {
  const p = new URLSearchParams();
  if (params.q) p.set('q', params.q);
  if (params.status && params.status !== 'ALL') p.set('status', params.status);
  if (params.degree) p.set('degree', String(params.degree));
  if (params.page && params.page > 1) p.set('page', String(params.page));
  if (params.sort) p.set('sort', params.sort);
  if (params.f_code) p.set('f_code', params.f_code);
  if (params.f_name) p.set('f_name', params.f_name);
  if (params.f_major) p.set('f_major', params.f_major);
  if (params.f_year) p.set('f_year', params.f_year);
  if (params.f_nc) p.set('f_nc', params.f_nc);
  const qs = p.toString();
  return apiGet<{ ok: boolean; data: DossierListResponse }>(`/admin/students/dossier/list${qs ? `?${qs}` : ''}`)
    .then((r) => r.data);
}

export function getDossierMeta(): Promise<DossierMeta> {
  return apiGet<{ ok: boolean; data: DossierMeta }>('/admin/students/dossier/meta').then((r) => r.data);
}

export function getStudentDossier(studentId: number): Promise<StudentDossier> {
  return apiGet<{ ok: boolean; data: StudentDossier }>(`/admin/students/dossier/student/${studentId}`).then((r) => r.data);
}

export function getDossierTranscript(studentId: number): Promise<TranscriptRow[]> {
  return apiGet<{ ok: boolean; rows: TranscriptRow[] }>(`/admin/students/dossier/transcript?studentId=${studentId}`)
    .then((r) => r.rows ?? []);
}

export function getDossierTranscriptRegulation(studentId: number): Promise<TranscriptRegulation | null> {
  return apiGet<{ ok: boolean; data: TranscriptRegulation | null }>(`/admin/students/dossier/transcript-regulation?studentId=${studentId}`)
    .then((r) => r.data)
    .catch(() => null);
}

export function getDossierCohortStats(studentId: number, scope: 'year' | 'term'): Promise<CohortStats | null> {
  return apiGet<{ ok: boolean; data: CohortStats | null }>(`/admin/students/dossier/cohort-stats?studentId=${studentId}&scope=${scope}`)
    .then((r) => r.data)
    .catch(() => null);
}

export function getDossierTranscriptQR(studentId: number): Promise<TranscriptVerifyQr | null> {
  return apiGet<TranscriptVerifyQr & { ok?: boolean }>(`/admin/students/dossier/transcript-qr?studentId=${studentId}`)
    .then((d) => (d && d.url ? { url: d.url, qr: d.qr, expiresAt: d.expiresAt ?? null } : null))
    .catch(() => null);
}

export function loadStaffList(q?: string): Promise<StaffBundle> {
  const p = q ? `?q=${encodeURIComponent(q)}` : '';
  return apiGet<StaffBundle>(`/admin/students/dossier/staff${p}`);
}

export function getGradeAuditLog(studentId: number): Promise<GradeAuditRow[]> {
  return apiGet<{ ok: boolean; rows: GradeAuditRow[] }>(`/admin/students/dossier/grade-audit?studentId=${studentId}`)
    .then((r) => r.rows ?? []);
}

export function resolveSamaCodeForGrade(
  studentId: number,
  offeringId: number,
  gradeValue: number | null,
): Promise<{ code: string | null; title: string }> {
  const g = gradeValue == null ? '' : String(gradeValue);
  return apiGet<{ ok: boolean; code: string | null; title: string }>(
    `/admin/students/dossier/resolve-sama-code?studentId=${studentId}&offeringId=${offeringId}&gradeValue=${encodeURIComponent(g)}`,
  ).catch(() => ({ ok: false, code: null, title: 'خطا در محاسبه' }));
}

// ── Write endpoints ──

export type AdminSetGradeInput = {
  enrollmentId?: number | null;
  offeringId?: number | null;
  studentId: number;
  studentCode: string;
  termCode?: string | null;
  courseCode?: string | null;
  gradeValue: number | null;
  customSamaStatusCode?: string | null;
  reason: string;
};

export type AdminSetGradeResult = { ok: boolean; message?: string; error?: string };

export function setDossierGrade(input: AdminSetGradeInput): Promise<AdminSetGradeResult> {
  return apiPost<AdminSetGradeResult>('/admin/students/dossier/grade', input);
}

export function setStudentRegulation(
  studentId: number,
  regulationId: number,
): Promise<{ ok: boolean; scanned?: number; updated?: number; error?: string }> {
  return apiPost<{ ok: boolean; scanned?: number; updated?: number; error?: string }>(
    '/admin/students/dossier/regulation',
    { studentId, regulationId },
  );
}

export function updateStudentProfile(
  studentId: number,
  patch: StudentProfilePatch,
): Promise<{ ok: boolean; error?: string }> {
  return apiPost<{ ok: boolean; error?: string }>('/admin/students/dossier/profile', { studentId, patch });
}

export function updateStaffProfile(
  staffId: number,
  patch: StaffProfilePatch,
): Promise<{ ok: boolean; error?: string }> {
  return apiPost<{ ok: boolean; error?: string }>('/admin/students/dossier/staff-profile', { staffId, patch });
}

export function setUserActive(userId: number, active: boolean): Promise<{ ok: boolean; error?: string }> {
  return apiPost<{ ok: boolean; error?: string }>('/admin/students/dossier/user-active', { userId, active });
}

export function resetUserPassword(userId: number, password: string): Promise<{ ok: boolean; error?: string }> {
  return apiPost<{ ok: boolean; error?: string }>('/admin/students/dossier/reset-password', { userId, password });
}

export function bulkResetRandomPasswords(scope: BulkScope): Promise<{ ok: boolean; count?: number; passwords?: BulkPasswordRow[]; error?: string }> {
  return apiPost<{ ok: boolean; count?: number; passwords?: BulkPasswordRow[]; error?: string }>(
    '/admin/students/dossier/bulk-reset-random',
    { scope },
  );
}

export function bulkResetPasswords(scope: BulkScope, password: string): Promise<{ ok: boolean; count?: number; error?: string }> {
  return apiPost<{ ok: boolean; count?: number; error?: string }>('/admin/students/dossier/bulk-reset-password', { scope, password });
}

export function bulkForcePasswordChange(scope: BulkScope): Promise<{ ok: boolean; count?: number; error?: string }> {
  return apiPost<{ ok: boolean; count?: number; error?: string }>('/admin/students/dossier/bulk-force-change', { scope });
}

export function backfillRoles(): Promise<{ ok: boolean; inserted?: number; error?: string }> {
  return apiPost<{ ok: boolean; inserted?: number; error?: string }>('/admin/students/dossier/backfill-roles');
}

export type CreateStaffInput = {
  nationalCode: string;
  firstName: string;
  lastName: string;
  fatherName?: string;
  birthCertNo?: string;
  gender?: string;
  mobile?: string;
  email?: string;
  staffCode?: string;
  staffType?: string;
};

export function createStaffExpert(input: CreateStaffInput): Promise<{ ok: boolean; userId?: number; error?: string }> {
  return apiPost<{ ok: boolean; userId?: number; error?: string }>('/admin/students/dossier/create-staff', input);
}

export function saveUserRoles(userId: number, roleIds: number[]): Promise<{ ok: boolean; added?: number; removed?: number; error?: string }> {
  return apiPost<{ ok: boolean; added?: number; removed?: number; error?: string }>(
    '/admin/students/dossier/save-roles',
    { userId, roleIds },
  );
}

// ── Two-step verification (shared with the step-up API — grades:edit) ──

export function requestStepUp(scope: string, password: string): Promise<{ ok: boolean; error?: string }> {
  return apiPost<{ ok: boolean; error?: string }>('/step-up/request', { scope, password });
}
