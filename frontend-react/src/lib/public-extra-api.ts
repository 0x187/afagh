// ═══ Client for supplementary endpoints of public/session pages (Go backend — public_extra.go) ═══
// Coverage: stamped document inquiry, alumni portal, exam proctor panel, entrance QR attendance registration.
import { apiGet, apiPost } from './api';

// ─────────────────── Stamped document inquiry (no session) ───────────────────

export type PublicDocumentResult = {
  found: boolean;
  error?: string;
  doc?: {
    id: number;
    typeTitle: string;
    fileName: string;
    contentHash: string;
    verificationStatus: string;
    uploadedAtShamsi: string;
    ownerName: string;
    studentCode: string;
  };
};

export async function verifyPublicDocument(hash: string): Promise<PublicDocumentResult> {
  const res = await apiGet<{ ok: boolean; data: PublicDocumentResult }>(`/public/document/${encodeURIComponent(hash)}`);
  return res.data;
}

// ─────────────────── Public page for the room QR header ───────────────────

export type PublicRoomResult = {
  found: boolean;
  reason?: 'badroom' | 'notfound';
  room?: { id: number; name: string; buildingName: string; floor: string; isActive: number };
  uniTitle?: string | null;
};

export async function getPublicRoom(code: string): Promise<PublicRoomResult> {
  const res = await apiGet<{ ok: boolean; data: PublicRoomResult }>(`/public/room/${encodeURIComponent(code)}`);
  return res.data;
}

// ─────────────────── Alumni portal ───────────────────

export type AlumniService = {
  code: string;
  title: string;
  hint: string;
  needsDestination: boolean;
  fee: number;
};

export type AlumniRequest = {
  id: number;
  requestType: string;
  trackingCode: string;
  status: string;
  fee: number;
  destination: string | null;
  description: string | null;
  resultFileUrl: string | null;
  adminNote: string | null;
  createdAt: string | null;
  paidAt: string | null;
};

export type AlumniDegree = {
  id: number;
  degreeType: string;
  serialNo: string;
  verifyCode: string;
  ministryVerificationCode: string | null;
  isDelivered: boolean;
  issuedAt: string;
};

export type AlumniProfile = {
  employmentStatus: string;
  organization: string;
  jobTitle: string;
  contactEmail: string;
  contactMobile: string;
  linkedinUrl: string;
  allowContact: boolean;
};

export type AlumniSummary = {
  me: {
    fullName: string;
    studentCode: number;
    majorName: string | null;
    degreeTitle: string | null;
    entryYear: number | null;
  } | null;
  services?: AlumniService[];
  degrees?: AlumniDegree[];
  requests?: AlumniRequest[];
  profile?: AlumniProfile;
};

export async function getAlumniSummary(): Promise<AlumniSummary> {
  const res = await apiGet<{ ok: boolean; data: AlumniSummary }>('/alumni/summary');
  return res.data;
}

export async function saveAlumniProfile(profile: Partial<AlumniProfile>): Promise<{ ok: true }> {
  const res = await apiPost<{ ok: boolean }>('/alumni/profile', profile);
  return res as { ok: true };
}

export async function submitAlumniRequest(input: {
  requestType: string;
  destination?: string;
  description?: string;
}): Promise<{ requests: AlumniRequest[] }> {
  const res = await apiPost<{ ok: boolean; data: { requests: AlumniRequest[] } }>('/alumni/requests', input);
  return res.data;
}

export async function payAlumniRequest(requestId: number): Promise<{ already?: boolean; requests: AlumniRequest[] }> {
  const res = await apiPost<{ ok: boolean; data: { already?: boolean; requests: AlumniRequest[] } }>(`/alumni/requests/${requestId}/pay`);
  return res.data;
}

// ─────────────────── Exam proctor panel ───────────────────

export type ProctorRosterItem = {
  studentId: number;
  seatNumber: number;
  blockKey: string;
  studentName: string;
  studentCode: string;
  nationalCodeMasked: string;
  majorTitle: string;
  courseCode: string;
  courseTitle: string;
  isPresent: boolean;
  checkInMethod: string | null;
  hasTemporaryPermit: boolean;
  checkInTime: string | null;
};

export type ProctorSessionData = {
  id: number;
  hallId: number;
  hallName: string;
  buildingName: string;
  hallCapacity: number;
  examDate: string;
  startTime: string;
  endTime: string;
  clockInStatus: string;
  roster: ProctorRosterItem[];
};

