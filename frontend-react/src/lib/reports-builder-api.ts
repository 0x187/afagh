// ═══ Report builder (Wave 2) — saved reports + sources catalog client ═══
//
// Ports admin/reports/saved/types.ts + the client side of actions.ts against the
// Go endpoints: GET/POST /admin/reports/saved, POST /admin/reports/saved/:id/delete,
// POST /admin/reports/saved/:id/run, POST /admin/reports/preview, GET /admin/reports/sources.
import { apiGet, apiPost } from './api';

export type BuilderFieldType = 'text' | 'number' | 'money' | 'date' | 'datetime' | 'bool';

export type BuilderFilterOp =
  | 'eq' | 'ne'
  | 'gt' | 'gte' | 'lt' | 'lte'
  | 'like' | 'in' | 'between'
  | 'isnull' | 'notnull';

export type BuilderAggKind = 'sum' | 'avg' | 'min' | 'max' | 'count' | 'count_distinct';

export type ReportVisibility = 'PRIVATE' | 'ROLE' | 'PUBLIC';

export type BuilderOption = { value: string; label: string };

/** One selectable column of a source — the server never sends SQL here. */
export type SourceFieldMeta = {
  key: string;
  title: string;
  type?: BuilderFieldType;
  format?: 'DATE' | 'DATETIME' | 'MONEY' | 'NUMBER';
  filterable?: boolean;
  ops?: BuilderFilterOp[];
  groupable?: boolean;
  agg?: BuilderAggKind[];
  /** true = the column carries a fixed aggregate (e.g. balance) */
  hasFixedAgg?: boolean;
  options?: BuilderOption[];
  ref?: string;
  hint?: string;
};

export type SourceMeta = {
  key: string;
  title: string;
  icon: string;
  description?: string;
  fields: SourceFieldMeta[];
};

/** Dynamic filter options of the builder page (terms, faculties, …). */
export type BuilderCatalogOptions = {
  terms: BuilderOption[];
  financialTerms: BuilderOption[];
  depositTypes: BuilderOption[];
  ledgerTypes: BuilderOption[];
  paymentStatuses: BuilderOption[];
  faculties: BuilderOption[];
  majors: BuilderOption[];
};

/** The stored report definition (jsonb in saved_reports.config). */
export type SavedReportConfig = {
  columns: {
    field: string;
    alias?: string;
    format?: 'DATE' | 'DATETIME' | 'MONEY' | 'NUMBER';
    agg?: BuilderAggKind;
  }[];
  filters: { field: string; op: BuilderFilterOp; value?: string | string[] }[];
  groupBy?: string[];
  orderBy?: { field: string; dir: 'asc' | 'desc' }[];
};

/** A saved report row as seen by the caller (including isOwner). */
export type SavedReportRow = {
  id: number;
  name: string;
  description: string | null;
  sourceKey: string;
  sourceTitle: string;
  sourceIcon: string;
  visibility: ReportVisibility;
  allowedRoles: string[];
  ownerUserId: number;
  ownerName: string;
  isOwner: boolean;
  createdAt: string;
  updatedAt: string;
  config: SavedReportConfig;
};

/** One page of engine output — column keys keep the original catalog case. */
export type BuilderResult = {
  columns: { key: string; title: string; format?: 'DATE' | 'DATETIME' | 'MONEY' | 'NUMBER' }[];
  rows: Record<string, unknown>[];
  total: number;
  page: number;
  per: number;
  totalPages: number;
  notes?: string[];
};

export async function getBuilderCatalog(): Promise<{ sources: SourceMeta[]; options: BuilderCatalogOptions }> {
  const res = await apiGet<{ ok: boolean; sources: SourceMeta[]; options: BuilderCatalogOptions }>('/admin/reports/sources');
  return { sources: res.sources, options: res.options };
}

export async function listSavedReports(): Promise<SavedReportRow[]> {
  const res = await apiGet<{ ok: boolean; rows: SavedReportRow[] }>('/admin/reports/saved');
  return res.rows;
}

export type SaveSavedReportInput = {
  id?: number;
  name: string;
  description?: string;
  sourceKey: string;
  config: SavedReportConfig;
  visibility: ReportVisibility;
  allowedRoles?: string[];
};

export async function saveSavedReport(input: SaveSavedReportInput): Promise<number> {
  const res = await apiPost<{ ok: boolean; id: number }>('/admin/reports/saved', input);
  return res.id;
}

export async function deleteSavedReport(id: number): Promise<void> {
  await apiPost<{ ok: boolean }>(`/admin/reports/saved/${id}/delete`);
}

export async function runSavedReport(id: number, page = 1): Promise<BuilderResult> {
  const res = await apiPost<{ ok: boolean; data: BuilderResult }>(`/admin/reports/saved/${id}/run`, { page });
  return res.data;
}

export async function previewBuilderReport(sourceKey: string, config: SavedReportConfig, page = 1): Promise<BuilderResult> {
  const res = await apiPost<{ ok: boolean; data: BuilderResult }>('/admin/reports/preview', { sourceKey, config, page });
  return res.data;
}
