// ═══ Sanjesh conversion drill-down client — port of admin/sanjesh/[id]/* + templates/* ═══
//
// Every call hits the /api/v2/admin/sanjesh/* endpoints registered by
// RegisterSanjeshDrilldown (backend-go/internal/httpapi/admin_sanjesh_drilldown.go).
// The backend messages are the reference Persian strings and are shown as-is.

import { ApiError, apiGet, apiPost } from './api';

// ── shared types ──

export type SanjeshFile = {
  id: number;
  universityId: number | null;
  termId: number | null;
  templateId: number | null;
  templateKey: string | null;
  title: string;
  examKind: string | null;
  examYear: number | null;
  fileName: string | null;
  fileSize: number | null;
  encoding: string | null;
  columnCount: number;
  rowCount: number;
  status: string;
  warnings: string[];
  createdAt: string | null;
};

export type SanjeshCounters = {
  total: number;
  pending: number;
  matched: number;
  duplicate: number;
  invalid: number;
  ignored: number;
  unmappedFields: number;
};

export type SanjeshFieldRow = {
  id: number;
  colIndex: number;
  sanjeshTitle: string;
  charCount: number;
  targetField: string | null;
  sampleValue: string | null;
  observedLength: number | null;
  isMapped: boolean;
};

export type SanjeshFieldsView = {
  file: SanjeshFile;
  counters: SanjeshCounters;
  fields: SanjeshFieldRow[];
};

export type SanjeshListRow = {
  id: number;
  rowNo: number;
  fullName: string | null;
  nationalCode: string | null;
  nationalCodeValid: boolean;
  applicantNo: string | null;
  uniqueId: string | null;
  studentId: number | null;
  matchStatus: string;
  matchNote: string | null;
};

export type SanjeshRowsView = {
  file: SanjeshFile;
  counters: SanjeshCounters;
  rows: SanjeshListRow[];
  total: number;
  page: number;
  pages: number;
};

/** dataJson of a row — {fields, columns, meta} exactly like the reference payload */
export type SanjeshRowPayload = {
  fields?: Record<string, string>;
  columns?: Record<string, string>;
  meta?: { templateKey?: string | null; colCount?: number; nationalCodeValid?: boolean };
};

export type SanjeshRowDetail = {
  file: SanjeshFile;
  row: SanjeshListRow;
  dataJson: SanjeshRowPayload;
  rawLine: string;
  rowHash: string | null;
  fields: SanjeshFieldRow[];
};

export type SanjeshReadyRow = {
  id: number;
  rowNo: number;
  fullName: string | null;
  nationalCode: string | null;
  studentId: number | null;
  matchStatus: string;
  matchedAt: string | null;
};

export type SanjeshMatchedView = {
  file: SanjeshFile;
  counters: SanjeshCounters;
  readyRows: SanjeshReadyRow[];
  stagedCount: number;
  readyCount: number;
};

export type SanjeshStagedRow = {
  id: number;
  rowNo: number | null;
  fullName: string | null;
  nationalCode: string | null;
  studentId: number | null;
  status: string | null;
  onboardingStatus: string | null;
  assignedStudentCode: string | null;
  studentCode: string | null;
  matchedAt: string | null;
};

export type SanjeshEnrolledView = {
  file: SanjeshFile;
  staged: SanjeshStagedRow[];
  withCode: number;
};

export type SanjeshValueMapRow = {
  id: number;
  field: string;
  sanjeshValue: string;
  sanjeshLabel: string | null;
  internalValue: string | null;
  internalLabel: string | null;
};

export type SanjeshValuesView = {
  file: SanjeshFile;
  maps: SanjeshValueMapRow[];
};

export type SanjeshDecodeEntry = { value: string; label: string; internalValue?: string };

export type SanjeshTemplate = {
  id: number;
  key: string;
  title: string;
  examKind: string;
  examYear: number;
  columnCount: number;
  pdfRowCount: number;
  columns: { colIndex: number; sanjeshTitle: string; charCount: number; targetField: string | null }[];
  decodeTables: Record<string, SanjeshDecodeEntry[]>;
  expandedRows: { pdfRow: number; title: string; columns: number; charCount: number }[];
  notes: string | null;
  isBuiltin: boolean;
  verifiedWithRealFile: boolean;
  universityId: number | null;
};

