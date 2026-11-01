// ═══ Client for the six remaining admin pages — broadcast message, bypass, class sessions,
// exam delivery chain, offering editor, schedule conflict resolution ═══
import { apiGet, apiPost } from './api';

// ── Shared types ──

export type LPIdName = { id: number; name: string };
export type LPTerm = { id: number; title: string; isCurrent: number };

// ── 1) Broadcast message ──

export type LPDepartment = LPIdName & { facultyId: number };
export type LPMajor = LPIdName & { departmentId: number | null };
export type BroadcastFilters = {
  faculties: LPIdName[];
  departments: LPDepartment[];
  majors: LPMajor[];
  entryYears: number[];
  terms: LPTerm[];
};
export type BroadcastAudience = {
  role: 'student' | 'staff' | 'both';
  facultyId: number | null;
  departmentId: number | null;
  majorId: number | null;
  entryYear: number | null;
  termId: number | null;
  offeringId: number | null;
  activeOnly: boolean;
};
export type BroadcastTermOffering = { id: number; label: string; enrolled: number };
export type ChannelStat = { channel: string; sent: number; skipped: number; failed: number };
export type BroadcastReport = {
  total: number; inbox: number; failedRequests: number; channels: ChannelStat[];
};
export type BroadcastRecord = {
  eventCode: string; sender: string; sentAt: string | null; body: string;
  total: number; inbox: number; channels: ChannelStat[];
};
export type BroadcastChannel = 'INAPP' | 'SMS' | 'SOROUSH' | 'BALE' | 'EITAA';

export const getBroadcastFilters = () =>
  apiGet<{ ok: boolean; data: BroadcastFilters }>('/admin/broadcast/filters').then((r) => r.data);
export const getBroadcastOfferings = (termId: number) =>
  apiGet<{ ok: boolean; data: { offerings: BroadcastTermOffering[] } }>(`/admin/broadcast/offerings?termId=${termId}`)
    .then((r) => r.data.offerings);
export const previewBroadcastCount = (audience: BroadcastAudience) =>
  apiPost<{ ok: boolean; data: { count: number; capped: boolean } }>('/admin/broadcast/preview', { audience })
    .then((r) => r.data);
export const sendBroadcast = (audience: BroadcastAudience, channels: BroadcastChannel[], text: string) =>
  apiPost<{ ok: boolean; data: BroadcastReport }>('/admin/broadcast/send', { audience, channels, text })
    .then((r) => r.data);
export const getBroadcastHistory = () =>
  apiGet<{ ok: boolean; data: { records: BroadcastRecord[] } }>('/admin/broadcast/history?limit=20')
    .then((r) => r.data.records);

// ── 2) Group manager bypass approval ──

export type BypassRequestRow = {
  id: number; studentId: number; offeringId: number; kind: string; status: string;
  reasonCode: string | null; reasonText: string | null;
  managerDeadlineAt: string | null; expertDeadlineAt: string | null;
  decidedRole: string | null; decidedAt: string | null; createdAt: string | null;
  courseTitle: string; courseCode: string; units: number;
  studentName: string; studentCode: string; majorName: string | null;
};
export type BypassTermRow = {
  id: number; title: string; termCode: string;
  bypassManagerHours: number | null; bypassExpertHours: number | null; bypassReminderHours: number | null;
};
export type BypassBoard = {
  expertRows: BypassRequestRow[]; viceRows: BypassRequestRow[];
  isVice: boolean; isExpert: boolean; isAdmin: boolean; currentTerms: BypassTermRow[];
};
export const getBypassBoard = () =>
  apiGet<{ ok: boolean; data: BypassBoard }>('/admin/bypass/board').then((r) => r.data);
export const bypassApprove = (requestId: number) => apiPost('/admin/bypass/approve', { requestId });
export const bypassReject = (requestId: number, reasonCode: string, reasonText?: string) =>
  apiPost('/admin/bypass/reject', { requestId, reasonCode, reasonText: reasonText ?? '' });
export const bypassReturn = (requestId: number, target: 'MANAGER' | 'EXPERT') =>
  apiPost('/admin/bypass/return', { requestId, target });
export const bypassSaveSettings = (input: {
  termId: number; bypassManagerHours: number; bypassExpertHours: number; bypassReminderHours: number;
}) => apiPost('/admin/bypass/settings', input);

// ── 3) Class session management ──

