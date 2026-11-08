// ═══ Student portal data client (phase 3) ═══
import { apiGet, apiPost } from './api';

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

// ───────────────────────── Dashboard ─────────────────────────

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

// ───────────────────────── Transcript ─────────────────────────

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

// ───────────────────────── Exam card ─────────────────────────

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

// ───────────────────────── Course registration confirmation ─────────────────────────

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

// ───────────────────────── Virtual class / documents / course plan ─────────────────────────

export type VirtualClassSession = {
  courseId: number;
  courseCode: string;
  courseTitle: string;
  professorName: string;
  meetingId: string;
  startTime: string;
  endTime: string;
  isRunning: boolean;
  activeParticipantsCount: number;
  recordingsCount: number;
};

export async function getVirtualClasses(): Promise<VirtualClassSession[]> {
  const res = await apiGet<{ ok: boolean; sessions: VirtualClassSession[] }>('/student/virtual-classes');
  return res.sessions;
}

export async function joinVirtualClass(meetingId: string): Promise<string> {
  const res = await apiPost<{ ok: boolean; url: string; error?: string }>('/student/virtual-classes/join', { meetingId });
  return res.url;
}

export type StudentDocument = {
  id: number;
  fileName: string | null;
  status: string;
  reason: string | null;
  uploadedAt: string | null;
  category: string | null;
  type: string | null;
};

export async function getStudentDocuments(): Promise<StudentDocument[]> {
  const res = await apiGet<{ ok: boolean; documents: StudentDocument[] }>('/student/documents');
  return res.documents;
}

export type LessonPlanData = {
  published: boolean;
  courseTitle: string;
  plan: {
    id: number;
    courseMode: string;
    totalSessions: number;
    objectives: string;
    resources: string;
    status: string;
    submittedAt: string | null;
  } | null;
  sessions: { id: number; sessionNo: number; sessionKind: string; topic: string; details: string | null }[];
  weights: { id: number; title: string; percent: number }[];
};

export async function getLessonPlan(offeringId: number): Promise<LessonPlanData> {
  const res = await apiGet<{ ok: boolean; data: LessonPlanData }>(`/student/lesson-plan/${offeringId}`);
  return res.data;
}

// ───────────────────────── Service desk / workflow ─────────────────────────

export type RequestFormField = {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'number' | 'select' | 'date' | 'file';
  required?: boolean;
  placeholder?: string;
  options?: { value: string; label: string }[];
  helperText?: string;
  defaultValue?: string | number;
};

export type RequestProcess = {
  id: number;
  code: string;
  title: string;
  category: string;
  description: string;
  feeAmount: number;
  formSchema: RequestFormField[];
  steps: { stepOrder: number; title: string; stepType: string; roleCode: string; slaHours: number }[];
};

export type RequestLog = {
  id: number;
  actorRole: string | null;
  action: string | null;
  note: string | null;
  assignedAt: string | null;
  completedAt: string | null;
  durationMinutes: number | null;
  slaStatus: string | null;
};

export type RequestCheckpoint = {
  id: number;
  departmentCode: string;
  departmentTitle: string;
  isCleared: number;
  notes: string | null;
};

export type StudentRequestRow = {
  id: number;
  trackingCode: string;
  status: string;
  created: string | null;
  updated: string | null;
  formData: Record<string, unknown>;
  processCode: string;
  processTitle: string;
  category: string;
  certificateNumber: string | null;
  digitalStampHash: string | null;
  satisfactionScore: number | null;
  feedbackText: string | null;
  logs: RequestLog[];
  checkpoints: RequestCheckpoint[];
};

export type RequestsPageData = {
  student: { id: number; name: string; status: string };
  studentCode: string;
  nationalCode: string | null;
  majorName: string;
  degreeTitle: string;
  universityTitle: string;
  universityLogo: string | null;
  processes: RequestProcess[];
  myRequests: StudentRequestRow[];
};

export async function getRequestsPage(): Promise<RequestsPageData> {
  const res = await apiGet<{ ok: boolean; data: RequestsPageData }>('/student/requests');
  return res.data;
}

export async function submitRequest(processCode: string, formData: Record<string, unknown>): Promise<{ trackingCode: string; status: string }> {
  const res = await apiPost<{ ok: boolean; trackingCode: string; status: string }>('/student/requests/submit', {
    processCode,
    formData,
  });
  return { trackingCode: res.trackingCode, status: res.status };
}

export async function rateRequest(requestId: number, score: number, feedback: string): Promise<void> {
  await apiPost('/student/requests/satisfaction', { requestId, score, feedback });
}

