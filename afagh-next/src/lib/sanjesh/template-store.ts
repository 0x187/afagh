/**
 * مخزن قالب‌های سنجش — **قالب‌ها در دیتابیس زندگی می‌کنند، نه در کد.**
 *
 * چرا: هر سال چند فیلد به ساختار فایل سنجش اضافه یا کم می‌شود. اگر قالب فقط
 * در کد باشد، هر تغییر سالانه یک انتشار نرم‌افزاری لازم دارد. پس:
 *
 *   - قالب‌های کد (`templates.ts`) فقط **پیش‌فرض اولیه** هستند و یک‌بار seed می‌شوند.
 *   - مدیر می‌تواند قالب تازه بسازد: از روی فایل بارگذاری‌شده، دستی، یا با
 *     کلون‌کردن یک قالب موجود برای سال جدید.
 *   - قالب `isBuiltin` قابل ویرایش نیست (فقط کلون) تا مرجع اصلی خراب نشود.
 *
 * خواندن: دیتابیس اول، در نبودِ آن قالب کد (fallback) — تا اگر مهاجرت هنوز
 * اجرا نشده باشد، پارس فایل همچنان کار کند.
 */

import { and, asc, eq, isNull, or, sql } from 'drizzle-orm';

import { db } from '@/db';
import { sanjesh_templates } from '@/db/schema';
import { SANJESH_TEMPLATE_MAP, SANJESH_TEMPLATES, type SanjeshTemplate } from './templates';
import type { SanjeshParseResult } from './parse';

export interface TemplateColumnInput {
  colIndex: number;
  sanjeshTitle: string;
  charCount: number;
  targetField: string | null;
}

export interface SaveTemplateInput {
  id?: number | null;
  key: string;
  title: string;
  examKind: string;
  examYear: number;
  pdfRowCount?: number | null;
  columns: TemplateColumnInput[];
  decodeTables?: Record<string, { value: string; label: string; internalValue?: string }[]>;
  expandedRows?: { pdfRow: number; title: string; columns: number; charCount: number }[];
  notes?: string | null;
  universityId?: number | null;
  createdByUserId?: number | null;
}

export interface TemplateValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

/* ------------------------------------------------------------------ */
/* اعتبارسنجی                                                         */
/* ------------------------------------------------------------------ */

/** قالب باید ستون‌های پیوسته از ۱، فیلد مقصد یکتا، و حداقل یک ستون داشته باشد. */
export function validateTemplateColumns(columns: TemplateColumnInput[]): TemplateValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (columns.length === 0) errors.push('قالب باید حداقل یک ستون داشته باشد.');

  const sorted = [...columns].sort((a, b) => a.colIndex - b.colIndex);
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].colIndex !== i + 1) {
      errors.push(`شمارهٔ ستون‌ها باید از ۱ پیوسته باشد (ستون ${i + 1} شمارهٔ ${sorted[i].colIndex} دارد).`);
      break;
    }
  }

  const seen = new Map<string, number>();
  for (const c of sorted) {
    if (!c.targetField) continue; // نگاشت‌نشده مجاز است
    const prev = seen.get(c.targetField);
    if (prev !== undefined) {
      errors.push(`فیلد «${c.targetField}» در ستون‌های ${prev} و ${c.colIndex} تکراری است — مقدار دومی اولی را بازنویسی می‌کند.`);
    }
    seen.set(c.targetField, c.colIndex);
  }

  const unmapped = sorted.filter((c) => !c.targetField).length;
  if (unmapped > 0) warnings.push(`${unmapped} ستون بدون فیلد مقصد است؛ داده‌اش خام ذخیره می‌شود ولی در تطبیق استفاده نمی‌شود.`);

  const noTitle = sorted.filter((c) => !c.sanjeshTitle?.trim()).length;
  if (noTitle > 0) errors.push(`${noTitle} ستون عنوان ندارد.`);

  const badLen = sorted.filter((c) => !Number.isFinite(c.charCount) || c.charCount < 0).length;
  if (badLen > 0) errors.push(`${badLen} ستون طول نامعتبر دارد.`);

  return { ok: errors.length === 0, errors, warnings };
}

/* ------------------------------------------------------------------ */
/* خواندن                                                             */
/* ------------------------------------------------------------------ */

type TemplateRow = typeof sanjesh_templates.$inferSelect;

function rowToTemplate(row: TemplateRow): SanjeshTemplate {
  const columns = (row.columnsJson as TemplateColumnInput[]) ?? [];
  return {
    key: row.key,
    title: row.title,
    examKind: row.examKind as SanjeshTemplate['examKind'],
    examYear: row.examYear,
    columnCount: row.columnCount,
    pdfRowCount: row.pdfRowCount ?? columns.length,
    expandedRows: (row.expandedRowsJson as SanjeshTemplate['expandedRows']) ?? [],
    columns: columns
      .slice()
      .sort((a, b) => a.colIndex - b.colIndex)
      .map((c) => ({
        colIndex: c.colIndex,
        sanjeshTitle: c.sanjeshTitle,
        charCount: c.charCount,
        // ستون نگاشت‌نشده با کلید `extra_<n>` ذخیره می‌شود تا داده از دست نرود
        targetField: (c.targetField ?? `extra_${c.colIndex}`) as SanjeshTemplate['columns'][number]['targetField'],
      })),
    decodeTables: (row.decodeTablesJson as SanjeshTemplate['decodeTables']) ?? {},
    verifiedWithRealFile: row.verifiedWithRealFile,
  };
}

