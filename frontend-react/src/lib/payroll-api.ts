// ═══ کلاینت موتور حق‌التدریس (فاز ۷ — حقوق) ═══
import { apiGet, apiPost } from './api';

export type PayrollRow = {
  offeringId: number;
  courseCode: string;
  courseTitle: string;
  units: number;
  groupNumber: number | null;
  payRole: string;
  offeringType: string;
  coefficients: string;
  equivalentUnits: number;
  sessions: { planned: number; held: number; absents: number; makeup: number; netAbsences: number };
  effectiveUnits: number;
  absenceDeductionRial: number;
  grossRial: number;
  ruleTitle: string | null;
};

export type PayrollStaff = {
  id: number; name: string; staffCode: string | null; rank: string | null; base: string | null; degree: string | null; contractType: string | null;
};

export type PayrollGates = { gradesFinalized: boolean; pendingGrades: number; docsSigned: boolean; unsignedDocs: number };

export type StaffPayroll = {
  staff: PayrollStaff;
  rate: number;
  rateSource: string;
  rateDivisor: number;
  dutyUnits: number;
  taxRate: number;
  rows: PayrollRow[];
  totalEquivalentUnits: number;
  totalEffectiveUnits: number;
  payableUnits: number;
  gross: number;
  absenceDeductionRial: number;
  tax: number;
  net: number;
  gates: PayrollGates;
  hasContract: boolean;
};

export type OverviewItem = PayrollStaff & {
  rate: number; rateSource: string; dutyUnits: number;
  totalEquivalentUnits: number; totalEffectiveUnits: number; payableUnits: number;
  gross: number; tax: number; absenceDeductionRial: number; net: number;
  status: string; statementId: number | null;
  midtermPaid: number; finalPaid: number; remaining: number; gates: PayrollGates;
};

export type PayrollOverview = {
  overview: {
    term: string;
    list: OverviewItem[];
    totals: { budget: number; paid: number; remaining: number; staffCount: number };
  };
  scoped: boolean;
};

export async function getPayrollOverview(): Promise<PayrollOverview> {
  const res = await apiGet<{ ok: boolean; data: PayrollOverview }>('/admin/payroll');
  return res.data;
}

export type ComputeResult = {
  ok: boolean; termTitle: string; computed: number;
  skippedNoContract: number; skippedSettled: number; skippedLocked: number;
  totals: { gross: number; deductions: number; net: number };
};

export async function computePayroll(): Promise<ComputeResult> {
  const res = await apiPost<{ ok: boolean; data: ComputeResult }>('/admin/payroll/compute', {});
  return res.data;
}

export type PayslipData = {
  term: string;
  computed: boolean;
  calc: StaffPayroll;
  statement: { id: number; status: string; midtermPaidAmount: number; midtermPaidAt: string | null; finalPaidAmount: number; finalPaidAt: string | null; remaining: number } | null;
};

export async function getPayrollPayslip(staffId: number): Promise<PayslipData> {
  const res = await apiGet<{ ok: boolean; data: PayslipData }>(`/admin/payroll/payslip?staffId=${staffId}`);
  return res.data;
}

export async function payMidterm(staffId: number): Promise<void> {
  await apiPost<{ ok: boolean }>('/admin/payroll/midterm', { staffId });
}

export async function settlePayroll(staffId: number): Promise<void> {
  await apiPost<{ ok: boolean }>('/admin/payroll/settle', { staffId });
}

export type ApprovalResultData = { ok: boolean; info?: string; amount?: number };

export async function payrollApprovalOp(op: 'approve-dept' | 'approve-dean' | 'return' | 'reject', statementId: number, note?: string): Promise<ApprovalResultData> {
  const res = await apiPost<{ ok: boolean; data: ApprovalResultData }>('/admin/payroll/approvals', { op, statementId, note: note ?? null });
  return res.data;
}

export type ApprovalHistoryRow = {
  id: number; statementId: number; stage: string; actorUserId: number | null;
  actorRole: string | null; action: string; note: string | null; createdAt: string | null;
};

export async function getApprovalHistory(statementId: number): Promise<ApprovalHistoryRow[]> {
  const res = await apiGet<{ ok: boolean; data: { history: ApprovalHistoryRow[] } }>(`/admin/payroll/approvals?statementId=${statementId}`);
  return res.data.history;
}

export async function exportPayrollCSV(): Promise<string> {
  const res = await fetch('/api/v2/admin/payroll/export', { credentials: 'include' });
  if (!res.ok) throw new Error('خروجی CSV ناموفق بود.');
  return res.text();
}

export type PayrollConfig = {
  year: number;
  coefs: { practical: number; msLevel: number; crowded: number; crowdedTier: { minStudents: number | null; stepSize: number | null; stepIncrement: number | null } | null };
  crowded: number;
  sessions: number;
  midterm: number;
  rates: { academicRank: string; degree: string; academicBase: string | null; baseRatePerUnit: number; effectiveYear: number }[];
  rules: { id: number; offeringType: string | null; professorRole: string | null; academicRank: string | null; classMode: string; minStudents: number | null; maxStudents: number | null; departmentId: number | null; courseType: string | null; repeatNumber: number | null; expression: string | null; flatBase: number | null; perStudentHours: number | null; title: string | null }[];
};

