// ═══ کلاینت دادهٔ پرتال دانشجو (فاز ۳) ═══
import { apiGet } from './api';

export type StudentGridClass = {
  dayOfWeek: number | null;
  dayName: string;
  startTime: string;
  endTime: string;
  room: string;
  building: string;
  weekType: 'ALL' | 'EVEN' | 'ODD';
};

export type StudentScheduleCourse = {
  enrollmentId: number;
  offeringId: number;
  code: string;
  title: string;
  units: number;
  courseType: string;
  group: number;
  status: string;
  professor: string;
  enrolledCount: number | null;
  capacity: number | null;
  sharedScheduleGroupKey: string | null;
  classes: StudentGridClass[];
  exam: { examDate: string; startTime: string; endTime: string; room: string } | null;
};

export type StudentScheduleData = {
  student: {
    name: string;
    studentCode: string;
    majorName: string;
    degreeTitle: string;
    currentTermNo: number;
    entryYear: number;
  };
  term: { id: number | null; title: string; termCode: string };
  university: { title: string; logoUrl: string | null };
  courses: StudentScheduleCourse[];
};

export async function getStudentSchedule(termId?: number | null): Promise<StudentScheduleData> {
  const qs = termId ? `?termId=${termId}` : '';
  const res = await apiGet<{ ok: boolean; data: StudentScheduleData }>(`/student/schedule${qs}`);
  return res.data;
}

export type StudentMe = {
  id: number;
  studentCode: string;
  status: string;
  entryYear: number;
  majorId: number | null;
  degreeLevelId: number | null;
  universityId: number | null;
};

export async function getStudentMe(): Promise<StudentMe> {
  const res = await apiGet<{ ok: boolean; student: StudentMe }>('/student/me');
  return res.student;
}

// ───────────────────────── داشبورد ─────────────────────────

export type StudentDashboardVirtualClass = {
  id: number;
  courseTitle: string;
  meetingId: string;
  isRunning: boolean;
  currentAttendanceCount: number;
  professor: string;
};

export type StudentDashboardExam = {
  code: string;
  title: string;
  group: number;
  units: number;
  professor: string;
  examDate: string | null;
  examTime: string | null;
  room: string | null;
  seatNumber: number | null;
};

export type StudentDashboardData = {
  student: StudentScheduleData['student'];
  term: StudentScheduleData['term'];
  university: StudentScheduleData['university'];
  virtualClasses: StudentDashboardVirtualClass[];
  upcomingExams: StudentDashboardExam[];
  debtRials: number;
  isFinancialCleared: boolean;
  termHasEnrollment: boolean;
};

export async function getStudentDashboard(termId?: number | null): Promise<StudentDashboardData> {
  const qs = termId ? `?termId=${termId}` : '';
  const res = await apiGet<{ ok: boolean; data: StudentDashboardData }>(`/student/dashboard${qs}`);
  return res.data;
}

// ───────────────────────── کارنامه ─────────────────────────

export type TranscriptRow = {
  enrollmentId: number;
  code: string;
  title: string;
  units: number;
  gradingType: string | null;
  affectsGpa: number | null;
  status: string;
  emergencyWithdrawal: boolean;
  grade: number | null;
  isDescriptive: boolean;
  passMark: number;
  result: string;
};

export type TranscriptTerm = {
  termId: number;
  termCode: string;
  title: string;
  isCurrent: boolean;
  termType: string;
  displayYear: string;
  displayTerm: string;
  semester: string;
  displayTitle: string;
  rows: TranscriptRow[];
  units: number;
  passedUnits: number;
  gradedUnits: number;
  gpa: number | null;
  isHonor: boolean;
  isProbation: boolean;
};

export type TranscriptYear = {
  academicYear: number;
  displayYear: string;
  isEquivalent: boolean;
  terms: TranscriptTerm[];
};

export type StudentTranscriptData = {
  student: StudentScheduleData['student'];
  university: StudentScheduleData['university'];
  records: { id: number; studentCode: string; status: string; degreeTitle: string | null; entryYear: number }[];
  activeRecordId: number;
  nationalIdMasked: string;
  degreeTitle: string;
  majorName: string;
  entryYear: number;
  studyType: string;
  status: string;
  statusLabel: string;
  regulationTitle: string;
  regulationPolicy: string;
  academicYears: TranscriptYear[];
  totals: {
    enrolledUnits: number;
    passedUnits: number;
    failedUnits: number;
    gradedUnits: number;
    gpa: number | null;
    excludedCount: number;
  };
  qr: { url: string; svg: string; expiresAt: string } | null;
};

export async function getStudentTranscript(params?: { record?: number | null; termId?: number | null }): Promise<StudentTranscriptData> {
  const q = new URLSearchParams();
  if (params?.record) q.set('record', String(params.record));
  if (params?.termId) q.set('termId', String(params.termId));
  const qs = q.toString() ? `?${q.toString()}` : '';
  const res = await apiGet<{ ok: boolean; data: StudentTranscriptData }>(`/student/transcript${qs}`);
  return res.data;
}

// ───────────────────────── کارت آزمون ─────────────────────────

export type StudentExamCardData = {
  card: {
    studentId: number;
    studentCode: string;
    fullName: string;
    nationalIdMasked: string;
    majorName: string | null;
    entryYear: number;
    termTitle: string;
    debtRials: number;
    isFinancialCleared: boolean;
    courses: {
      enrollmentId: number;
      courseCode: string;
      courseTitle: string;
      units: number;
      professorName: string;
      classRoomName: string | null;
      examDate: string;
      examTime: string;
      examHall: string | null;
      seatNumber: number | null;
      hasEvaluated: boolean;
    }[];
  } | null;
  examTicket: { token: string; expiresAt: string } | null;
  examTicketBlocked: string | null;
  ticketQr: { url: string; svg: string } | null;
  evaluationWindow: { open: boolean; message: string; title: string };
  university: StudentScheduleData['university'];
  noCourses: boolean;
};

export async function getStudentExamCard(termId?: number | null): Promise<StudentExamCardData> {
  const qs = termId ? `?termId=${termId}` : '';
  const res = await apiGet<{ ok: boolean; data: StudentExamCardData }>(`/student/exam-card${qs}`);
  return res.data;
}

// ───────────────────────── تأییدیهٔ انتخاب واحد ─────────────────────────

export type EnrollConfirmData = {
  termTitle: string;
  blocked: string | null;
  verifyUrl: string | null;
  expiresAt: string | null;
  qrSvg: string;
  emptyMessage: string | null;
  data: {
    studentId: number;
    studentName: string;
    studentCode: string;
    nationalIdMasked: string;
    majorName: string | null;
    termId: number;
    termTitle: string;
    courses: {
      courseTitle: string;
      courseCode: string;
      units: number;
      groupNumber: number;
      professorName: string | null;
      status: string;
    }[];
    totalUnits: number;
    checkedAt: string;
  } | null;
};

export async function getEnrollConfirm(): Promise<EnrollConfirmData> {
  const res = await apiGet<{ ok: boolean; data: EnrollConfirmData }>('/student/enroll-confirm');
  return res.data;
}