/** همهٔ قالب‌های فعال — دیتابیس، و در نبودِ رکورد، پیش‌فرض‌های کد. */
export async function listTemplates(universityId?: number | null): Promise<SanjeshTemplate[]> {
  let rows: TemplateRow[] = [];
  try {
    const where = universityId
      ? and(eq(sanjesh_templates.isActive, true), or(isNull(sanjesh_templates.universityId), eq(sanjesh_templates.universityId, universityId)))
      : eq(sanjesh_templates.isActive, true);
    rows = await db.select().from(sanjesh_templates).where(where).orderBy(asc(sanjesh_templates.examYear), asc(sanjesh_templates.key));
  } catch {
    // جدول هنوز ساخته نشده (مهاجرت اجرا نشده) — fallback به قالب‌های کد
    return SANJESH_TEMPLATES;
  }

  const fromDb = rows.map(rowToTemplate);
  const dbKeys = new Set(fromDb.map((t) => t.key));
  // قالب‌های کد که در دیتابیس نیستند هم برگردانده می‌شوند
  const missing = SANJESH_TEMPLATES.filter((t) => !dbKeys.has(t.key));
  return [...fromDb, ...missing].sort((a, b) => a.examYear - b.examYear || a.key.localeCompare(b.key));
}

/**
 * یک قالب با کلید — **در دامنهٔ دانشگاه**.
 * ترتیب: قالب اختصاصی همان دانشگاه → قالب سراسری (`universityId` تهی) → قالب کد.
 */
export async function loadTemplateByKey(key: string, universityId?: number | null): Promise<SanjeshTemplate | null> {
  try {
    const rows = await db
      .select()
      .from(sanjesh_templates)
      .where(eq(sanjesh_templates.key, key))
      .orderBy(sql`CASE WHEN ${sanjesh_templates.universityId} = ${universityId ?? -1} THEN 0 ELSE 1 END`)
      .limit(5);
    // اولویت: قالب همان دانشگاه، بعد قالب سراسری
    const own = rows.find((r) => r.universityId != null && r.universityId === universityId);
    const global = rows.find((r) => r.universityId == null);
    const pick = own ?? global;
    if (pick) return rowToTemplate(pick);
  } catch {
    /* جدول موجود نیست — ادامه با قالب کد */
  }
  return SANJESH_TEMPLATE_MAP[key] ?? null;
}

/** یک قالب با شناسهٔ عددی */
export async function loadTemplateById(id: number): Promise<SanjeshTemplate | null> {
  try {
    const [row] = await db.select().from(sanjesh_templates).where(eq(sanjesh_templates.id, id)).limit(1);
    return row ? rowToTemplate(row) : null;
  } catch {
    return null;
  }
}

