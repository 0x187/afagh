// ═══ کلاینت مهاجرت داده/سهام/ثمین ═══
import { apiGet, apiPost } from './api';

// ── مهاجرت ──
export type MigSource = { code: string; title: string; kind: string; note?: string };
export type MigBatch = Record<string, unknown>;
export type MigReport = {
  total: number; inserted: number; updated: number; invalid: number;
  errors: { row: number; msg: string }[]; sample?: Record<string, unknown>[];
};

export const getMigrationOverview = (sourceCode: string) =>
  apiGet<{ ok: boolean; data: Record<string, unknown> }>(`/admin/migration/overview?sourceCode=${encodeURIComponent(sourceCode)}`).then((r) => r.data);
export const getMigrationSources = () =>
  apiGet<{ ok: boolean; data: { sources: MigSource[] } }>('/admin/migration/sources').then((r) => r.data.sources);
export const saveMigrationSource = (input: { code: string; title: string; kind: string; note: string }) =>
  apiPost('/admin/migration/sources', input);
export const getMigrationBatches = (sourceCode: string) =>
  apiGet<{ ok: boolean; data: { batches: MigBatch[] } }>(`/admin/migration/batches?sourceCode=${encodeURIComponent(sourceCode)}`).then((r) => r.data.batches);
export const getMigrationBatchRows = (batchId: number, status = '') =>
  apiGet<{ ok: boolean; data: { rows: Record<string, unknown>[] } }>(`/admin/migration/batch/rows?batchId=${batchId}&status=${status}`).then((r) => r.data.rows);
export const deleteMigrationBatch = (batchId: number) =>
  apiPost('/admin/migration/batch/delete', { batchId });
export const getGradeCompare = (sourceCode: string, termCode: string) =>
  apiGet<{ ok: boolean; data: Record<string, unknown> }>(`/admin/migration/grades/compare?sourceCode=${encodeURIComponent(sourceCode)}&termCode=${encodeURIComponent(termCode)}`).then((r) => r.data);
export const applyMigrationGrades = (input: { sourceCode: string; termCode: string; statuses: string[]; overwrite: boolean }) =>
  apiPost<{ ok: boolean; data: Record<string, unknown> }>('/admin/migration/grades/apply', input).then((r) => r.data);
export const clearGradeStaging = (sourceCode: string) =>
  apiPost<{ ok: boolean; data: { deleted: number } }>('/admin/migration/grades/clear', { sourceCode });
export const getMigrationCodeMap = (sourceCode: string, domain: string) =>
  apiGet<{ ok: boolean; data: Record<string, unknown> }>(`/admin/migration/codemap?sourceCode=${encodeURIComponent(sourceCode)}&domain=${encodeURIComponent(domain)}`).then((r) => r.data);
export const saveMigrationMap = (id: number, targetCode: string | null, status: string) =>
  apiPost('/admin/migration/codemap/save', { id, targetCode, status });
export const confirmMigrationSuggestions = (sourceCode: string, domain: string, minScore = 80) =>
  apiPost<{ ok: boolean; data: { confirmed: number } }>('/admin/migration/codemap/confirm', { sourceCode, domain, minScore }).then((r) => r.data);
export const autoSuggestMigration = (sourceCode: string, domain: string) =>
  apiPost<{ ok: boolean; data: { suggested: number; confirmed: number; untouched: number } }>('/admin/migration/codemap/auto-suggest', { sourceCode, domain }).then((r) => r.data);
export const getMigrationFormulas = (sourceCode: string) =>
  apiGet<{ ok: boolean; data: { formulas: Record<string, unknown>[] } }>(`/admin/migration/formulas?sourceCode=${encodeURIComponent(sourceCode)}`).then((r) => r.data.formulas);
export const compareMigrationFormulas = (input: { sourceCode: string; termCode: string; tolerance: number }) =>
  apiPost<{ ok: boolean; data: Record<string, unknown> }>('/admin/migration/formulas/compare', input).then((r) => r.data);
export const applyMigrationFormulas = (sourceCode: string) =>
  apiPost<{ ok: boolean; data: { applied: number } }>('/admin/migration/formulas/apply', { sourceCode }).then((r) => r.data);