export async function getProctorSessions(): Promise<{ staffName: string; noStaff?: boolean; sessions: ProctorSessionData[] }> {
  const res = await apiGet<{ ok: boolean; data: { staffName: string; noStaff?: boolean; sessions: ProctorSessionData[] } }>('/proctor/sessions');
  return res.data;
}

export type ExamCheckInInput = {
  studentId: number;
  isPresent: 0 | 1;
  method: 'QR_SCAN' | 'MANUAL_BY_INVIGILATOR' | 'SYSTEM_EXCUSE';
  hasTemporaryPermit: 0 | 1;
};

export async function proctorClockIn(sessionId: number): Promise<{ clockedIn: number }> {
  const res = await apiPost<{ ok: boolean; data: { clockedIn: number } }>('/proctor/clock-in', { sessionId });
  return res.data;
}

export async function proctorVerifyAttendance(input: {
  sessionId: number;
  hallId: number;
  checkIns: ExamCheckInInput[];
}): Promise<{ verified: number }> {
  const res = await apiPost<{ ok: boolean; data: { verified: number } }>('/proctor/verify', input);
  return res.data;
}

export async function proctorScanTicket(input: {
  sessionId: number;
  hallId: number;
  raw: string;
}): Promise<{ studentId: number; studentName: string; studentCode: string; verified: number }> {
  const res = await apiPost<{ ok: boolean; data: { studentId: number; studentName: string; studentCode: string; verified: number } }>('/proctor/scan', input);
  return res.data;
}

// ─────────────────── Attendance registration via classroom entrance QR (p/room-N) ───────────────────

export type RoomCheckinState = {
  badroom?: boolean;
  notfound?: boolean;
  wronguni?: boolean;
  roomId: number;
  todayJalali: string;
  todayDow: number;
  room: { id: number; name: string; buildingName: string; floor: string; isActive: number };
  staffName: string;
  me: { staffId: number; hasStaff: boolean; name: string; isProfessor: boolean };
  noStaff?: boolean;
  policy: { mode: string; professorAllowed: boolean; controllerAllowed: boolean };
  control: { allowed: boolean; source: string | null };
  focus: {
    id: number;
    offeringId: number;
    sessionDate: string;
    startTime: string;
    endTime: string;
    courseTitle: string;
    courseCode: string;
    groupNumber: number;
    state: 'BEFORE' | 'OPEN' | 'CLOSED';
    recorded: boolean;
    recordedAt: string | null;
    window?: { from: string; to: string };
    merged?: boolean;
    memberCount?: number;
    memberTitles?: string;
  } | null;
  upcoming: { id: number; sessionDate: string; startTime: string; endTime: string; courseTitle: string; courseCode: string }[];
  ctrlGroups: {
    sessionId: number;
    startTime: string;
    endTime: string;
    courseTitle: string;
    courseCode: string;
    groupNumber: number;
    professorId: number | null;
    recordedAt: string | null;
    merged: boolean;
    memberCount: number;
    memberTitles: string;
  }[];
  weekly: {
    scheduleId: number;
    offeringId: number;
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    professorId: number | null;
    professorName: string;
    courseTitle: string;
    courseCode: string;
    groupNumber: number;
  }[];
  mySharedOfferings: number[];
  todayBySlot: Record<
    string,
    { sessionId: number; recordedMine: boolean; recordedMineAt: string | null; recordedAny: boolean; recordedAnyAt: string | null }
  >;
  twinRooms: { id: number; slots: number }[];
};

export async function getRoomCheckinState(code: string): Promise<RoomCheckinState> {
  const res = await apiGet<{ ok: boolean; data: RoomCheckinState }>(`/room-checkin/${encodeURIComponent(code)}`);
  return res.data;
}

export async function recordRoomCheckin(code: string, sessionId: number): Promise<{
  via: 'professor' | 'controller';
  already: boolean;
  recordedCount: number;
  merged: boolean;
  message: string;
}> {
  const res = await apiPost<{ ok: boolean; data: { via: 'professor' | 'controller'; already: boolean; recordedCount: number; merged: boolean; message: string } }>(
    `/room-checkin/${encodeURIComponent(code)}/record`,
    { sessionId },
  );
  return res.data;
}