export async function uploadRequestAttachment(file: File): Promise<{ key: string; name: string; size: number; mimeType: string }> {
  const body = new FormData();
  body.append('file', file);
  const res = await fetch('/api/v2/student/requests/attachment', {
    method: 'POST',
    credentials: 'same-origin',
    body,
  });
  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const msg =
      payload && typeof payload === 'object' && 'error' in payload && typeof (payload as { error: unknown }).error === 'string'
        ? (payload as { error: string }).error
        : `خطای سرور (${res.status})`;
    throw new Error(msg);
  }
  return (payload as { attachment: { key: string; name: string; size: number; mimeType: string } }).attachment;
}

// ───────────────────────── Financial affairs ─────────────────────────

export type FinanceEvent = {
  kind: string;
  label: string;
  amount: number;
  dateMs: number | null;
  sign: number;
  depositType?: string | null;
  datedByDeposit?: boolean;
  payerName?: string | null;
  payerNationalCode?: string | null;
  receiptNo?: string | null;
  voucherNo?: string | null;
  payTypeCode?: number | null;
  accountNo?: string | null;
  cardNo?: string | null;
  bankName?: string | null;
  recorderName?: string | null;
  legacyRem?: string | null;
};

export type FinanceTerm = {
  termId: number;
  termTitle: string;
  termCode: string | null;
  statusTitle?: string | null;
  statusCode?: string | null;
  termAvg?: number | null;
  passedUnits?: number | null;
  charges: number;
  tuitionFixed: number;
  tuitionVariable: number;
  discounts: number;
  discountsFixed: number;
  discountsVariable: number;
  discountsAmount: number;
  subjectFees: number;
  assistance: number;
  sponsorships: number;
  sponsorshipsFromDeposits: number;
  charityCoverage: number;
  payments: number;
  chequesCleared: number;
  chequesPending: number;
  chequesBounced: number;
  loans: number;
  netPayable: number;
  balance: number;
  events: FinanceEvent[];
};

export type FinanceData = {
  student: {
    studentId: number;
    userId: number;
    studentCode: string;
    fullName: string;
    nationalCode: string | null;
    majorTitle: string | null;
    majorCode?: string | null;
    degreeTitle: string | null;
    degreeCode?: string | null;
    entryYear: number;
    status: string;
    statusCode?: string | null;
    entryTerm: number | null;
    facultyTitle?: string | null;
    quotaType?: string | null;
    quotaCode?: string | null;
    courseType?: string | null;
    courseTypeCode?: string | null;
    admissionMethod?: string | null;
    entryDate?: string | null;
  };
  records: { id: number; studentCode: string; status: string; degreeTitle: string | null; entryYear: number }[];
  activeRecordId: number;
  terms: FinanceTerm[];
  totals: {
    charges: number;
    discounts: number;
    sponsorships: number;
    payments: number;
    chequesCleared: number;
    chequesPending: number;
    chequesBounced: number;
    loans: number;
    balance: number;
  };
  cheques: { id: number; termId: number | null; chequeNo: string | null; bankName: string | null; amount: number; dueDate: string | null; status: string | null }[];
  loans: { id: number; termId: number | null; productTitle: string | null; lender: string | null; amount: number; installments: number | null; status: string | null }[];
  notifications: { id: number; text: string; dateMs: number | null; event: string | null }[];
  dueSoon: { id: number; chequeNo: string | null; bankName: string | null; amount: number; daysLeft: number | null; overdue: boolean }[];
  selectedTermTitle: string | null;
  university: StudentScheduleData['university'];
  issuedAt: string;
  qr: { url: string; svg: string; expiresAt: string } | null;
};

export async function getFinance(params?: { record?: number | null }): Promise<FinanceData> {
  const qs = params?.record ? `?record=${params.record}` : '';
  const res = await apiGet<{ ok: boolean; data: FinanceData }>(`/student/finance${qs}`);
  return res.data;
}

// ───────────────────────── Academic chart ─────────────────────────

export type ChartRow = {
  id: number;
  courseId: number;
  code: string;
  title: string;
  units: number;
  roleType: string;
  prereqCodes: string[];
  status: 'PASSED' | 'IN_PROGRESS' | 'MISSING_PAST' | 'FUTURE';
};

export type ChartData = {
  student: { name: string; studentCode: string; entryYear: number };
  majorName: string;
  degreeTitle: string;
  versionCode: string | null;
  chartUnits: number;
  requiredUnits: number;
  entryYear: number;
  semesters: { key: number; title: string; units: number; isCurrent: boolean; isHighlighted: boolean; rows: ChartRow[] }[];
  roleSummary: { roleType: string; total: number; passed: number; units: number; passedUnits: number }[];
  enrollmentCount: number;
  filteredTermTitle: string | null;
  currentSemesterNo: number | null;
  highlightAnchor: string | null;
};

export async function getChart(): Promise<ChartData> {
  const res = await apiGet<{ ok: boolean; data: ChartData }>('/student/chart');
  return res.data;
}

// ───────────────────────── Graduation and thesis ─────────────────────────

