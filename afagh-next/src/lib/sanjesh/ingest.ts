/**
 * موتور ورود فایل سنجش به دیتابیس
 * -------------------------------
 * اصل: **هیچ داده‌ای دور ریخته نمی‌شود.**
 *
 *   rawLine   → خط اصلی فایل، بیت‌به‌بیت
 *   dataJson  → { fields: {targetField}, columns: {"1": …}, meta }
 *
 * چون `columns` همهٔ ستون‌های خام را نگه می‌دارد، تغییر «تطبیق فیلدها» پس از
 * بارگذاری **نیازی به خواندن دوبارهٔ فایل ندارد** — با `remapFileRows` فیلدها
 * از همان ستون‌های ذخیره‌شده بازسازی می‌شوند.
 */

import { and, eq, inArray, sql } from 'drizzle-orm';

import { db } from '@/db';
import {
  admissions_staging,
  sanjesh_file_fields,
  sanjesh_file_rows,
  sanjesh_files,
  sanjesh_mappings,
  students,
} from '@/db/schema';
import { universityScope } from './access';
import { blindIndex, encryptPii } from '@/lib/pii';
import { buildRowPayload, parseSanjeshFile, rowFingerprint, type SanjeshParseResult } from './parse';
import { detectTemplateByColumnCount, type SanjeshTemplate } from './templates';
import { loadTemplateByKey, templateIdOf } from './template-store';

/** پیشوند context شاخص کور — هرگز تغییر نکند، وگرنه همهٔ شاخص‌ها بی‌اعتبار می‌شوند. */
const NC_CONTEXT = 'sanjesh_file_rows.nationalCode';

export interface IngestInput {
  buffer: Uint8Array;
  fileName: string;
  title: string;
  templateKey?: string | null;
  examKind?: string | null;
  examYear?: number | null;
  termId?: number | null;
  degreeLevelId?: number | null;
  universityId?: number | null;
  userId?: number | null;
  /** حداکثر ردیف برای بارگذاری آزمایشی (null = همه) */
  limit?: number | null;
}

export interface IngestResult {
  fileId: number;
  templateKey: string | null;
  encoding: string;
  columnCount: number;
  rowCount: number;
  extraColumns: number[];
  missingColumns: number[];
  warnings: string[];
  mappedFields: number;
  unmappedFields: number;
  invalidNationalCodes: number;
  duplicatesInFile: number;
}