export type ClassSessionOffering = {
  id: number; code: string; title: string; groupNumber: number;
  professorName: string | null; staffCode: string | null;
  sessionCount: number; holidayCount: number;
};
export type ClassSessionItem = {
  id: number; sessionNo: number | null; sessionDate: string; startTime: string; endTime: string;
  status: string; isMakeUp: number | null; isHoliday: number; isExtraSession: number; isActive: number;
  createdAt: string | null; professorViewedAt: string | null; updatedAt: string | null;
  roomName: string | null; topic: string | null;
};
export type ClassSessionsBoard = {
  terms: LPTerm[]; termId: number; termCode: string; termTitle: string;
  offerings: ClassSessionOffering[]; selectedOfferingId: number; sessions: ClassSessionItem[];
};
export const getClassSessionsBoard = (params: { termId?: number; offeringId?: number; q?: string }) => {
  const sp = new URLSearchParams();
  if (params.termId) sp.set('termId', String(params.termId));
  if (params.offeringId) sp.set('offeringId', String(params.offeringId));
  if (params.q) sp.set('q', params.q);
  return apiGet<{ ok: boolean; data: ClassSessionsBoard }>(`/admin/class-sessions/board?${sp.toString()}`).then((r) => r.data);
};
export const toggleClassSessionFlag = (sessionId: number, flag: 'isHoliday' | 'isExtraSession' | 'isActive') =>
  apiPost<{ ok: boolean; data: { value: number } }>('/admin/class-sessions/toggle-flag', { sessionId, flag })
    .then((r) => r.data);

// ── 4) Exam paper delivery chain ──

export type ExamHandoverSession = {
  sessionId: number; examDate: string; time: string; hallId: number | null; hallName: string;
  present: number; total: number; minutesSigned: number; vaultReceived: number; packets: number;
};
export type ExamHandoverDelivery = {
  deliveryId: number; offeringId: number; status: string; sheetCount: number;
  returnedToArchive: boolean; returnedAt: string | null;
  courseCode: string | null; courseTitle: string | null; professorName: string;
};
export type ExamHandoverBoard = {
  terms: LPTerm[]; termId: number; termTitle: string;
  sessions: ExamHandoverSession[]; deliveries: ExamHandoverDelivery[];
};
export type ExamHandoverQr = { url: string; qr: string; expiresAt: string; step: string };
export const getExamHandoverBoard = (termId?: number) =>
  apiGet<{ ok: boolean; data: ExamHandoverBoard }>(`/admin/exams/handover/board${termId ? `?termId=${termId}` : ''}`)
    .then((r) => r.data);
export const getExamHandoverQr = (params: { step: string; sessionId?: number; hallId?: number; offeringId?: number }) => {
  const sp = new URLSearchParams({ step: params.step });
  if (params.sessionId) sp.set('sessionId', String(params.sessionId));
  if (params.hallId) sp.set('hallId', String(params.hallId));
  if (params.offeringId) sp.set('offeringId', String(params.offeringId));
  return apiGet<{ ok: boolean; data: ExamHandoverQr }>(`/admin/exams/handover/qr?${sp.toString()}`).then((r) => r.data);
};
export const finalizeExamHandover = (sessionId: number) =>
  apiPost<{ ok: boolean; data: { packets: number; fullyCollected: number; discrepancies: number } }>(
    '/admin/exams/handover/finalize', { sessionId }).then((r) => r.data);

// ── 5) Offering editor ──

export type OfferingEditorClassRow = {
  id: number; day: number | null; start: string | null; end: string | null; roomId: number | null;
};
export type OfferingEditorRow = {
  offeringId: number; code: string; title: string; groupNumber: number; units: number | null;
  professorName: string; capacity: number; enrolledCount: number; departmentId: number | null;
  eduExpertUserId: number | null; eduExpertUserIds: number[]; roomExpertUserIds: number[];
  classRows: OfferingEditorClassRow[];
  exam: { id: number; date: string | null; start: string | null; end: string | null } | null;
};
export type OfferingExpert = { userId: number; name: string; kind: string };
export const getOfferingEditorTerms = () =>
  apiGet<{ ok: boolean; data: { terms: LPTerm[] } }>('/admin/offering-editor/terms').then((r) => r.data.terms);
export const getOfferingEditorRows = (termId: number) =>
  apiGet<{ ok: boolean; data: { rows: OfferingEditorRow[] } }>(`/admin/offering-editor/offerings?termId=${termId}`)
    .then((r) => r.data.rows);
export const getOfferingEditorMeta = () =>
  apiGet<{ ok: boolean; data: { rooms: LPIdName[]; experts: OfferingExpert[] } }>('/admin/offering-editor/meta')
    .then((r) => r.data);
