// ═══ کلاینت پورتال استاد (فاز ۴) ═══
import { apiGet, apiPost } from './api';

export type ProfessorInfo = {
  id: number;
  name: string;
  staffCode: string;
  academicRank: string | null;
  contractType: string | null;
  departmentName: string | null;
  universityTitle: string;
  universityLogo: string | null;
};

export type ProfTerm = { id: number | null; title: string; termCode: string; gradeEntryDeadline: string | null };

export type ProfScheduleRow = {
  id: number;
  code: string;
  title: string;
  units: number;
  courseType: string;
  group: number;
  enrolledCount: number;
  capacity: number;
  dayOfWeek: number | null;
  dayName: string;
  startTime: string;
  endTime: string;
  roomName: string;
  buildingName: string;
  weekType: 'ALL' | 'EVEN' | 'ODD';
  isCoTaught: boolean;
  coPartnerName: string | null;
  hasSchedule: boolean;
};

export type ProfLiveSession = {
  id: number;
  courseTitle: string;
  meetingId: string;
  isRunning: boolean;
  activeParticipantsCount: number;
  recordingsCount: number;
};

export type ProfClassCard = {
  key: string;
  offeringId: number;
  title: string;
  code: string;
  group: number;
  units: number;
  roomLine: string;
  timeLine: string;
  enrolled: number;
  capacity: number;
  isCoTaught: boolean;
  coTeacherName: string | null;
  isMerged: boolean;
  mergedCodes: string[];
};

export type ProfessorDashboardData = {
  professor: ProfessorInfo;
  term: ProfTerm;
  university: { title: string; logoUrl: string | null };
  stats: { classCount: number; availabilityCount: number; contractStatus: string; gradeDeadline: string | null };
  cards: ProfClassCard[];
  weekRows: ProfScheduleRow[];
  liveSessions: ProfLiveSession[];
  vcConfigured: boolean;
};

export async function getProfessorDashboard(): Promise<ProfessorDashboardData> {
  const res = await apiGet<{ ok: boolean; data: ProfessorDashboardData }>('/professor/dashboard');
  return res.data;
}

export type ProfessorScheduleData = { professor: ProfessorInfo; term: ProfTerm; rows: ProfScheduleRow[] };

export async function getProfessorSchedule(): Promise<ProfessorScheduleData> {
  const res = await apiGet<{ ok: boolean; data: ProfessorScheduleData }>('/professor/schedule');
  return res.data;
}

export type ContractLine = {
  offeringId: number;
  code: string;
  title: string;
  groupNumber: number;
  theoryUnits: number;
  practicalUnits: number;
  weeklyHours: number;
  termTotalHours: number;
};

export type ContractView = {
  contractNo: string;
  contractDate: string;
  termTitle: string;
  professorName: string;
  nationalCode: string;
  staffCode: string;
  bankAccountNo: string;
  staffType: string;
  academicRank: string;
  degree: string;
  departmentName: string;
  cooperationType: string;
  hourlyRate: number;
  minutesPerUnit: number;
  lines: ContractLine[];
  totalTermHours: number;
  totalUnits: number;
  grossAmount: number;
  taxRatePercent: number;
  taxDeduction: number;
  insuranceRatePercent: number;
  insuranceDeduction: number;
  netAmount: number;
  midtermPayment: number;
  finalPayment: number;
  signatureStatus: string;
  signedAt: string | null;
  digitalHash: string | null;
  documentId: number | null;
};

export type ProfessorContractData = {
  professor: ProfessorInfo;
  term: ProfTerm;
  university: { title: string; logoUrl: string | null };
  contract: ContractView | null;
  message: string | null;
};

export async function getProfessorContract(): Promise<ProfessorContractData> {
  const res = await apiGet<{ ok: boolean; data: ProfessorContractData }>('/professor/contract');
  return res.data;
}

export async function sendContractOTP(documentId: number): Promise<{ devOtp?: string; expiresInSeconds: number }> {
  return apiPost('/professor/contract/otp', { documentId });
}

export async function signContract(documentId: number, otp: string): Promise<void> {
  await apiPost('/professor/contract/sign', { documentId, otp });
}

export type ProfDocument = {
  id: number;
  docType: string;
  title: string;
  signatureStatus: string;
  termId: number | null;
  createdAt: string | null;
  signedAt: string | null;
  documentHash: string | null;
};

export async function getProfessorDocuments(): Promise<ProfDocument[]> {
  const res = await apiGet<{ ok: boolean; documents: ProfDocument[] }>('/professor/documents');
  return res.documents;
}

export async function getProfessorDocument(id: number): Promise<{ document: ProfDocument; snapshot: Record<string, unknown>; snapshotValid: boolean }> {
  const res = await apiGet<{ ok: boolean; data: { document: ProfDocument; snapshot: Record<string, unknown>; snapshotValid: boolean } }>(`/professor/documents/${id}`);
  return res.data;
}

