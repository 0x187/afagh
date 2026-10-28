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