export type SanjeshTemplateDetail = {
  template: SanjeshTemplate;
  db: { id: number; isBuiltin: boolean; key: string } | null;
};

export type SanjeshTemplateColumnInput = {
  colIndex: number;
  sanjeshTitle: string;
  charCount: number;
  targetField: string; // '' = unmapped
};

export type SanjeshSaveTemplateInput = {
  id?: number; // 0/undefined = create
  key: string;
  title: string;
  examKind: string;
  examYear: number;
  columns: SanjeshTemplateColumnInput[];
  notes?: string | null;
};

// ── envelope helpers ──

type Envelope<T> = { ok: boolean; message?: string; data?: T; error?: string };

async function call<T>(path: string, body?: unknown): Promise<{ message: string | null; data: T | null }> {
  const res = await apiPost<Envelope<T>>(path, body ?? {});
  return { message: res.message ?? null, data: res.data ?? null };
}

// ── fields page ──

export async function getSanjeshFields(fileId: number): Promise<SanjeshFieldsView> {
  const res = await apiGet<Envelope<SanjeshFieldsView>>(`/admin/sanjesh/files/${fileId}/fields`);
  return res.data as SanjeshFieldsView;
}

export async function saveSanjeshFieldMapping(
  fileId: number,
  updates: { colIndex: number; target: string }[],
): Promise<string> {
  const { message } = await call<Record<string, unknown>>(`/admin/sanjesh/files/${fileId}/field-mapping`, { updates });
  return message ?? 'تغییری ثبت نشد.';
}

export async function autoMapSanjeshFields(fileId: number): Promise<string> {
  const { message } = await call<Record<string, unknown>>(`/admin/sanjesh/files/${fileId}/field-mapping/auto`);
  return message ?? 'نگاشت خودکار انجام شد.';
}

// ── rows pages ──

export async function getSanjeshRows(
  fileId: number,
  opts: { q?: string; status?: string; page?: number } = {},
): Promise<SanjeshRowsView> {
  const p = new URLSearchParams();
  if (opts.q) p.set('q', opts.q);
  if (opts.status) p.set('status', opts.status);
  if (opts.page) p.set('page', String(opts.page));
  const qs = p.toString();
  const res = await apiGet<Envelope<SanjeshRowsView>>(`/admin/sanjesh/files/${fileId}/rows${qs ? `?${qs}` : ''}`);
  return res.data as SanjeshRowsView;
}

export async function getSanjeshRowDetail(fileId: number, rowId: number): Promise<SanjeshRowDetail> {
  const res = await apiGet<Envelope<SanjeshRowDetail>>(`/admin/sanjesh/files/${fileId}/rows/${rowId}`);
  return res.data as SanjeshRowDetail;
}

export async function runSanjeshMatch(fileId: number): Promise<string> {
  const { message } = await call<{ matched: number; unmatched: number; ambiguous: number }>(
    `/admin/sanjesh/files/${fileId}/run-match`,
  );
  return message ?? 'تطبیق انجام شد.';
}

export async function setSanjeshRowStatus(fileId: number, rowId: number, status: string): Promise<string> {
  const { message } = await call<Record<string, unknown>>(`/admin/sanjesh/files/${fileId}/rows/${rowId}/status`, { status });
  return message ?? 'وضعیت ردیف به‌روزرسانی شد.';
}

// ── matched page ──

export async function getSanjeshMatched(fileId: number): Promise<SanjeshMatchedView> {
  const res = await apiGet<Envelope<SanjeshMatchedView>>(`/admin/sanjesh/files/${fileId}/matched`);
  return res.data as SanjeshMatchedView;
}

export async function stageSanjeshMatched(fileId: number): Promise<string> {
  const { message } = await call<{ staged: number; skipped: number }>(`/admin/sanjesh/files/${fileId}/stage`);
  return message ?? 'انتقال انجام شد.';
}

// ── enrolled page ──