export const rollbackMigration = (input: { batchId: number | null; opGroup: string; sourceCode: string; force: boolean }) =>
  apiPost<{ ok: boolean; data: Record<string, unknown> }>('/admin/migration/rollback', input).then((r) => r.data);

export async function importMigrationFile(kind: string, sourceCode: string, file: File): Promise<MigReport> {
  const fd = new FormData();
  fd.set('kind', kind);
  fd.set('sourceCode', sourceCode);
  fd.set('file', file);
  let res: Response;
  try {
    res = await fetch('/api/v2/admin/migration/import', { method: 'POST', body: fd, credentials: 'same-origin', headers: { Accept: 'application/json' } });
  } catch {
    throw new Error('ارتباط با سرور برقرار نشد.');
  }
  const payload = await res.json().catch(() => null);
  if (!res.ok || !payload?.ok) throw new Error(payload?.error || `خطای سرور (${res.status})`);
  return payload.data as MigReport;
}

// ── سهام ──
export type SahamStats = {
  universityId: number; code: string; title: string; isDissolved: boolean;
  students: number; graduates: number; instructors: number; sahamCodeCount: number;
  fill: { studyType: number; teachingMode: number; maritalStatus: number; birthProvince: number; residenceProvince: number };
};
export type SahamData = {
  stats: SahamStats[];
  lookups: {
    statuses: { universityId: number; status: string; n: number }[];
    majors: { universityId: number; id: number; name: string }[];
    faculties: { universityId: number; id: number; name: string }[];
    terms: { universityId: number; id: number; termCode: string; title: string; isCurrent: number }[];
    entryYears: { universityId: number; min: number | null; max: number | null }[];
  };
  totals: { students: number; graduates: number; instructors: number; withCode: number };
};
export const getSahamData = () => apiGet<{ ok: boolean; data: SahamData }>('/admin/saham').then((r) => r.data);
export type SahamSettingsRow = { id: number; universityId: number; facultyId: number | null; title: string; code: string; provinceCode: string };
export const getSahamSettings = () => apiGet<{ ok: boolean; data: Record<string, unknown> }>('/admin/saham/settings').then((r) => r.data);
export const saveSahamInstituteCode = (input: Record<string, unknown>) =>
  apiPost<{ ok: boolean; data: { id: number } }>('/admin/saham/settings', input).then((r) => r.data);
export const deleteSahamInstituteCode = (id: number) => apiPost('/admin/saham/settings/delete', { id });
export type SahamExportResult = { csv: string; fileName: string; count: number; total: number; hasMore: boolean };
export const exportSaham = (input: Record<string, unknown>) =>
  apiPost<{ ok: boolean; data: SahamExportResult }>('/admin/saham/export', input).then((r) => r.data);

// ── ثمین ──
export type SaminOverview = {
  university: { id: number; code: string; title: string };
  universities: { id: number; code: string; title: string }[];
  queueByUni: Record<string, number>;
  totalStaging: number;
  staging: { id: number; personPkInSource: string | null; status: string; traceId: number | null; createdAt: string | null }[];
  logs: { id: number; traceId: number | null; status: string; summaryResult: unknown; createdAt: string | null }[];
};
export const getSaminOverview = (uni?: string) =>
  apiGet<{ ok: boolean; data: SaminOverview }>(`/admin/samin${uni ? `?uni=${encodeURIComponent(uni)}` : ''}`).then((r) => r.data);
export const saminEnqueue = (universityId: number) =>
  apiPost<{ ok: boolean; data: { inserted: number; skipped: number } }>('/admin/samin/enqueue', { universityId }).then((r) => r.data);
export const saminSend = (universityId: number, entityCode = '1000') =>
  apiPost<{ ok: boolean; data: Record<string, unknown> }>('/admin/samin/send', { universityId, entityCode }).then((r) => r.data);
export const saminSendSample = (universityId: number, count = 2) =>
  apiPost<{ ok: boolean; data: Record<string, unknown> }>('/admin/samin/sample', { universityId, count }).then((r) => r.data);
export const saminTrace = (universityId: number, traceId: number) =>
  apiPost<{ ok: boolean; data: Record<string, unknown> }>('/admin/samin/trace', { universityId, traceId }).then((r) => r.data);