export async function sendDocumentOTP(id: number): Promise<{ devOtp?: string; expiresInSeconds: number }> {
  return apiPost(`/professor/documents/${id}/otp`);
}

export async function signDocument(id: number, otp: string): Promise<void> {
  await apiPost(`/professor/documents/${id}/sign`, { otp });
}

export type BroadcastData = {
  classes: { offeringId: number; termTitle: string; label: string; enrolled: number }[];
  history: { eventCode: string; sentAt: string | null; body: string; total: number }[];
};

export async function getBroadcast(): Promise<BroadcastData> {
  const res = await apiGet<{ ok: boolean; data: BroadcastData }>('/professor/broadcast');
  return res.data;
}

export async function previewBroadcast(offeringId: number): Promise<number> {
  const res = await apiPost<{ ok: boolean; count: number }>('/professor/broadcast/preview', { offeringId });
  return res.count;
}

export type BroadcastReport = {
  total: number;
  inbox: number;
  sent: { channel: string; n: number }[];
  noAddress: { channel: string; n: number }[];
  failedRequests: number;
};

export async function sendBroadcast(offeringId: number, channels: string[], text: string): Promise<BroadcastReport> {
  const res = await apiPost<{ ok: boolean; report: BroadcastReport }>('/professor/broadcast/send', { offeringId, channels, text });
  return res.report;
}

export type AvailabilityCell = { dayIndex: number; slotIndex: number; status: 'PREF' | 'AVAIL' | 'UNAVAIL' };

export type AvailabilityData = {
  professor: ProfessorInfo;
  term: ProfTerm;
  cells: AvailabilityCell[];
  notes: string;
  maxWeeklyUnits: number;
};

export async function getAvailability(): Promise<AvailabilityData> {
  const res = await apiGet<{ ok: boolean; data: AvailabilityData }>('/professor/availability');
  return res.data;
}

export async function saveAvailability(termId: number, cells: AvailabilityCell[], notes: string): Promise<void> {
  await apiPost('/professor/availability', { termId, cells, notes });
}

// ───────────────────────── حضور و غیاب ─────────────────────────

export type AttendanceStudent = { id: number; studentCode: string; fullName: string };
export type AttendanceStatus = 'PRESENT' | 'LATE' | 'ABSENT' | 'EXCUSED';

export type AttendanceSession = {
  id: number;
  sessionNo: number;
  sessionDate: string;
  startTime: string;
  endTime: string;
  roomName: string;
  topic: string;
  isHeld: boolean;
  isMakeUp: boolean;
  replacedSessionNo: number | null;
  professorStatus: string;
  verificationDetail: string;
  professorCheck: { verificationMethod: string; ipAddress: string | null; recordedAt: string | null } | null;
  studentStatuses: Record<string, { status: AttendanceStatus }>;
};

export type AttendanceOffering = {
  id: number;
  code: string;
  title: string;
  groupNumber: number;
  units: number;
  roomName: string;
  scheduleTime: string;
  hasSchedules: boolean;
  canGenerate: boolean;
  merged: boolean;
  memberCount: number;
  students: AttendanceStudent[];
  sessions: AttendanceSession[];
};

export type MakeupRecord = {
  id: number;
  offeringId: number;
  courseTitle: string;
  groupNumber: number;
  professorName: string;
  replacedSessionNo: number;
  sessionDate: string;
  sessionTime: string;
  roomName: string;
  topic: string;
  reason: string;
  status: string;
  allocatedAt: string;
};

export type AttendanceData = {
  professor: ProfessorInfo;
  termTitle: string;
  termId: number | null;
  offerings: AttendanceOffering[];
  defaultOfferingId: number | null;
  initialMakeupHistory: MakeupRecord[];
  todayJalali: string;
  rooms: { id: number; name: string; capacity: number; type: string }[];
};

export async function getAttendance(offeringId?: number | null): Promise<AttendanceData> {
  const qs = offeringId ? `?offeringId=${offeringId}` : '';
  const res = await apiGet<{ ok: boolean; data: AttendanceData }>(`/professor/attendance${qs}`);
  return res.data;
}

export async function generateAttendanceSessions(offeringId: number): Promise<{ generated: number; skipped: number; already?: boolean }> {
  return apiPost('/professor/attendance/generate', { offeringId });
}

export async function saveAttendance(sessionId: number, entries: { studentId: number; status: AttendanceStatus }[]): Promise<{ savedCount: number; sessionCount: number }> {
  return apiPost('/professor/attendance/save', { sessionId, entries });
}

export async function scheduleMakeup(input: {
  offeringId: number;
  replacedSessionId?: number | null;
  sessionDate: string;
  startTime: string;
  endTime: string;
  roomName: string;
  isDirect: boolean;
  topic?: string;
  absenceReason?: string;
}): Promise<number> {
  const res = await apiPost<{ ok: boolean; sessionId: number }>('/professor/attendance/makeup', input);
  return res.sessionId;
}
