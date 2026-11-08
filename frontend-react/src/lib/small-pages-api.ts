// ═══ Typed client for the small admin pages batch ═══
//
// Covers: /admin/terms (+ activate/bulk/sync), /admin/grades/audit
// (+ unfinalize review), the finance statement approval badge, and
// /admin/compliance-policy (+ save/reset/seed-1402).
// The saham settings page reuses the existing endpoints from migration-api
// (getSahamSettings / saveSahamInstituteCode / deleteSahamInstituteCode) and
// the student-card print page already has lib/student-cards-api.ts.
import { apiGet, apiPost } from './api';

// ── /admin/terms ──

export type SmallTermRow = {
  id: number;
  universityId: number | null;
  termCode: string;
  title: string;
  termType: string | null;
  academicYear: number | null;
  startDate: string | null;
  endDate: string | null;
  isCurrent: boolean;
  containsToday: boolean;
};

export type SmallUniversity = { id: number; code: string; title: string };

export type TermsAdminBundle = {
  today: string;
  universities: SmallUniversity[];
  terms: SmallTermRow[];
  activeCount: number;
  containingCount: number;
};

export const getTermsAdminBundle = () =>
  apiGet<{ ok: boolean; data: TermsAdminBundle }>('/admin/terms').then((r) => r.data);

export type TermActivationResult = {
  ok: boolean;
  message?: string;
  error?: string;
  activated: number;
  cleared: number;
  missing: string[];
};

export const activateTermAdmin = (termId: number) =>
  apiPost<{ ok: boolean; data: TermActivationResult }>('/admin/terms/activate', { termId }).then((r) => r.data);

export const bulkActivateTermsAdmin = (picks: { universityId: number; termId: number }[]) =>
  apiPost<{ ok: boolean; data: TermActivationResult }>('/admin/terms/activate-bulk', { picks }).then((r) => r.data);

export type TermSyncEntry = { university: string; termCode: string; termId: number };

export type TermsSyncResult = {
  ok: boolean;
  message?: string;
  error?: string;
  activated: TermSyncEntry[];
  unchanged: TermSyncEntry[];
  noContaining: string[];
  cleared: number;
};

export const syncTermsWithDateAdmin = () =>
  apiPost<{ ok: boolean; data: TermsSyncResult }>('/admin/terms/sync-with-date', {}).then((r) => r.data);

// ── /admin/grades/audit ──

export type GradesAuditPendingRow = {
  id: number;
  offeringId: number;
  reason: string;
  status: string;
  createdAt: string | null;
  courseCode: string | null;
  courseTitle: string | null;
  termCode: string | null;
  requesterFirstName: string | null;
  requesterLastName: string | null;
};

export type GradesAuditLogRow = {
  id: number;
  studentId: number | null;
  studentCode: string | null;
  action: string;
  oldGradeValue: string | null;
  newGradeValue: string | null;
  reason: string | null;
  actorUserId: number | null;
  actorRole: string | null;
  createdAt: string | null;
  actorFirstName: string | null;
  actorLastName: string | null;
  courseCode: string | null;
  courseTitle: string | null;
  termCode: string | null;
};

export type GradesAuditBundle = {
  pending: GradesAuditPendingRow[];
  rows: GradesAuditLogRow[];
  page: number;
  pageSize: number;
  hasNext: boolean;
};

export const getGradesAudit = (page = 1) =>
  apiGet<{ ok: boolean; data: GradesAuditBundle; canFinalApprove: boolean }>(
    `/admin/grades/audit?page=${page}`,
  ).then((r) => ({ data: r.data, canFinalApprove: r.canFinalApprove }));

export type UnfinalizeReviewResult = { ok: boolean; message?: string; error?: string };

// The handler answers 200 {ok, message} on success and 400 {ok:false, error} on
// failure — apiPost turns the latter into a thrown ApiError with the ready
// Persian message (including the STEPUP_REQUIRED prefix the client watches for).
export const reviewUnfinalize = (input: {
  requestId: number;
  decision: 'REVIEWED' | 'APPROVED' | 'REJECTED';
  note?: string | null;
  extendDeadlineTo?: string | null;
}) => apiPost<UnfinalizeReviewResult>('/admin/grades/audit/unfinalize-review', input);

// ── Step-up (two-step password verification) — shared endpoint, already live ──

export const requestStepUp = (scope: string, password: string) =>
  apiPost<{ ok: boolean }>('/step-up/request', { scope, password });

// ── finance statement approval badge (admin/finance/student/[id]) ──

export type FinanceStatementApproval = {
  requestId: number;
  trackingCode: string | null;
  approvedAt: string | null;
} | null;

export const getFinanceStatementApproval = (studentId: number) =>
  apiGet<{ ok: boolean; data: FinanceStatementApproval }>(
    `/admin/finance/student-approval?studentId=${studentId}`,
  ).then((r) => r.data);

// ── /admin/compliance-policy ──

export type PolicyRow = {
  key: string;
  label: string;
  group: string;
  kind: 'number' | 'boolean' | 'enum' | 'text' | 'list' | 'map';
  reference: string;
  help: string;
  options?: string[];
  min?: number;
  max?: number;
  binding: boolean;
  value: unknown;
  legal: unknown;
  source: string;
  sourceLabel: string;
  legalConflict: boolean;
  shadowed: unknown;
  overrideId: number | null;
  overrideReason: string;
};

export type ComplianceBundle = {
  rows: PolicyRow[];
  groups: string[];
  context: { family: string; level: string; entryYear: number; universityId: number | null };
  overrideCount: number;
};

export const getComplianceBundle = (opts?: { entryYear?: number; level?: string; regulationId?: number }) => {
  const qs = new URLSearchParams();
  if (opts?.entryYear) qs.set('entryYear', String(opts.entryYear));
  if (opts?.level) qs.set('level', opts.level);
  if (opts?.regulationId) qs.set('regulationId', String(opts.regulationId));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return apiGet<{ ok: boolean; data: ComplianceBundle }>(`/admin/compliance-policy${suffix}`).then((r) => r.data);
};

export const saveComplianceOverride = (input: {
  key: string;
  value: unknown;
  reason: string;
  degreeLevelId?: number | null;
  regulationId?: number | null;
  entryYear?: number | null;
}) => apiPost<{ ok: boolean }>('/admin/compliance-policy/save', input);

export const resetComplianceOverride = (id: number) =>
  apiPost<{ ok: boolean }>('/admin/compliance-policy/reset', { id });

export type ComplianceSeedResult = { ok: boolean; created: string[]; skipped: string[]; error?: string };

export const seed1402GraduateRegulations = () =>
  apiPost<{ ok: boolean; data: ComplianceSeedResult }>('/admin/compliance-policy/seed-1402', {}).then((r) => r.data);
