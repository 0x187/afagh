// ═══ کلاینت انتخاب واحد (فاز ۳) ═══
import { apiGet, apiPost } from './api';

export type EnrollClassSlot = {
  dayOfWeek: number | null;
  dayName: string;
  startTime: string;
  endTime: string;
  room: string;
  building: string;
};

export type EnrollExamSlot = { examDate: string; startTime: string; endTime: string };

export type EnrollOffering = {
  id: number;
  courseId: number;
  code: string;
  title: string;
  units: number;
  capacity: number;
  waitlistCapacity: number;
  enrolled: number;
  group: number;
  professor: string;
  offeringType: string;
  prereq: string | null;
  prereqMet: boolean;
  classSchedules: EnrollClassSlot[];
  examSchedule: EnrollExamSlot | null;
  tuitionFixed: number;
  tuitionVariable: number;
  tuitionPerUnit: number;
  tuitionTotal: number;
};

export type EnrollCartItem = {
  id: number;
  courseId: number;
  code: string;
  title: string;
  units: number;
  group: number;
  classSchedules: EnrollClassSlot[];
  examSchedule: EnrollExamSlot | null;
};

export type EnrollBypassRequest = {
  id: number;
  offeringId: number;
  kind: string;
  status: string;
  courseTitle: string;
};

export type EnrollPageData = {
  student: { id: number; name: string; status: string };
  term: {
    id: number | null;
    title: string;
    termCode: string;
    open: boolean;
    isSummer: boolean;
    addDropEndDate: string | null;
    enrollmentFlag: boolean;
  };
  offerings: EnrollOffering[];
  cart: EnrollCartItem[];
  enrolledOfferingIds: number[];
  cartStartedAt: number | null;
  regulationStatus: {
    effectiveMaxUnits: number;
    minAllowedUnits: number;
    passedUnits: number;
    remainingUnits: number;
    isGraduating: boolean;
    isHonors: boolean;
    isProbatedLastTerm: boolean;
    totalProbations: number;
    isSummer: boolean;
  } | null;
  bypassRequests: EnrollBypassRequest[];
  enrollmentOpen: boolean;
  emergencyWithdrawOpen: boolean;
  degreeLevelTitle: string;
  curriculumScoped: boolean;
  curriculumRequired: boolean;
  curriculumReason: string;
  curriculumVersionLabel: string | null;
  studentTermOrdinal: number | null;
  sajjadPortalUrl: string;
};

export type SubmitResult = {
  ok: boolean;
  registered: string[];
  waitlisted: string[];
  hardErrors: string[];
  softErrors: { offeringId: number; msg: string }[];
  droppedCart: { offeringId: number; title: string; reason: string }[];
};

export type SubmitTick = {
  queued: boolean;
  ticketId: string;
  position: number;
  limited?: boolean;
  direct?: boolean;
  result?: SubmitResult;
  error?: string;
};

export type WrStatus = { state: 'IDLE' | 'WAITING' | 'PROCESSING' | 'DONE'; position?: number; result?: SubmitResult };

export type ExamConflict = { offeringId: number; courseCode: string; title: string; examDate: string; startTime: string; withCourse: string };

export async function getEnrollPage(): Promise<EnrollPageData> {
  const res = await apiGet<{ ok: boolean; data: EnrollPageData }>('/student/enroll');
  return res.data;
}

export async function addToCart(offeringId: number): Promise<void> {
  await apiPost('/student/enroll/cart', { offeringId });
}

export async function removeFromCart(offeringId: number): Promise<void> {
  await apiPost('/student/enroll/cart/remove', { offeringId });
}

export async function clearCart(): Promise<void> {
  await apiPost('/student/enroll/cart/clear');
}

export async function autoFillCart(): Promise<{ ok: boolean; count: number; units: number; message: string; conflictsResolved: number }> {
  const res = await apiPost<{ ok: boolean; data: { ok: boolean; count: number; units: number; message: string; conflictsResolved: number } }>(
    '/student/enroll/auto-fill',
  );
  return res.data;
}

export async function submitCart(acceptSameDayRisk = false): Promise<SubmitTick> {
  return apiPost<SubmitTick>('/student/enroll/submit', { acceptSameDayRisk });
}

export async function getEnrollStatus(): Promise<WrStatus> {
  const res = await apiGet<{ ok: boolean; data: WrStatus }>('/student/enroll/status');
  return res.data;
}

export async function previewExamConflicts(): Promise<{ ok: boolean; hard: ExamConflict[]; soft: ExamConflict[] }> {
  return apiGet('/student/enroll/preview-exam-conflicts');
}

export async function referCouncil(offeringId: number, reason?: string): Promise<void> {
  await apiPost('/student/enroll/refer-council', { offeringId, reason: reason ?? '' });
}

export async function requestBypass(offeringId: number, kind: 'PREREQ' | 'EXAM_CONFLICT'): Promise<void> {
  await apiPost('/student/enroll/bypass', { offeringId, kind });
}

export async function cancelBypass(requestId: number): Promise<void> {
  await apiPost('/student/enroll/bypass/cancel', { requestId });
}

export type LiveCapacity = Record<string, { cap: number; enrolled: number; remaining: number }>;

export async function getLiveCapacity(ids: number[]): Promise<LiveCapacity> {
  if (!ids.length) return {};
  return apiGet(`/student/enroll/live-capacity?ids=${ids.join(',')}`);
}