export async function getPayrollConfig(): Promise<PayrollConfig> {
  const res = await apiGet<{ ok: boolean; data: PayrollConfig }>('/admin/payroll/config');
  return res.data;
}

// ─────────────────── مدیریت حقوق: سمتها/نقشها/پوشش ───────────────────

export type DutyRole = {
  id: number; code: string; title: string; dutyUnits: number | null;
  reductionUnits: number; isTeaching: boolean; sortOrder: number;
};

export async function getDutyRoles(): Promise<DutyRole[]> {
  const res = await apiGet<{ ok: boolean; data: { roles: DutyRole[] } }>('/admin/payroll/duty-roles');
  return res.data.roles;
}

export async function createDutyRole(input: Omit<DutyRole, 'id'>): Promise<DutyRole> {
  const res = await apiPost<{ ok: boolean; data: { role: DutyRole } }>('/admin/payroll/duty-roles', input);
  return res.data.role;
}

export async function updateDutyRole(id: number, input: Omit<DutyRole, 'id'>): Promise<void> {
  await apiPost<{ ok: boolean }>('/admin/payroll/duty-roles/update', { id, ...input });
}

export async function deleteDutyRole(id: number): Promise<void> {
  await apiPost<{ ok: boolean }>('/admin/payroll/duty-roles/delete', { id });
}

export type StaffHit = { id: number; staffCode: string | null; name: string; rank: string | null };

export async function searchPayrollStaff(q: string): Promise<StaffHit[]> {
  const res = await apiGet<{ ok: boolean; data: { list: StaffHit[] } }>(`/admin/payroll/staff-search?q=${encodeURIComponent(q)}`);
  return res.data.list;
}

export type StaffTermRole = {
  assignmentId: number; roleId: number; code: string; title: string;
  dutyUnits: number | null; reductionUnits: number; isTeaching: boolean; sortOrder: number; isPrimary: boolean;
};

export type AssignmentsSummary = {
  assigned: StaffTermRole[];
  effectiveDuty: number | null;
  fallbackDuty: number;
};

export async function getAssignments(staffId: number, termId: number): Promise<AssignmentsSummary> {
  const res = await apiGet<{ ok: boolean; data: AssignmentsSummary }>(`/admin/payroll/assignments?staffId=${staffId}&termId=${termId}`);
  return res.data;
}

export async function assignStaffTermRole(staffId: number, termId: number, roleId: number, isPrimary: boolean): Promise<void> {
  await apiPost<{ ok: boolean }>('/admin/payroll/assignments', { staffId, termId, roleId, isPrimary });
}

export async function unassignStaffTermRole(assignmentId: number): Promise<void> {
  await apiPost<{ ok: boolean }>('/admin/payroll/assignments/unassign', { assignmentId });
}

export type PayrollTerm = { id: number; title: string; termCode: string; isCurrent: boolean };

export async function getPayrollTerms(): Promise<PayrollTerm[]> {
  const res = await apiGet<{ ok: boolean; data: { terms: PayrollTerm[] } }>('/admin/payroll/terms');
  return res.data.terms;
}

export type RoleDef = { id: number; code: string; title: string; description: string | null; isActive: boolean };

export async function getRoleDefs(): Promise<RoleDef[]> {
  const res = await apiGet<{ ok: boolean; data: { roleDefs: RoleDef[] } }>('/admin/payroll/role-defs');
  return res.data.roleDefs;
}

export async function createRoleDef(input: { code: string; title: string; description?: string; isActive?: boolean }): Promise<RoleDef> {
  const res = await apiPost<{ ok: boolean; data: { roleDef: RoleDef } }>('/admin/payroll/role-defs', input);
  return res.data.roleDef;
}

export async function updateRoleDef(id: number, input: { code: string; title: string; description?: string; isActive?: boolean }): Promise<void> {
  await apiPost<{ ok: boolean }>('/admin/payroll/role-defs/update', { id, ...input });
}

export async function deleteRoleDef(id: number): Promise<void> {
  await apiPost<{ ok: boolean }>('/admin/payroll/role-defs/delete', { id });
}

export async function setOfferingPayRole(offeringId: number, staffId: number, payRoleOverride: string | null): Promise<void> {
  await apiPost<{ ok: boolean }>(`/admin/payroll/offering-extras?offeringId=${offeringId}&staffId=${staffId}`, { payRoleOverride });
}

export type CoverageRow = {
  staffId: number; staffName: string; offeringId: number; courseCode: string; courseTitle: string;
  groupNumber: number | null; offeringType: string; offeringTypeFa: string; role: string; roleFa: string;
  enrolled: number; hasClass: boolean; nth: number; merged: boolean; memberCount: number;
  ruleId: number | null; ruleTitle: string | null; expression: string | null;
  missDim: string | null; missReason: string | null; overrideCode: string | null; overrideTitle: string | null;
};

