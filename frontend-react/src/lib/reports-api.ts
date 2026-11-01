// ═══ Financial reports center + student account statement client ═══
import { apiGet, apiPost } from './api';

export type ReportColumn = {
  key: string;
  title: string;
  format?: 'DATE' | 'DATETIME' | 'MONEY' | 'NUMBER';
};

export type ReportResult = {
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  total: number;
  page: number;
  per: number;
  totalPages: number;
  summary?: string;
};

export type ReportOptions = {
  terms: { code: string; title: string | null }[];
  degrees: { id: number; title: string }[];
  faculties: { id: number; name: string }[];
  departments: { id: number; name: string; code: string | null }[];
  majors: { id: number; name: string; code: string | null }[];
  entryYears: number[];
  latestTerm: string;
  universities: { id: number; code: string; title: string; kind: string }[];
};

export type ReportFilters = {
  term?: string;
  degreeId?: number;
  facultyId?: number;
  departmentId?: number;
  majorId?: number;
  entryYear?: number;
  entryYearFrom?: number;
  entryYearTo?: number;
  entryTerm?: number;
  gender?: string;
  quotaType?: string;
  statusScope?: string;
  q?: string;
  nationalCode?: string;
  miss?: string;
  page?: number;
  onlyDebtors?: boolean;
  dossierStatus?: string;
  universityId?: number;
};

export async function getReportOptions(): Promise<ReportOptions> {
  const res = await apiGet<{ ok: boolean; data: ReportOptions }>('/admin/finance/reports/options');
  return res.data;
}

export async function runFinanceReport(kind: string, filters: ReportFilters): Promise<ReportResult> {
  const res = await apiPost<{ ok: boolean; data: ReportResult }>('/admin/finance/reports/run', { kind, filters });
  return res.data;
}

export async function exportFinanceReport(kind: string, filters: ReportFilters): Promise<{ header: string[]; lines: string[][] }> {
  const res = await apiPost<{ ok: boolean; data: { header: string[]; lines: string[][] } }>('/admin/finance/reports/export', { kind, filters });
  return res.data;
}

// ─────────────────── Educational reports center ───────────────────

export async function getEduReportOptions(): Promise<ReportOptions> {
  const res = await apiGet<{ ok: boolean; data: ReportOptions }>('/admin/reports/options');
  return res.data;
}

export async function runEduReport(kind: string, filters: ReportFilters): Promise<ReportResult> {
  const res = await apiPost<{ ok: boolean; data: ReportResult }>('/admin/reports/run', { kind, filters });
  return res.data;
}

export async function exportEduReport(kind: string, filters: ReportFilters): Promise<{ header: string[]; lines: string[][] }> {
  const res = await apiPost<{ ok: boolean; data: { header: string[]; lines: string[][] } }>('/admin/reports/export', { kind, filters });
  return res.data;
}

// ─────────────────── Student account statement ───────────────────

export type PickerStudent = {
  studentId: number;
  studentCode: string | null;
  firstName: string | null;
  lastName: string | null;
  nationalCode: string | null;
  majorTitle: string | null;
  degreeTitle: string | null;
  entryYear: number | null;
  status: string | null;
  balance: number;
  pendingCheques: number;
};

export async function getStatementStudents(): Promise<PickerStudent[]> {
  const res = await apiGet<{ ok: boolean; data: { students: PickerStudent[] } }>('/admin/finance/reports/students');
  return res.data.students;
}

export type StatementRow = {
  termId: number;
  termCode: string;
  termTitle: string;
  tuitionFixed: number;
  tuitionVariable: number;
  discountFixed: number;
  discountVariable: number;
  subjectAdditive: number;
  subjectDeductive: number;
  sponsorship: number;
  payments: number;
  posPayments: number;
  loans: number;
  charges: number;
  discounts: number;
  sponsorships: number;
  canonicalPayments: number;
  chequesCleared: number;
  chequesPending: number;
  chequesBounced: number;
  canonicalLoans: number;
  netPayable: number;
  balance: number;
  courses: {
    courseCode: string | null;
    courseTitle: string | null;
    units: number;
    perUnit: number;
    amount: number;
  }[];
  coursesBasis: 'TARIFF' | 'LEDGER';
};

export type StudentStatementData = {
  rows: StatementRow[];
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
  balance: number;
  student: { name: string; code: string };
};

export async function getStudentStatement(studentId: number): Promise<StudentStatementData> {
  const res = await apiGet<{ ok: boolean; data: StudentStatementData }>(`/admin/finance/reports/student-statement?studentId=${studentId}`);
  return res.data;
}
