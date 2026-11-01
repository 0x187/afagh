// ═══ کلاینت پنل ادمین (فاز ۶) ═══
import { apiGet, apiPost } from './api';
import type { FinanceData } from './student-api';

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

// ── مدیریت کلاس‌ها (تنظیمات ادمین) — پورت ClassroomManager ──

export type AdminClassroom = {
  id: number;
  name: string;
  code: string | null;
  capacity: number;
  roomType: string | null;
  facultyId: number | null;
  facultyName: string | null;
  floor: string | null;
  rowsCount: number | null;
  colsCount: number | null;
  isActive: number;
};

export type AdminClassroomsData = {
  classrooms: AdminClassroom[];
  faculties: { id: number; name: string }[];
};

export type AdminClassroomInput = {
  id?: number;
  code: string;
  name: string;
  capacity: number;
  roomType: string;
  facultyId: number | null;
  floor: string;
  rows: number | null;
  cols: number | null;
  isActive: number;
};

export type AdminClassroomResult = { message: string; newId?: number };

export async function getAdminClassrooms(): Promise<AdminClassroomsData> {
  const res = await apiGet<{ ok: boolean; data: AdminClassroomsData }>('/admin/classrooms');
  return res.data;
}

export async function saveAdminClassroom(input: AdminClassroomInput): Promise<AdminClassroomResult> {
  const res = await apiPost<{ ok: boolean; data: AdminClassroomResult }>('/admin/classrooms', input);
  return res.data;
}

export async function deleteAdminClassroom(id: number): Promise<AdminClassroomResult> {
  const res = await apiPost<{ ok: boolean; data: AdminClassroomResult }>('/admin/classrooms/delete', { id });
  return res.data;
}