export async function getRuleCoverage(termId?: number): Promise<CoverageRow[]> {
  const q = termId ? `?termId=${termId}` : '';
  const res = await apiGet<{ ok: boolean; data: { rows: CoverageRow[] } }>(`/admin/payroll/coverage${q}`);
  return res.data.rows;
}

// ─────────────────── ابلاغ‌های آموزشی ───────────────────

export type DecreeListItem = {
  id: number; staffId: number; staffName: string; staffCode: string | null;
  termId: number; termTitle: string | null; secretariatNo: number; status: string;
  issuedAt: string | null; createdAt: string | null;
};

export type DecreeSigner = { title: string; name: string };

export async function listDecrees(termId: number, staffId?: number): Promise<DecreeListItem[]> {
  const q = staffId ? `&staffId=${staffId}` : '';
  const res = await apiGet<{ ok: boolean; data: { list: DecreeListItem[] } }>(`/admin/payroll/decrees?termId=${termId}${q}`);
  return res.data.list;
}

export async function issueDecree(staffId: number, termId: number, signers: DecreeSigner[]): Promise<number> {
  const res = await apiPost<{ ok: boolean; data: { id: number } }>('/admin/payroll/decrees/issue', { staffId, termId, signers });
  return res.data.id;
}

export type DecreeDetail = DecreeListItem & {
  snapshot: Record<string, unknown> | null;
  signers: DecreeSigner[];
  items: { id: number; section: string; title: string; units: number | null; amount: number | null }[];
  issuedByName: string | null;
};

export async function getDecreeDetail(id: number): Promise<DecreeDetail> {
  const res = await apiGet<{ ok: boolean; data: { decree: DecreeDetail } }>(`/admin/payroll/decrees/detail?id=${id}`);
  return res.data.decree;
}

export async function finalizeDecree(id: number): Promise<void> {
  await apiPost<{ ok: boolean }>('/admin/payroll/decrees/finalize', { id });
}

export async function deleteDecreeDraft(id: number): Promise<void> {
  await apiPost<{ ok: boolean }>('/admin/payroll/decrees/delete', { id });
}

// ─────────────────── اعتراض به فیش + آیین‌نامه‌ها ───────────────────

export type StaffObjection = {
  id: number; statementId: number; termTitle: string | null; statementStatus: string | null;
  text: string; status: string; reviewNote: string | null; reopenedStatement: number; createdAt: string | null;
};

export type OpenObjection = StaffObjection & { staffName: string; staffCode: string | null; grossAmount: number | null };

export async function getOpenObjections(): Promise<OpenObjection[]> {
  const res = await apiGet<{ ok: boolean; data: { open: OpenObjection[] } }>('/admin/payroll/objections/open');
  return res.data.open;
}

export type ObjectionHistoryRow = StaffObjection & { staffName: string; staffCode: string | null };

export async function getObjectionHistory(): Promise<ObjectionHistoryRow[]> {
  const res = await apiGet<{ ok: boolean; data: { history: ObjectionHistoryRow[] } }>('/admin/payroll/objections/history');
  return res.data.history;
}

export async function reviewObjection(input: { id: number; decision: 'RESOLVED' | 'REJECTED'; reviewNote: string; reopen: boolean }): Promise<void> {
  await apiPost<{ ok: boolean }>('/admin/payroll/objections/review', input);
}

export type RegulationVersion = {
  id: number; code: string; title: string; year: number | null;
  description: string | null; isActive: boolean; createdAt: string | null;
};

export async function getRegulations(): Promise<RegulationVersion[]> {
  const res = await apiGet<{ ok: boolean; data: { rows: RegulationVersion[] } }>('/admin/payroll/regulations');
  return res.data.rows;
}

export async function createRegulation(input: { code: string; title: string; year?: number | null; description?: string | null }): Promise<number> {
  const res = await apiPost<{ ok: boolean; data: { id: number } }>('/admin/payroll/regulations', input);
  return res.data.id;
}

export async function activateRegulation(id: number): Promise<void> {
  await apiPost<{ ok: boolean }>('/admin/payroll/regulations/activate', { id });
}

export async function deleteRegulation(id: number): Promise<void> {
  await apiPost<{ ok: boolean }>('/admin/payroll/regulations/delete', { id });
}

// پروتال استاد
export async function getProfessorPayslip(): Promise<PayslipData> {
  const res = await apiGet<{ ok: boolean; data: PayslipData }>('/professor/payroll/payslip');
  return res.data;
}

export async function getProfessorObjections(): Promise<StaffObjection[]> {
  const res = await apiGet<{ ok: boolean; data: { objections: StaffObjection[] } }>('/professor/payroll/objections');
  return res.data.objections;
}

export async function createProfessorObjection(statementId: number, text: string): Promise<number> {
  const res = await apiPost<{ ok: boolean; data: { id: number } }>('/professor/payroll/objections', { statementId, text });
  return res.data.id;
}