/** SHA-256 برای تشخیص بارگذاری تکراری */
async function sha256Hex(buf: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buf as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * بارگذاری یک فایل سنجش: پارس → ثبت فایل → ثبت تطبیق فیلدها → ثبت همهٔ ردیف‌ها.
 * همهٔ مراحل در یک تراکنش تا فایل نیمه‌کاره نماند.
 */
export async function ingestSanjeshFile(input: IngestInput): Promise<IngestResult> {
  // ── ۱. تعیین قالب ──
  let template: SanjeshTemplate | null = null;
  if (input.templateKey) {
    template = await loadTemplateByKey(input.templateKey);
    if (!template) throw new Error(`قالب «${input.templateKey}» یافت نشد.`);
  }

  // ── ۲. پارس ──
  const parsed: SanjeshParseResult = parseSanjeshFile(input.buffer, template);

  // بدون قالب صریح: تلاش برای تشخیص از تعداد ستون
  if (!template) {
    const guessed = detectTemplateByColumnCount(parsed.colCount);
    if (guessed) {
      template = guessed;
      // پارس دوباره با قالب تشخیص‌داده‌شده تا فیلدها نگاشت شوند
      const re = parseSanjeshFile(input.buffer, guessed);
      Object.assign(parsed, re);
    }
  }

  if (parsed.rowCount === 0) throw new Error('فایل هیچ ردیف معتبری ندارد.');

  const rows = input.limit && input.limit > 0 ? parsed.rows.slice(0, input.limit) : parsed.rows;
  const fileHash = await sha256Hex(input.buffer);
  const templateId = template ? await templateIdOf(template.key) : null;

  // ── ۳. ثبت در دیتابیس ──
  return db.transaction(async (tx) => {
    const [file] = await tx
      .insert(sanjesh_files)
      .values({
        universityId: input.universityId ?? null,
        termId: input.termId ?? null,
        degreeLevelId: input.degreeLevelId ?? null,
        templateId,
        templateKey: template?.key ?? null,
        title: input.title,
        examKind: input.examKind ?? template?.examKind ?? null,
        examYear: input.examYear ?? template?.examYear ?? null,
        fileName: input.fileName,
        fileSize: input.buffer.byteLength,
        fileHash,
        encoding: parsed.encoding,
        columnCount: parsed.colCount,
        rowCount: rows.length,
        status: 'FIELDS_READY',
        warningsJson: parsed.warnings,
        uploadedByUserId: input.userId ?? null,
      })
      .returning({ id: sanjesh_files.id });

    const fileId = file.id;
    const uniId = input.universityId ?? null;

    // ── ۴. تطبیق فیلدها (یک ردیف برای هر ستون فایل) ──
    const fieldRows = [];
    for (let c = 1; c <= parsed.colCount; c++) {
      const def = template?.columns.find((x) => x.colIndex === c);
      const sample = parsed.samples[String(c)] ?? null;
      fieldRows.push({
        fileId,
        universityId: uniId,
        colIndex: c,
        sanjeshTitle: def?.sanjeshTitle ?? `ستون ${c}`,
        charCount: def?.charCount ?? parsed.observedLengths[String(c)] ?? 0,
        targetField: def && !def.targetField.startsWith('extra_') ? def.targetField : null,
        sampleValue: sample,
        observedLength: parsed.observedLengths[String(c)] ?? null,
        isMapped: Boolean(def && !def.targetField.startsWith('extra_')),
      });
    }
    if (fieldRows.length) await tx.insert(sanjesh_file_fields).values(fieldRows);

    // ── ۵. ثبت همهٔ ردیف‌ها با دادهٔ کامل ──
    const seenHashes = new Map<string, number>();
    let invalidNationalCodes = 0;
    let duplicatesInFile = 0;

    const rowValues = rows.map((r) => {
      const payload = buildRowPayload(r, template?.key ?? null, parsed.colCount);
      const fp = rowFingerprint(r);
      let dup = false;
      if (seenHashes.has(fp)) {
        dup = true;
        duplicatesInFile++;
      } else {
        seenHashes.set(fp, r.rowNo);
      }
      if (r.nationalCode && !r.nationalCodeValid) invalidNationalCodes++;

      const nc = r.nationalCode;
      return {
        fileId,
        universityId: uniId,
        rowNo: r.rowNo,
        rawLine: r.rawLine,
        dataJson: payload,
        nationalCode: nc,
        nationalCodeEnc: nc ? encryptPii(nc) : null,
        nationalCodeBlindIndex: nc ? blindIndex(nc, NC_CONTEXT) : null,
        nationalCodeValid: r.nationalCodeValid,
        applicantNo: r.applicantNo,
        uniqueId: r.uniqueId,
        fullName: r.fullName,
        rowHash: fp,
        matchStatus: dup ? 'DUPLICATE' : nc ? (r.nationalCodeValid ? 'PENDING' : 'INVALID') : 'INVALID',
        matchNote: dup ? 'ردیف تکراری در همین فایل' : null,
      };
    });

    // درج دسته‌ای — فایل‌های واقعی تا چند هزار ردیف دارند
    const CHUNK = 500;
    for (let i = 0; i < rowValues.length; i += CHUNK) {
      await tx.insert(sanjesh_file_rows).values(rowValues.slice(i, i + CHUNK));
    }

    const mapped = fieldRows.filter((f) => f.isMapped).length;
    return {
      fileId,
      templateKey: template?.key ?? null,
      encoding: parsed.encoding,
      columnCount: parsed.colCount,
      rowCount: rows.length,
      extraColumns: parsed.extraColumns,
      missingColumns: parsed.missingColumns,
      warnings: parsed.warnings,
      mappedFields: mapped,
      unmappedFields: fieldRows.length - mapped,
      invalidNationalCodes,
      duplicatesInFile,
    } satisfies IngestResult;
  });
}

/**
 * تغییر نگاشت یک ستون پس از بارگذاری.
 * چون `columns` خام ذخیره شده، فایل دوباره خوانده نمی‌شود.
 */
export async function updateFieldMapping(
  fileId: number,
  colIndex: number,
  targetField: string | null,
): Promise<{ updatedRows: number }> {
  await db
    .update(sanjesh_file_fields)
    .set({ targetField, isMapped: Boolean(targetField) })
    .where(and(eq(sanjesh_file_fields.fileId, fileId), eq(sanjesh_file_fields.colIndex, colIndex)));

  return remapFileRows(fileId);
}

/**
 * بازسازی `dataJson.fields` از روی `dataJson.columns` برای همهٔ ردیف‌های فایل.
 * این تابع قلب «تطبیق فیلدها» است: بدون خواندن دوبارهٔ فایل، نگاشت عوض می‌شود.
 *
 * چون `columns` همهٔ ستون‌های خام را دارد، نگاشت جدید فقط یک `jsonb_object_agg`
 * روی خودِ جدول است — نه خواندن فایل و نه درج مجدد.
 */
export async function remapFileRows(fileId: number): Promise<{ updatedRows: number }> {
  const result = await db.execute(sql`
    UPDATE "sanjesh_file_rows" AS r
       SET "dataJson" = jsonb_set(
             r."dataJson",
             '{fields}',
             COALESCE((
               SELECT jsonb_object_agg(m."targetField", COALESCE(r."dataJson"->'columns'->>(m."colIndex"::text), ''))
                 FROM "sanjesh_file_fields" m
                WHERE m."fileId" = r."fileId" AND m."targetField" IS NOT NULL
             ), '{}'::jsonb)
           )
     WHERE r."fileId" = ${fileId}
  `);
  const updatedRows = Number((result as unknown as { rowCount?: number }).rowCount ?? 0);
  return { updatedRows };
}

/** تطبیق ردیف‌های فایل با دانشجویان موجود بر اساس کد ملی — **در دامنهٔ همان دانشگاه**. */
export async function matchFileRows(fileId: number): Promise<{
  matched: number;
  unmatched: number;
  ambiguous: number;
}> {
  const [file] = await db
    .select({ universityId: sanjesh_files.universityId })
    .from(sanjesh_files)
    .where(eq(sanjesh_files.id, fileId))
    .limit(1);
  if (!file) throw new Error('فایل یافت نشد.');

  const rows = await db
    .select({ id: sanjesh_file_rows.id, nationalCode: sanjesh_file_rows.nationalCode })
    .from(sanjesh_file_rows)
    .where(and(eq(sanjesh_file_rows.fileId, fileId), eq(sanjesh_file_rows.matchStatus, 'PENDING')));

  const codes = [...new Set(rows.map((r) => r.nationalCode).filter((c): c is string => Boolean(c)))];
  if (codes.length === 0) return { matched: 0, unmatched: rows.length, ambiguous: 0 };

  // کد ملی دانشجو در `persons` است؛ `students` از طریق personId وصل می‌شود.
  // دامنهٔ دانشگاه الزامی است: بدون آن، دانشجوی همان کد ملی در دانشگاه دیگر
  // به این ردیف وصل می‌شد.
  const uniFilter = file.universityId
    ? sql` AND s."universityId" = ${file.universityId}`
    : sql``;

  const found = await db.execute(sql`
    SELECT p."canonicalNationalCode" AS nc, s."id" AS sid
      FROM "persons" p
      JOIN "students" s ON s."personId" = p."id"
     WHERE p."canonicalNationalCode" IN (${sql.join(codes.map((c) => sql`${c}`), sql`, `)})
       ${uniFilter}
  `);

  const byCode = new Map<string, number[]>();
  for (const r of (found.rows ?? []) as { nc: string; sid: number }[]) {
    const list = byCode.get(r.nc) ?? [];
    list.push(Number(r.sid));
    byCode.set(r.nc, list);
  }

  let matched = 0;
  let ambiguous = 0;
  let unmatched = 0;

  for (const row of rows) {
    const candidates = row.nationalCode ? byCode.get(row.nationalCode) ?? [] : [];
    if (candidates.length === 1) {
      await db
        .update(sanjesh_file_rows)
        .set({ studentId: candidates[0], matchStatus: 'MATCHED', matchedAt: new Date(), matchNote: null })
        .where(eq(sanjesh_file_rows.id, row.id));
      matched++;
    } else if (candidates.length > 1) {
      await db
        .update(sanjesh_file_rows)
        .set({ matchStatus: 'DUPLICATE', matchNote: `${candidates.length} دانشجو با این کد ملی` })
        .where(eq(sanjesh_file_rows.id, row.id));
      ambiguous++;
    } else {
      unmatched++;
    }
  }

  return { matched, unmatched, ambiguous };
}

/**
 * انتقال ردیف‌های تطبیق‌یافته به `admissions_staging` (مرحلهٔ «تطبیق داده شده»).
 * هر ردیف یک ردیف staging با پیوند به فایل و ردیف مبدأ می‌سازد.
 */
export async function stageMatchedRows(fileId: number): Promise<{ staged: number; skipped: number }> {
  const [file] = await db
    .select({ universityId: sanjesh_files.universityId })
    .from(sanjesh_files)
    .where(eq(sanjesh_files.id, fileId))
    .limit(1);
  if (!file) throw new Error('فایل یافت نشد.');

  const rows = await db
    .select()
    .from(sanjesh_file_rows)
    .where(and(eq(sanjesh_file_rows.fileId, fileId), eq(sanjesh_file_rows.matchStatus, 'MATCHED')));

  if (rows.length === 0) return { staged: 0, skipped: 0 };

  // ── نگاشت «کد رشتهٔ سنجش» → «رشتهٔ داخلی» ──
  // همان قاعدهٔ admissions-engine: اگر نگاشت موجود باشد ردیف مستقیماً RESOLVED
  // می‌شود، وگرنه PENDING_MAPPING می‌ماند تا کارشناس در /admin/admissions
  // آن را نگاشت کند. هر وضعیت دیگری ردیف را در آن صفحه **قفل** می‌کند، چون
  // اکشن نگاشت فقط PENDING_MAPPING را به‌روز می‌کند و ثبت نهایی فقط RESOLVED را.
  const mappings = await db
    .select({ sanjeshCode: sanjesh_mappings.sanjeshCode, internalMajorId: sanjesh_mappings.internalMajorId })
    .from(sanjesh_mappings)
    .where(universityScope(sanjesh_mappings.universityId, file.universityId ?? null));
  const majorByCode = new Map(mappings.map((m) => [String(m.sanjeshCode).trim(), m.internalMajorId]));

  const existing = await db
    .select({ rowNo: admissions_staging.rowNo })
    .from(admissions_staging)
    .where(eq(admissions_staging.fileId, fileId));
  const alreadyStaged = new Set(existing.map((e) => e.rowNo));

  const values = [];
  for (const r of rows) {
    if (alreadyStaged.has(r.rowNo)) continue;
    const data = r.dataJson as { fields?: Record<string, string> } | null;
    const f = data?.fields ?? {};
    // کد «رشته محل قبولی» معتبرترین کلید است؛ در کاردانی ستون «کد رشتهٔ
    // تحصیلی» همیشه صفر است، پس fallback به fieldCode فقط برای قالب‌های قدیمی.
    const sanjeshCode = String(f.fieldPlaceCode ?? '').trim() || String(f.fieldCode ?? '').trim();
    const mappedMajorId = majorByCode.get(sanjeshCode) ?? null;
    values.push({
      nationalCode: r.nationalCode ?? '',
      nationalCodeEnc: r.nationalCodeEnc,
      nationalCodeBlindIndex: r.nationalCodeBlindIndex,
      // دادهٔ کامل ردیف به‌عنوان مرجع در staging هم نگه داشته می‌شود
      rawSanjeshData: r.rawLine,
      profileJson: JSON.stringify({ fields: f, columns: (r.dataJson as { columns?: unknown })?.columns ?? {} }),
      fullName: r.fullName,
      mobile: f.mobile ?? null,
      studentId: r.studentId,
      mappedMajorId,
      status: mappedMajorId ? 'RESOLVED' : 'PENDING_MAPPING',
      fileId,
      rowNo: r.rowNo,
      matchedAt: new Date(),
      // دامنهٔ دانشگاه الزامی — staging چنددانشگاهی است
      universityId: file.universityId ?? null,
    });
  }

  if (values.length === 0) return { staged: 0, skipped: rows.length };
  await db.insert(admissions_staging).values(values);
  await db.update(sanjesh_files).set({ status: 'STAGED', updatedAt: new Date() }).where(eq(sanjesh_files.id, fileId));
  return { staged: values.length, skipped: rows.length - values.length };
}

/** خلاصهٔ شمارنده‌های یک فایل برای کارتابل */
export async function fileCounters(fileId: number): Promise<{
  total: number;
  pending: number;
  matched: number;
  duplicate: number;
  invalid: number;
  ignored: number;
  unmappedFields: number;
}> {
  const counts = await db
    .select({ status: sanjesh_file_rows.matchStatus, n: sql<number>`count(*)::int` })
    .from(sanjesh_file_rows)
    .where(eq(sanjesh_file_rows.fileId, fileId))
    .groupBy(sanjesh_file_rows.matchStatus);

  const get = (s: string) => Number(counts.find((c) => c.status === s)?.n ?? 0);
  const total = counts.reduce((s, c) => s + Number(c.n), 0);

  const [unmapped] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(sanjesh_file_fields)
    .where(and(eq(sanjesh_file_fields.fileId, fileId), eq(sanjesh_file_fields.isMapped, false)));

  return {
    total,
    pending: get('PENDING'),
    matched: get('MATCHED'),
    duplicate: get('DUPLICATE'),
    invalid: get('INVALID'),
    ignored: get('IGNORED'),
    unmappedFields: Number(unmapped?.n ?? 0),
  };
}

/** شمارنده‌های چند فایل با یک کوئری (برای صفحهٔ فهرست) */
export async function countersForFiles(fileIds: number[]): Promise<Map<number, Record<string, number>>> {
  const out = new Map<number, Record<string, number>>();
  if (fileIds.length === 0) return out;
  const rows = await db
    .select({
      fileId: sanjesh_file_rows.fileId,
      status: sanjesh_file_rows.matchStatus,
      n: sql<number>`count(*)::int`,
    })
    .from(sanjesh_file_rows)
    .where(inArray(sanjesh_file_rows.fileId, fileIds))
    .groupBy(sanjesh_file_rows.fileId, sanjesh_file_rows.matchStatus);

  for (const r of rows) {
    const bucket = out.get(r.fileId) ?? {};
    bucket[r.status] = Number(r.n);
    out.set(r.fileId, bucket);
  }
  return out;
}
