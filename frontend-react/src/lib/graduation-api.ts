// ═══ کلاینت میز فارغ‌التحصیلی و صدور مدارک ═══
import { apiGet, apiPost } from './api';

export type GradStep = { code: string; title: string; actor: string };

export type GradRow = {
  id: number;
  studentId: number;
  workflowStatus: string;
  gpa: number | null;
  passedUnits: number;
  requiredUnits: number;
  headApproved: boolean;
  thesisRequired: boolean;
  irandocStatus: string | null;
  studentCode: string;
  fullName: string;
  majorName: string | null;
  degreeTitle: string | null;
  startedAt: string | null;
  lastEventAt: string | null;
};

export type GradStats = {
  steps: { code: string; title: string; count: number }[];
  onHold: number;
  issuedDocs: number;
  undelivered: number;
};

export type GradDept = {
  id: number;
  code: string;
  title: string;
  autoCheck: string;
  apiUrl: string | null;
  responsibleRoleCode: string | null;
  sortOrder: number;
  isActive: boolean;
  hint: string | null;
};

export type AlumniRow = {
  id: number;
  requestType: string;
  trackingCode: string;
  status: string;
  fee: number;
  destination: string | null;
  description: string | null;
  adminNote: string | null;
  studentId: number;
  studentCode: string;
  fullName: string;
  createdAt: string | null;
};

export type AlumniService = {
  code: string;
  title: string;
  hint: string;
  needsDestination: boolean;
  fee: number;
};

export type MissingCourse = { code: string; title: string; units: number };

export type DossierAudit = {
  id: number;
  studentId: number;
  workflowStatus: string;
  requiredUnits: number;
  passedUnits: number;
  gpa: number | null;
  missingCourses: MissingCourse[];
  catalogOk: boolean;
  headApprovalStatus: number;
  headNote: string | null;
  thesisRequired: boolean;
  thesisTitle: string | null;
  irandocTrackingCode: string | null;
  irandocSimilarityScore: number | null;
  irandocStatus: string | null;
  sajjadStatus: string | null;
  sajjadRequestCode: string | null;
  sajjadRequestedAt: string | null;
  sajjadConfirmedAt: string | null;
  photoDocumentId: number | null;
  stampFeePaid: boolean;
  stampFeeAmount: number;
  note: string | null;
  headApprovedAt: string | null;
  irandocCheckedAt: string | null;
  finalDocsAt: string | null;
  startedAt: string | null;
  lastEventAt: string | null;
  completedAt: string | null;
};

export type ChecklistItem = {
  id: number;
  department: string;
  title: string;
  status: string;
  amountDue: number;
  detail: string | null;
  autoChecked: boolean;
  resolvedAt: string | null;
};

export type DegreeItem = {
  id: number;
  degreeType: string;
  serialNo: string;
  verifyCode: string;
  ministryVerificationCode: string | null;
  isDelivered: boolean;
  issuedAt: string;
  documentHash: string;
};

export type DeliveryItem = {
  id: number;
  eventCode: string;
  channel: string;
  channelLabel: string;
  target: string | null;
  status: string;
  error: string | null;
  createdAt: string | null;
};

export type Dossier = {
  audit: DossierAudit;
  student: { studentCode: string; fullName: string; majorName: string | null; degreeTitle: string | null; status: string };
  checklist: ChecklistItem[];
  degrees: DegreeItem[];
  deliveries: DeliveryItem[];
};

export type GraduationSeed = {
  rows: GradRow[];
  stats: GradStats;
  departments: GradDept[];
  alumniRequests: AlumniRow[];
  services: AlumniService[];
  steps: GradStep[];
};

export async function getGraduationSeed(): Promise<GraduationSeed> {
  const res = await apiGet<{ ok: boolean; data: GraduationSeed }>('/admin/graduation');
  return res.data;
}

export async function scanGraduation(input: { force?: boolean; studentIdsCsv?: string } = {}): Promise<{
  scan: { scanned: number; opened: number; alreadyOpen: number; notEligible: number };
  rows: GradRow[];
  stats: GradStats;
}> {
  const res = await apiPost<{ ok: boolean; data: { scan: { scanned: number; opened: number; alreadyOpen: number; notEligible: number }; rows: GradRow[]; stats: GradStats } }>(
    '/admin/graduation/scan', input,
  );
  return res.data;
}

export async function listGraduation(status: string, q: string): Promise<{ rows: GradRow[]; stats: GradStats }> {
  const res = await apiPost<{ ok: boolean; data: { rows: GradRow[]; stats: GradStats } }>('/admin/graduation/list', { status, q });
  return res.data;
}