export const saveOfferingEditor = (input: {
  offeringId: number; capacity: number; classRows: OfferingEditorClassRow[];
  exam: { id: number | null; date: string; start: string; end: string } | null;
  overrideReason?: string;
}) => apiPost('/admin/offering-editor/save', input);
export const addOfferingExpert = (offeringId: number, userId: number) =>
  apiPost('/admin/offering-editor/expert/add', { offeringId, userId });
export const removeOfferingExpert = (offeringId: number, userId: number) =>
  apiPost('/admin/offering-editor/expert/remove', { offeringId, userId });

// ── 6) Weekly schedule conflict resolution ──

export type ConflictSlot = {
  scheduleId: number; offeringId: number; dayOfWeek: number | null;
  startTime: string; endTime: string; roomId: number | null; roomName: string | null;
  professorId: number | null; professorName: string | null;
  courseCode: string; courseTitle: string; groupNumber: number; enrolledCount: number;
  sharedScheduleGroupKey: string | null;
};
export type ConflictPair = {
  kind: 'PROFESSOR' | 'ROOM'; entityId: number; entityName: string;
  dayOfWeek: number; dayName: string; a: ConflictSlot; b: ConflictSlot;
  overlapMinutes: number; overlapFrom: number; overlapTo: number;
  likelyMerged: boolean; fingerprint: string;
};
export type ConflictGroup = {
  key: string; kind: 'PROFESSOR' | 'ROOM' | 'MIXED'; kinds: string[];
  entities: { kind: 'PROFESSOR' | 'ROOM'; id: number; name: string }[];
  entityName: string; dayOfWeek: number; dayName: string;
  windowFrom: number; windowTo: number; overlapMinutes: number; overlapFrom: number; overlapTo: number;
  slots: ConflictSlot[]; pairs: ConflictPair[];
  likelyMerged: boolean; students: number; reviewed: boolean;
};
export type ConflictReviewRow = {
  fingerprint: string; status: string; reasonCode: string | null; reasonText: string | null;
  reviewedByName: string | null; reviewedAt: string | null;
};
export type ScheduleConflictReport = {
  termId: number; pairs: ConflictPair[]; groups: ConflictGroup[];
  reviewed: Record<string, ConflictReviewRow>;
  summary: { professor: number; room: number; professorEntities: number; roomEntities: number; studentsAtRisk: number; worstOverlapMinutes: number };
  rawOverlaps: number; mergedSkipped: number; slotsScanned: number; duplicateSlots: number;
  reviewedCount: number; openIssues: number; totalIssues: number; likelyMergedIssues: number;
};
export const getConflictTerms = () =>
  apiGet<{ ok: boolean; data: { terms: LPIdName[] } }>('/admin/schedule-conflicts/terms').then((r) => r.data.terms);
export const loadScheduleConflicts = (termId: number) =>
  apiPost<{ ok: boolean; data: ScheduleConflictReport }>('/admin/schedule-conflicts/load', { termId }).then((r) => r.data);
export const markConflictReviewed = (input: {
  termId: number; fingerprint: string; kind: 'PROFESSOR' | 'ROOM'; entityId: number;
  dayOfWeek: number; scheduleAId: number; scheduleBId: number; reasonCode: string; reasonText?: string;
}) => apiPost('/admin/schedule-conflicts/review', input);
export const markConflictGroupReviewed = (input: {
  termId: number; reasonCode: string; reasonText?: string;
  items: { fingerprint: string; kind: 'PROFESSOR' | 'ROOM'; entityId: number; dayOfWeek: number; scheduleAId: number; scheduleBId: number }[];
}) => apiPost<{ ok: boolean; data: { message: string } }>('/admin/schedule-conflicts/review-group', input).then((r) => r.data);
export const undoConflictReview = (termId: number, fingerprint: string) =>
  apiPost('/admin/schedule-conflicts/undo', { termId, fingerprint });
export const undoConflictGroup = (termId: number, fingerprints: string[]) =>
  apiPost<{ ok: boolean; data: { message: string } }>('/admin/schedule-conflicts/undo-group', { termId, fingerprints }).then((r) => r.data);
export const markOfferingsMerged = (termId: number, offeringIds: number[]) =>
  apiPost<{ ok: boolean; data: { message: string } }>('/admin/schedule-conflicts/merge', { termId, offeringIds }).then((r) => r.data);
export const markOfferingsMergedBulk = (termId: number, groups: number[][]) =>
  apiPost<{ ok: boolean; data: { message: string } }>('/admin/schedule-conflicts/merge-bulk', { termId, groups }).then((r) => r.data);
