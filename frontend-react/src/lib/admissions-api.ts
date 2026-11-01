// ═══ Admission client (assessment/formula/manual entry/IranDoc) ═══
import { apiGet, apiPost } from './api';

export type StagingItem = {
  id: number;
  nationalCode: string;
  fullName: string | null;
  mappedMajorId: number | null;
  mappedMajorName: string | null;
  status: string | null;
  quotaType: string | null;
  studentId: number | null;
  mobile: string | null;
  rawSanjeshData: {
    firstName?: string;
    lastName?: string;
    sanjeshCode?: string;
    quota?: string;
    rank?: number;
    mobile?: string;
    examType?: string;
    degreeLevel?: string;
    majorGroup?: string;
    universityCode?: string;
  };
};

export type SanjeshMappingItem = {
  id: number;
  sanjeshCode: string;
  internalMajorId: number | null;
  majorName?: string;
  sanjeshQuota: string | null;
};

export type MajorOption = { id: number; name: string; majorCode: string | null; degreeLevelId: number | null };
export type DegreeLevelOption = { id: number; title: string; code: string };
export type FormulaItem = { degreeLevelId: number | null; degreeTitle?: string; formula: string; currentSequence: number | null };
export type ApiAuditItem = {
  id: number; serviceName: string; requestUrl: string; responseStatus: number | null;
  durationMs: number | null; isSuccess: number | null; executedAt: string | null;
};

export type AdmissionsBundle = {
  stagingList: StagingItem[];
  mappings: SanjeshMappingItem[];
  majors: MajorOption[];
  degreeLevels: DegreeLevelOption[];
  formulas: FormulaItem[];
  apiLogs: ApiAuditItem[];
};

export type StagedRow = { id: number; nationalCode: string; fullName: string; sanjeshCode: string; status: string; mappedMajorName: string | null };

export async function getAdmissionsBundle(): Promise<AdmissionsBundle> {
  const res = await apiGet<{ ok: boolean; data: AdmissionsBundle }>('/admin/admissions');
  return res.data;
}

export async function stageSanjesh(rawText: string, entryYear = 1405): Promise<{ count: number; items: StagedRow[] }> {
  const res = await apiPost<{ ok: boolean; data: { count: number; items: StagedRow[] } }>('/admin/admissions/stage', { rawText, entryYear });
  return res.data;
}

export async function importStaged(ids: number[]): Promise<{
  imported: { stagingId: number; studentCode: string; fullName: string; nationalCode: string }[];
  failures: { stagingId: number; error: string }[];
}> {
  const res = await apiPost<{ ok: boolean; data: { imported: { stagingId: number; studentCode: string; fullName: string; nationalCode: string }[]; failures: { stagingId: number; error: string }[] } }>('/admin/admissions/import', { ids });
  return res.data;
}

export async function saveSanjeshMapping(sanjeshCode: string, internalMajorId: number, quota?: string): Promise<void> {
  await apiPost('/admin/admissions/mapping', { sanjeshCode, internalMajorId, quota });
}

export async function saveStudentIdFormula(degreeLevelId: number, formula: string): Promise<void> {
  await apiPost('/admin/admissions/formula', { degreeLevelId, formula });
}

export type ManualAdmissionInput = {
  nationalCode: string;
  firstName: string;
  lastName: string;
  mobile: string;
  majorId: number;
  degreeLevelId: number;
  entryYear?: number;
  entryTerm?: number;
  quotaType?: string;
  admissionType?: 'NORMAL' | 'TRANSFER' | 'INTERNATIONAL' | 'FREE_COURSE';
};

export async function registerManualStudent(input: ManualAdmissionInput): Promise<{ studentId: number; userId: number; studentCode: string; fullName: string }> {
  const res = await apiPost<{ ok: boolean; data: { student: { studentId: number; userId: number; studentCode: string; fullName: string } } }>('/admin/admissions/manual', input);
  return res.data.student;
}

export type IrandocResult = {
  status: string; similarityPercentage: number; maxAllowedThreshold: number;
  certificateUrl: string; trackingCode: string; thesisTitle: string;
  decision: string; message: string; durationMs?: number;
};

export async function testIrandoc(input: { nationalCode: string; trackingCode: string; thesisTitle: string; maxAllowedThreshold?: number }): Promise<IrandocResult> {
  const res = await apiPost<{ ok: boolean; data: { result: IrandocResult } }>('/admin/admissions/irandoc-test', input);
  return res.data.result;
}