export async function getDossier(id: number): Promise<Dossier> {
  const res = await apiPost<{ ok: boolean; data: { dossier: Dossier } }>('/admin/graduation/dossier', { id });
  return res.data.dossier;
}

async function act<T = Record<string, unknown>>(path: string, body: Record<string, unknown>): Promise<T | null> {
  const res = await apiPost<{ ok: boolean; data?: T }>(`/admin/graduation/${path}`, body);
  return (res.data ?? null) as T | null;
}

export async function headApprove(auditId: number, note?: string): Promise<Dossier | null> {
  const d = await act<{ dossier: Dossier }>('head-approve', { auditId, note });
  return d?.dossier ?? null;
}
export async function holdDossier(auditId: number, reason: string): Promise<Dossier | null> {
  const d = await act<{ dossier: Dossier }>('hold', { auditId, reason });
  return d?.dossier ?? null;
}
export async function resumeDossier(auditId: number): Promise<Dossier | null> {
  const d = await act<{ dossier: Dossier }>('resume', { auditId });
  return d?.dossier ?? null;
}
export async function runIrandoc(auditId: number, trackingCode: string, thesisTitle: string): Promise<{ dossier: Dossier | null; result: { passed: boolean; similarity: number; message: string } | null }> {
  const d = await act<{ dossier: Dossier; result: { passed: boolean; similarity: number; message: string } }>('irandoc', { auditId, trackingCode, thesisTitle });
  return { dossier: d?.dossier ?? null, result: d?.result ?? null };
}
export async function startClearance(auditId: number): Promise<Dossier | null> {
  const d = await act<{ dossier: Dossier }>('start-clearance', { auditId });
  return d?.dossier ?? null;
}
export async function autoClearance(auditId: number): Promise<{ dossier: Dossier | null; result: { autoCleared: number; withDebt: number } | null }> {
  const d = await act<{ dossier: Dossier; result: { autoCleared: number; withDebt: number } }>('auto-clearance', { auditId });
  return { dossier: d?.dossier ?? null, result: d?.result ?? null };
}
export async function setClearance(input: { checklistId: number; auditId: number; status: string; detail?: string; amountDue?: number }): Promise<Dossier | null> {
  const d = await act<{ dossier: Dossier }>('set-clearance', input);
  return d?.dossier ?? null;
}
export async function advanceDossier(auditId: number): Promise<Dossier | null> {
  const d = await act<{ dossier: Dossier }>('advance', { auditId });
  return d?.dossier ?? null;
}
export async function requestMinistryCode(auditId: number): Promise<{ dossier: Dossier | null; code: string; online: boolean }> {
  const d = await act<{ dossier: Dossier; code: string; online: boolean }>('ministry-code', { auditId });
  return { dossier: d?.dossier ?? null, code: d?.code ?? '', online: d?.online ?? false };
}
export async function waiveSajjad(auditId: number, note?: string): Promise<Dossier | null> {
  const d = await act<{ dossier: Dossier }>('waive-sajjad', { auditId, note });
  return d?.dossier ?? null;
}
export async function issueDegree(input: { auditId: number; degreeType: 'TEMPORARY' | 'PERMANENT' | 'TRANSCRIPT'; ministryVerificationCode?: string }): Promise<{ dossier: Dossier | null; serialNo: string; verifyCode: string }> {
  const d = await act<{ dossier: Dossier; serialNo: string; verifyCode: string }>('issue', input);
  return { dossier: d?.dossier ?? null, serialNo: d?.serialNo ?? '', verifyCode: d?.verifyCode ?? '' };
}
export async function deliverDegree(degreeId: number, auditId: number, deliveredTo: string): Promise<Dossier | null> {
  const d = await act<{ dossier: Dossier }>('deliver', { degreeId, auditId, deliveredTo });
  return d?.dossier ?? null;
}
export async function saveDepartment(input: Record<string, unknown>): Promise<GradDept[]> {
  const d = await act<{ departments: GradDept[] }>('department/save', input);
  return d?.departments ?? [];
}
export async function deleteDepartment(id: number): Promise<void> {
  await act('department/delete', { id });
}
export async function alumniRequests(status: string): Promise<AlumniRow[]> {
  const d = await act<{ rows: AlumniRow[] }>('alumni/requests', { status });
  return d?.rows ?? [];
}
export async function resolveAlumni(input: { requestId: number; status: 'IN_REVIEW' | 'DONE' | 'REJECTED'; note?: string }): Promise<AlumniRow[]> {
  const d = await act<{ rows: AlumniRow[] }>('alumni/resolve', input);
  return d?.rows ?? [];
}