export type TrackerData = {
  open: boolean;
  audit?: {
    studentId: number;
    studentCode: string;
    fullName: string;
    majorName: string | null;
    degreeCode: string | null;
    requiredUnits: number;
    passedUnits: number;
    gpa: number | null;
    missing: { code: string; title: string; units: number }[];
    catalogOk: boolean;
    reasons: string[];
  } | null;
  needPhoto: boolean;
  sajjadRequired: boolean;
  needSajjad: boolean;
  sajjadPortal: string;
  dossier?: {
    audit: {
      id: number;
      workflowStatus: string;
      requiredUnits: number;
      passedUnits: number;
      gpa: number | null;
      headApprovalStatus: number;
      headNote: string | null;
      thesisRequired: number;
      sajjadStatus: string | null;
      sajjadRequestCode: string | null;
      photoDocumentId: number | null;
      stampFeeAmount: number;
      stampFeePaid: number;
      note: string | null;
    };
    student: { studentCode: string; fullName: string; majorName: string | null; degreeTitle: string | null; status: string };
    checklist: { id: number; department: string; title: string; status: string; amountDue: number; detail: string | null; autoChecked: boolean; resolvedAt: string | null }[];
    degrees: { id: number; degreeType: string; serialNo: string; verifyCode: string; isDelivered: boolean; issuedAt: string }[];
  };
  steps?: { code: string; title: string; actor: string; state: 'DONE' | 'CURRENT' | 'TODO' }[];
};

export async function getTracker(): Promise<TrackerData> {
  const res = await apiGet<{ ok: boolean; tracker: TrackerData }>('/student/graduation');
  return res.tracker;
}

export async function submitSajjad(auditId: number, code: string): Promise<void> {
  await apiPost('/student/graduation/sajjad', { auditId, code });
}

export async function uploadGraduationPhoto(auditId: number, file: File): Promise<void> {
  const body = new FormData();
  body.append('auditId', String(auditId));
  body.append('file', file);
  const res = await fetch('/api/v2/student/graduation/photo', { method: 'POST', credentials: 'same-origin', body });
  if (!res.ok) {
    let msg = `خطای سرور (${res.status})`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) msg = j.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
}

export type ChannelsData = { active: string[]; mine: { channel: string; address: string }[] };

export async function getChannels(): Promise<ChannelsData> {
  const res = await apiGet<{ ok: boolean; data: ChannelsData }>('/student/channels');
  return res.data;
}

export async function saveChannel(channel: string, address: string): Promise<void> {
  await apiPost('/student/channels', { channel, address });
}

export type ThesisData = {
  open: boolean;
  thesisDegree: boolean;
  inTrack: boolean;
  student: { name: string; studentCode: string };
  degreeTitle: string | null;
  auditId: number | null;
  workflowStatus: string | null;
  progress: {
    id: number;
    supervisorId: number | null;
    advisorId: number | null;
    titleFa: string | null;
    titleEn: string | null;
    keywords: string | null;
    abstract: string | null;
    irandocPriorStatus: string | null;
    proposalFileId: number | null;
    proposalSubmittedAt: string | null;
    proposalSimilarity: number | null;
    proposalStatus: string | null;
    proposalApprovedAt: string | null;
    irandocUploadStatus: string | null;
    defenseRequestedAt: string | null;
    defenseRequestStatus: string | null;
    defenseScheduledAt: string | null;
    defenseConductedAt: string | null;
    defenseResult: string | null;
    defenseNote: string | null;
    finalThesisFileId: number | null;
    finalThesisSubmittedAt: string | null;
    finalIrandocStatus: string | null;
  } | null;
  logs: { id: number; checkType: string; trackingCode: string | null; similarityPercentage: number | null; decision: string | null; checkedAt: string | null }[];
  staffList: { id: number; name: string; rank: string }[];
  audit: { passedUnits: number; requiredUnits: number; gpa: number | null; catalogOk: boolean } | null;
};

export async function getThesis(): Promise<ThesisData> {
  const res = await apiGet<{ ok: boolean; data: ThesisData }>('/student/thesis');
  return res.data;
}

export async function submitThesisTitle(input: {
  auditId: number;
  supervisorId: number;
  titleFa: string;
  titleEn?: string;
  keywords?: string;
  abstract?: string;
}): Promise<void> {
  await apiPost('/student/thesis/title', input);
}

export async function uploadThesisFile(kind: 'proposal' | 'final', auditId: number, file: File): Promise<void> {
  const body = new FormData();
  body.append('auditId', String(auditId));
  body.append('file', file);
  const res = await fetch(`/api/v2/student/thesis/${kind}`, { method: 'POST', credentials: 'same-origin', body });
  if (!res.ok) {
    let msg = `خطای سرور (${res.status})`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) msg = j.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
}

export async function requestThesisDefense(auditId: number): Promise<void> {
  await apiPost('/student/thesis/defense', { auditId });
}