export async function bulkAdminClassrooms(
  op: 'activate' | 'deactivate' | 'delete',
  ids: number[],
): Promise<AdminClassroomResult> {
  const res = await apiPost<{ ok: boolean; data: AdminClassroomResult }>('/admin/classrooms/bulk', { op, ids });
  return res.data;
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

export type ManualAttendanceData = {
  term: { id: number | null; title: string; termCode: string; isEnrollmentOpen: boolean };
  terms: { id: number; title: string; termCode: string }[];
  rows: {
    sessionId: number;
    sessionNo: number;
    sessionDate: string;
    startTime: string;
    endTime: string;
    isMakeUp: boolean;
    isHoliday: boolean;
    sessionStatus: string;
    courseCode: string;
    courseTitle: string;
    professorName: string;
    method: string | null;
    status: string | null;
    merged: boolean;
    memberCount: number;
    memberSessionIds: number[];
  }[];
};

export async function getManualAttendance(): Promise<ManualAttendanceData> {
  const res = await apiGet<{ ok: boolean; data: ManualAttendanceData }>('/admin/attendance/manual');
  return res.data;
}

export async function confirmAttendance(sessionId: number): Promise<void> {
  await apiPost('/admin/attendance/confirm', { sessionId });
}

export async function setSessionStatus(sessionId: number, status: string): Promise<void> {
  await apiPost('/admin/attendance/status', { sessionId, status });
}

export type ControlData = {
  todayJalali: string;
  rows: {
    roomId: number;
    roomName: string;
    buildingName: string | null;
    sessionId: number;
    startTime: string;
    endTime: string;
    courseTitle: string;
    courseCode: string;
    groupNumber: number;
    professorName: string;
    recorded: boolean;
    recordedAt: string | null;
    merged: boolean;
    memberCount: number;
  }[];
};

export async function getAttendanceControl(): Promise<ControlData> {
  const res = await apiGet<{ ok: boolean; data: ControlData }>('/admin/attendance/control');
  return res.data;
}

export async function recordClassPresence(sessionId: number): Promise<void> {
  await apiPost('/admin/attendance/record', { sessionId });
}

export type FinanceStudentsData = {
  students: {
    studentId: number;
    studentCode: string;
    fullName: string;
    charges: number;
    discounts: number;
    sponsorships: number;
    payments: number;
    chequesCleared: number;
    chequesPending: number;
    loans: number;
    balance: number;
  }[];
  totals: {
    charges: number;
    discounts: number;
    sponsorships: number;
    payments: number;
    chequesCleared: number;
    loans: number;
    balance: number;
    debtorCount: number;
  };
};

export async function getFinanceStudents(params: { q?: string; onlyDebtors?: boolean }): Promise<FinanceStudentsData> {
  const q = new URLSearchParams();
  if (params.q) q.set('q', params.q);
  if (params.onlyDebtors) q.set('debtors', '1');
  const res = await apiGet<{ ok: boolean; data: FinanceStudentsData }>(`/admin/finance?${q.toString()}`);
  return res.data;
}

export type StudentFinanceDetail = {
  finance: FinanceData;
  txns: { id: number; studentId: number; transactionType: string; amount: number; description: string | null; createdAt: string | null }[];
};

export async function getStudentFinanceDetail(id: number): Promise<StudentFinanceDetail> {
  const res = await apiGet<{ ok: boolean; data: StudentFinanceDetail }>(`/admin/finance/student/${id}`);
  return res.data;
}

export async function adjustLedger(input: { studentId: number; transactionType: string; amount: number; description: string }): Promise<void> {
  await apiPost('/admin/finance/adjust', input);
}

export type CourseFinanceRow = {
  id: number;
  code: string;
  title: string;
  units: number | null;
  courseType: string | null;
  legacyMaliType: number | null;
};

export async function getCourseFinance(q?: string): Promise<CourseFinanceRow[]> {
  const qs = q ? `?q=${encodeURIComponent(q)}` : '';
  const res = await apiGet<{ ok: boolean; data: { courses: CourseFinanceRow[] } }>(`/admin/course-finance${qs}`);
  return res.data.courses;
}

export async function setCourseFinanceType(courseId: number, maliType: number): Promise<void> {
  await apiPost('/admin/course-finance', { courseId, maliType });
}

// ─────────────────── تعاریف موتور مالی (rules) ───────────────────

export type FinanceDiscountType = {
  id: number; code: string; title: string; kind: string;
  defaultPercent: number; defaultAmount: number; maxPercent: number | null;
  requiresApproval: boolean; requiresDocument: boolean; isActive: boolean; note: string | null;
};

export type FinanceSponsor = {
  id: number; code: string; title: string; contactInfo: string | null;
  settlementMethod: string; isActive: boolean; note: string | null;
};

export type FinanceFormula = {
  id: number; code: string; title: string; degreeLevelId: number | null; majorId: number | null;
  entryYearFrom: number | null; entryYearTo: number | null;
  fixedAmount: number; perUnitTheory: number; perUnitPractical: number; perUnitGeneral: number;
  priority: number; isActive: boolean; note: string | null;
};

export type FinanceLoanProduct = {
  id: number; code: string; title: string; lender: string; maxAmount: number | null;
  defaultAmount: number; defaultInstallments: number;
  isInterestFree: boolean; requiresApproval: boolean; isActive: boolean; note: string | null;
};

export type FinanceRulesData = {
  discountTypes: FinanceDiscountType[];
  sponsors: FinanceSponsor[];
  formulas: FinanceFormula[];
  degrees: { id: number; title: string }[];
  majors: { id: number; title: string }[];
  loanProducts: FinanceLoanProduct[];
  coefficients: { id: number; termId: number | null; variableCoefficient: number; fixedCoefficient: number; note: string | null; termTitle: string | null; termCode: string | null }[];
  subjectFeeTypes: { id: number; code: string; title: string; kind: string; fixedAmount: number; variablePercent: number; appliesTo: string | null; isActive: boolean; note: string | null }[];
  terms: { id: number; termCode: string; termTitle: string }[];
};

export async function getFinanceRules(): Promise<FinanceRulesData> {
  const res = await apiGet<{ ok: boolean; data: FinanceRulesData }>('/admin/finance/rules');
  return res.data;
}

export async function saveDiscountType(input: Record<string, unknown>): Promise<void> {
  await apiPost<{ ok: boolean }>('/admin/finance/rules/discount-type', input);
}
export async function deleteDiscountType(id: number): Promise<void> {
  await apiPost<{ ok: boolean }>('/admin/finance/rules/discount-type/delete', { id });
}
export async function saveSponsor(input: Record<string, unknown>): Promise<void> {
  await apiPost<{ ok: boolean }>('/admin/finance/rules/sponsor', input);
}
export async function deleteSponsor(id: number): Promise<void> {
  await apiPost<{ ok: boolean }>('/admin/finance/rules/sponsor/delete', { id });
}
export async function saveFormula(input: Record<string, unknown>): Promise<void> {
  await apiPost<{ ok: boolean }>('/admin/finance/rules/formula', input);
}
export async function deleteFormula(id: number): Promise<void> {
  await apiPost<{ ok: boolean }>('/admin/finance/rules/formula/delete', { id });
}
export async function saveLoanProduct(input: Record<string, unknown>): Promise<void> {
  await apiPost<{ ok: boolean }>('/admin/finance/rules/loan-product', input);
}
export async function deleteLoanProduct(id: number): Promise<void> {
  await apiPost<{ ok: boolean }>('/admin/finance/rules/loan-product/delete', { id });
}

// ─────────────────── POS ───────────────────

export type PosTerminal = {
  id: number; code: string; title: string; location: string | null;
  terminalId: string | null; merchantId: string | null; isActive: boolean;
};

export type PosTxn = {
  id: number; stan: string; rrn: string | null; amount: number; txnType: string; entryMode: string;
  status: string; responseCode: string | null; cardPan: string | null; cardholderName: string | null;
  createdAt: string | null; terminalCode: string; terminalTitle: string;
  studentCode: string; studentName: string;
};

export async function getPosTerminals(): Promise<PosTerminal[]> {
  const res = await apiGet<{ ok: boolean; data: { terminals: PosTerminal[] } }>('/admin/pos/terminals');
  return res.data.terminals;
}

export async function getPosTransactions(params: { studentCode?: string; status?: string; limit?: number } = {}): Promise<PosTxn[]> {
  const q = new URLSearchParams();
  if (params.studentCode) q.set('studentCode', params.studentCode);
  if (params.status) q.set('status', params.status);
  q.set('limit', String(params.limit ?? 100));
  const res = await apiGet<{ ok: boolean; data: { transactions: PosTxn[] } }>(`/admin/pos/transactions?${q.toString()}`);
  return res.data.transactions;
}

export async function recordPosSale(input: {
  terminalCode: string; studentCode: string; amount: number; stan: string; rrn?: string;
  authorizationRef: string; entryMode: string; cardPan: string; cardholderName?: string; description?: string;
}): Promise<void> {
  await apiPost<{ ok: boolean }>('/admin/pos/sale', input);
}

export async function voidPosTransaction(terminalCode: string, stan: string, reason: string): Promise<void> {
  await apiPost<{ ok: boolean }>('/admin/pos/void', { terminalCode, stan, reason });
}

// ─────────────────── بایگانی مدارک ───────────────────

export type ArchiveDoc = {
  id: number; fileName: string; mimeType: string | null; status: string; reason: string | null;
  uploadedAt: string | null; student: string; nationalCode: string | null;
  category: string; type: string;
};

export type ArchiveData = {
  rows: ArchiveDoc[];
  categories: { id: number; title: string }[];
  types: { id: number; title: string; categoryId: number | null }[];
};

export async function getArchiveDocuments(): Promise<ArchiveData> {
  const res = await apiGet<{ ok: boolean; data: ArchiveData }>('/admin/archive/documents');
  return res.data;
}

export async function verifyArchiveDoc(docId: number, decision: 'VERIFIED' | 'REJECTED', reason?: string): Promise<void> {
  await apiPost<{ ok: boolean }>('/admin/archive/verify', { docId, decision, reason });
}

export async function uploadArchiveDocument(input: { file: File; studentUserId: number; categoryId: number; typeId?: number }): Promise<number> {
  const fd = new FormData();
  fd.set('file', input.file);
  fd.set('studentUserId', String(input.studentUserId));
  fd.set('categoryId', String(input.categoryId));
  if (input.typeId) fd.set('typeId', String(input.typeId));
  const res = await fetch('/api/v2/admin/archive/upload', { method: 'POST', body: fd, credentials: 'same-origin' });
  const payload = await res.json().catch(() => null) as { ok?: boolean; error?: string; data?: { docId: number } } | null;
  if (!res.ok || !payload?.ok) throw new Error(payload?.error ?? `خطای سرور (${res.status})`);
  return payload.data?.docId ?? 0;
}

export const archiveFileUrl = (docId: number) => `/api/v2/admin/archive/file/${docId}`;

// ─────────────────── ضرایب نیمسال + مبالغ موضوعی (CRUD) ───────────────────

export type FinanceCoefficient = {
  id: number; termId: number | null; variableCoefficient: number; fixedCoefficient: number;
  note: string | null; updatedAt: string | null; termTitle: string | null; termCode: string | null;
};

export async function getFinanceCoefficients(): Promise<FinanceCoefficient[]> {
  const res = await apiGet<{ ok: boolean; data: { rows: FinanceCoefficient[] } }>('/admin/finance/coefficients');
  return res.data.rows;
}

export async function saveFinanceCoefficient(input: { termId: number; variableCoefficient: number; fixedCoefficient: number; note?: string }): Promise<number> {
  const res = await apiPost<{ ok: boolean; data: { id: number } }>('/admin/finance/coefficients', input);
  return res.data.id;
}

export async function deleteFinanceCoefficient(id: number): Promise<void> {
  await apiPost<{ ok: boolean }>('/admin/finance/coefficients/delete', { id });
}

export type FinanceSubjectFeeType = {
  id: number; code: string; title: string; kind: string; fixedAmount: number;
  variablePercent: number; appliesTo: string | null; isActive: boolean; note: string | null;
};

export async function getFinanceSubjectFeeTypes(): Promise<FinanceSubjectFeeType[]> {
  const res = await apiGet<{ ok: boolean; data: { rows: FinanceSubjectFeeType[] } }>('/admin/finance/subject-fees');
  return res.data.rows;
}

export async function saveFinanceSubjectFeeType(input: Record<string, unknown>): Promise<number> {
  const res = await apiPost<{ ok: boolean; data: { id: number } }>('/admin/finance/subject-fees', input);
  return res.data.id;
}

export async function deleteFinanceSubjectFeeType(id: number): Promise<void> {
  await apiPost<{ ok: boolean }>('/admin/finance/subject-fees/delete', { id });
}

export type SubjectFeeAssignment = {
  id: number; studentId: number; termId: number; subjectFeeTypeId: number;
  amount: number; isActive: boolean; note: string | null;
  typeCode: string; typeTitle: string; typeKind: string;
};

export async function getSubjectFeeAssignments(studentId: number, termId?: number): Promise<SubjectFeeAssignment[]> {
  const q = termId ? `&termId=${termId}` : '';
  const res = await apiGet<{ ok: boolean; data: { rows: SubjectFeeAssignment[] } }>(`/admin/finance/subject-fees/assign?studentId=${studentId}${q}`);
  return res.data.rows;
}

export async function assignSubjectFee(input: { studentId: number; termId: number; subjectFeeTypeId: number; amount: number; note?: string }): Promise<number> {
  const res = await apiPost<{ ok: boolean; data: { id: number } }>('/admin/finance/subject-fees/assign', input);
  return res.data.id;
}

export async function deleteSubjectFeeAssignment(id: number): Promise<void> {
  await apiPost<{ ok: boolean }>('/admin/finance/subject-fees/assign/delete', { id });
}

// ─────────────────── کنترل زمانی + فرمول ویژهٔ دانشجو ───────────────────

export type LockState = {
  configured: boolean; locked: boolean; entryAllowed: boolean; reason: string;
  period: { id: number; periodName: string | null; opensAt: string; closesAt: string; isLocked: boolean } | null;
  now: string;
};

export async function getTimeControl(): Promise<LockState> {
  const res = await apiGet<{ ok: boolean; data: LockState }>('/admin/finance/time-control');
  return res.data;
}

export async function saveAccountingPeriod(input: { id?: number; periodName?: string; opensAt: string; closesAt: string; isLocked: boolean }): Promise<LockState> {
  const res = await apiPost<{ ok: boolean; data: LockState }>('/admin/finance/time-control', input);
  return res.data;
}

export type TuitionOverride = {
  id: number; studentId: number; studentCode: string; studentName: string; termId: number | null;
  termTitle: string; fixedAmount: number; perUnitAmount: number; reason: string | null;
  isActive: boolean; createdAt: string | null; updatedAt: string | null;
};

export async function getTuitionOverrides(params: { q?: string; studentId?: number; active?: boolean; page?: number } = {}): Promise<{ rows: TuitionOverride[]; total: number; page: number }> {
  const q = new URLSearchParams();
  if (params.q) q.set('q', params.q);
  if (params.studentId) q.set('studentId', String(params.studentId));
  if (params.active) q.set('active', '1');
  q.set('page', String(params.page ?? 1));
  const res = await apiGet<{ ok: boolean; data: { rows: TuitionOverride[]; total: number; page: number } }>(`/admin/finance/student-formula?${q.toString()}`);
  return res.data;
}

export async function createTuitionOverride(input: { studentId: number; termId?: number | null; fixedAmount: number; perUnitAmount: number; reason?: string | null }): Promise<number> {
  const res = await apiPost<{ ok: boolean; data: { id: number } }>('/admin/finance/student-formula', input);
  return res.data.id;
}

export async function updateTuitionOverride(id: number, patch: Record<string, unknown>): Promise<void> {
  await apiPost<{ ok: boolean }>('/admin/finance/student-formula/update', { id, ...patch });
}

export async function deleteTuitionOverride(id: number): Promise<void> {
  await apiPost<{ ok: boolean }>('/admin/finance/student-formula/delete', { id });
}

// ─────────────────── صندوق رفاه ───────────────────

export type WelfareFund = {
  id: number; code: string; title: string; description: string | null;
  isActive: boolean; loanCount: number; createdAt: string | null;
};

export async function getWelfareFunds(): Promise<WelfareFund[]> {
  const res = await apiGet<{ ok: boolean; data: { funds: WelfareFund[] } }>('/admin/finance/welfare');
  return res.data.funds;
}

export type WelfareLoan = {
  id: number; studentId: number; studentCode: string; studentName: string;
  lender: string | null; loanCode: string | null; amount: number; installments: number | null;
  status: string | null; welfareFundId: number | null; fundTitle: string | null; createdAt: string | null;
};

export async function getWelfareLoans(fundId: number | 'unassigned', page = 1): Promise<{ rows: WelfareLoan[]; total: number; page: number }> {
  const res = await apiGet<{ ok: boolean; data: { rows: WelfareLoan[]; total: number; page: number } }>(`/admin/finance/welfare/loans?fundId=${fundId}&page=${page}`);
  return res.data;
}

export async function createWelfareFund(input: { code: string; title: string; description?: string | null; isActive?: boolean }): Promise<number> {
  const res = await apiPost<{ ok: boolean; data: { id: number } }>('/admin/finance/welfare', input);
  return res.data.id;
}

export async function updateWelfareFund(id: number, input: { code: string; title: string; description?: string | null; isActive?: boolean }): Promise<void> {
  await apiPost<{ ok: boolean }>('/admin/finance/welfare/update', { id, ...input });
}

export async function deleteWelfareFund(id: number): Promise<void> {
  await apiPost<{ ok: boolean }>('/admin/finance/welfare/delete', { id });
}

export async function assignLoanToFund(loanId: number, fundId: number | null): Promise<void> {
  await apiPost<{ ok: boolean }>('/admin/finance/welfare/assign-loan', { loanId, fundId });
}