/** شناسهٔ عددی قالب از کلید (برای ذخیره در `sanjesh_files.templateId`) */
export async function templateIdOf(key: string): Promise<number | null> {
  try {
    const [row] = await db
      .select({ id: sanjesh_templates.id })
      .from(sanjesh_templates)
      .where(eq(sanjesh_templates.key, key))
      .limit(1);
    return row?.id ?? null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* نوشتن                                                              */
/* ------------------------------------------------------------------ */

/** ساخت/به‌روزرسانی قالب. قالب پیش‌فرض قابل ویرایش نیست. */
export async function saveTemplate(input: SaveTemplateInput): Promise<{ id: number }> {
  const v = validateTemplateColumns(input.columns);
  if (!v.ok) throw new Error(v.errors.join(' '));

  const columns = [...input.columns].sort((a, b) => a.colIndex - b.colIndex);

  if (input.id) {
    const [existing] = await db.select().from(sanjesh_templates).where(eq(sanjesh_templates.id, input.id)).limit(1);
    if (!existing) throw new Error('قالب یافت نشد.');
    if (existing.isBuiltin) throw new Error('قالب پیش‌فرض قابل ویرایش نیست؛ ابتدا آن را کپی کنید.');
    await db
      .update(sanjesh_templates)
      .set({
        title: input.title,
        examKind: input.examKind,
        examYear: input.examYear,
        pdfRowCount: input.pdfRowCount ?? null,
        columnCount: columns.length,
        columnsJson: columns,
        decodeTablesJson: input.decodeTables ?? {},
        expandedRowsJson: input.expandedRows ?? [],
        notes: input.notes ?? null,
        updatedAt: new Date(),
      })
      .where(eq(sanjesh_templates.id, input.id));
    return { id: input.id };
  }

  const [created] = await db
    .insert(sanjesh_templates)
    .values({
      key: input.key,
      title: input.title,
      examKind: input.examKind,
      examYear: input.examYear,
      pdfRowCount: input.pdfRowCount ?? null,
      columnCount: columns.length,
      columnsJson: columns,
      decodeTablesJson: input.decodeTables ?? {},
      expandedRowsJson: input.expandedRows ?? [],
      notes: input.notes ?? null,
      isBuiltin: false,
      verifiedWithRealFile: false,
      universityId: input.universityId ?? null,
      createdByUserId: input.createdByUserId ?? null,
    })
    .returning({ id: sanjesh_templates.id });
  return { id: created.id };
}

/** کلون یک قالب (معمولاً پیش‌فرض) به قالبی قابل ویرایش برای سال جدید — در دامنهٔ همان دانشگاه. */
export async function cloneTemplate(
  sourceKey: string,
  newKey: string,
  title: string,
  examYear: number,
  createdByUserId?: number | null,
  universityId?: number | null,
): Promise<{ id: number }> {
  const src = await loadTemplateByKey(sourceKey, universityId ?? null);
  if (!src) throw new Error(`قالب مبدأ «${sourceKey}» یافت نشد.`);
  return saveTemplate({
    key: newKey,
    title,
    examKind: src.examKind,
    examYear,
    pdfRowCount: src.pdfRowCount,
    columns: src.columns.map((c) => ({
      colIndex: c.colIndex,
      sanjeshTitle: c.sanjeshTitle,
      charCount: c.charCount,
      targetField: c.targetField.startsWith('extra_') ? null : c.targetField,
    })),
    decodeTables: src.decodeTables,
    expandedRows: src.expandedRows,
    createdByUserId: createdByUserId ?? null,
    universityId: universityId ?? null,
  });
}

/**
 * ساخت قالب از روی یک فایل بارگذاری‌شده.
 * عنوان و طول هر ستون از خود فایل گرفته می‌شود؛ فیلد مقصد خالی می‌ماند تا
 * مدیر آن را در صفحهٔ «تطبیق فیلدها» تعیین کند.
 */
export async function buildTemplateFromParse(
  parsed: SanjeshParseResult,
  meta: { key: string; title: string; examKind: string; examYear: number; createdByUserId?: number | null; universityId?: number | null },
): Promise<{ id: number }> {
  const columns: TemplateColumnInput[] = [];
  for (let c = 1; c <= parsed.colCount; c++) {
    const observed = parsed.observedLengths[String(c)] ?? 0;
    const sample = parsed.samples[String(c)] ?? '';
    columns.push({
      colIndex: c,
      sanjeshTitle: `ستون ${c}${sample ? ` — ${sample.slice(0, 40)}` : ''}`,
      charCount: observed,
      targetField: null,
    });
  }
  return saveTemplate({
    key: meta.key,
    title: meta.title,
    examKind: meta.examKind,
    examYear: meta.examYear,
    pdfRowCount: columns.length,
    columns,
    decodeTables: {},
    createdByUserId: meta.createdByUserId ?? null,
    universityId: meta.universityId ?? null,
    notes: 'ساخته‌شده به‌طور خودکار از روی فایل بارگذاری‌شده — فیلدهای مقصد نیاز به تعیین دارند.',
  });
}

/** درج قالب‌های پیش‌فرض کد در دیتابیس (idempotent). */
export async function seedBuiltinTemplates(): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;
  for (const t of SANJESH_TEMPLATES) {
    const [existing] = await db
      .select({ id: sanjesh_templates.id })
      .from(sanjesh_templates)
      .where(eq(sanjesh_templates.key, t.key))
      .limit(1);
    if (existing) {
      skipped++;
      continue;
    }
    await db.insert(sanjesh_templates).values({
      key: t.key,
      title: t.title,
      examKind: t.examKind,
      examYear: t.examYear,
      columnCount: t.columnCount,
      pdfRowCount: t.pdfRowCount,
      columnsJson: t.columns.map((c) => ({
        colIndex: c.colIndex,
        sanjeshTitle: c.sanjeshTitle,
        charCount: c.charCount,
        targetField: c.targetField,
      })),
      decodeTablesJson: t.decodeTables,
      expandedRowsJson: t.expandedRows,
      isBuiltin: true,
      verifiedWithRealFile: t.verifiedWithRealFile,
    });
    inserted++;
  }
  return { inserted, skipped };
}

/** آیا این کلید در دامنهٔ همین دانشگاه (یا سراسری) قبلاً استفاده شده است؟ */
export async function templateKeyExists(key: string, universityId?: number | null): Promise<boolean> {
  try {
    const rows = await db
      .select({ id: sanjesh_templates.id, universityId: sanjesh_templates.universityId })
      .from(sanjesh_templates)
      .where(eq(sanjesh_templates.key, key));
    return rows.some((r) => r.universityId == null || r.universityId === (universityId ?? null));
  } catch {
    return Boolean(SANJESH_TEMPLATE_MAP[key]);
  }
}