export async function getSanjeshEnrolled(fileId: number): Promise<SanjeshEnrolledView> {
  const res = await apiGet<Envelope<SanjeshEnrolledView>>(`/admin/sanjesh/files/${fileId}/enrolled`);
  return res.data as SanjeshEnrolledView;
}

// ── values page ──

export async function getSanjeshValues(fileId: number): Promise<SanjeshValuesView> {
  const res = await apiGet<Envelope<SanjeshValuesView>>(`/admin/sanjesh/files/${fileId}/values`);
  return res.data as SanjeshValuesView;
}

export async function saveSanjeshValueMap(
  fileId: number,
  input: { field: string; sanjeshValue: string; sanjeshLabel?: string; internalValue?: string; internalLabel?: string },
): Promise<string> {
  const { message } = await call<Record<string, unknown>>(`/admin/sanjesh/files/${fileId}/value-maps`, input);
  return message ?? `براورد «${input.sanjeshValue}» ذخیره شد.`;
}

export async function deleteSanjeshValueMap(fileId: number, id: number): Promise<string> {
  const { message } = await call<Record<string, unknown>>(`/admin/sanjesh/files/${fileId}/value-maps/delete`, { id });
  return message ?? 'ردیف براورد حذف شد.';
}

export async function seedSanjeshValueMapsFromTemplate(fileId: number): Promise<string> {
  const { message } = await call<{ count: number }>(`/admin/sanjesh/files/${fileId}/value-maps/seed-from-template`);
  return message ?? 'درج براورد انجام شد.';
}

// ── templates ──

export async function listSanjeshTemplates(): Promise<SanjeshTemplate[]> {
  const res = await apiGet<Envelope<{ templates: SanjeshTemplate[] }>>('/admin/sanjesh/templates');
  return res.data?.templates ?? [];
}

export async function getSanjeshTemplate(key: string): Promise<SanjeshTemplateDetail> {
  const res = await apiGet<Envelope<SanjeshTemplateDetail>>(
    `/admin/sanjesh/templates/detail/${encodeURIComponent(key)}`,
  );
  return res.data as SanjeshTemplateDetail;
}

export async function seedSanjeshBuiltinTemplates(): Promise<string> {
  const { message } = await call<{ inserted: number; skipped: number }>('/admin/sanjesh/templates/seed');
  return message ?? 'قالب‌های پیش‌فرض بررسی شدند.';
}

export async function cloneSanjeshTemplate(input: {
  sourceKey: string;
  newKey: string;
  title: string;
  examYear: number;
}): Promise<{ message: string; id: number | null }> {
  const { message, data } = await call<SanjeshTemplate>('/admin/sanjesh/templates/clone', input);
  return { message: message ?? 'قالب کپی شد.', id: data?.id ?? null };
}

export async function saveSanjeshTemplate(input: SanjeshSaveTemplateInput): Promise<string> {
  const { message } = await call<SanjeshTemplate>('/admin/sanjesh/templates/save', input);
  return message ?? 'قالب ذخیره شد.';
}

export async function buildSanjeshTemplateFromFile(input: {
  file: File;
  key: string;
  title: string;
  examKind: string;
  examYear: number;
}): Promise<{ message: string; id: number | null }> {
  const fd = new FormData();
  fd.set('file', input.file);
  fd.set('key', input.key);
  fd.set('title', input.title);
  fd.set('examKind', input.examKind);
  fd.set('examYear', String(input.examYear));
  let res: Response;
  try {
    res = await fetch('/api/v2/admin/sanjesh/templates/build-from-file', {
      method: 'POST',
      body: fd,
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
  } catch {
    throw new ApiError('ارتباط با سرور برقرار نشد.', 0);
  }
  let payload: Envelope<SanjeshTemplate> | null = null;
  try {
    payload = (await res.json()) as Envelope<SanjeshTemplate>;
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const msg = payload?.error ?? `خطای سرور (${res.status})`;
    throw new ApiError(msg, res.status);
  }
  return { message: payload?.message ?? 'قالب ساخته شد.', id: payload?.data?.id ?? null };
}
