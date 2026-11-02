'use server';

/**
 * اکشن‌های ماژول «تبدیل اطلاعات سازمان سنجش»
 *
 * جریان ۶ مرحله‌ای:
 *   فایل‌ها → تطبیق فیلدها → براورد → لیست سنجش → تطبیق داده شده → ثبت‌نام‌شده
 *
 * ⚠ قاعده: `redirect()` هرگز داخل `try` صدا زده نمی‌شود. `redirect` در Next با
 * پرتاب یک خطای ویژه کار می‌کند و `catch` آن را می‌بلعد. پس هر اکشن ابتدا
 * نتیجه را در یک متغیر می‌گذارد و بعد از `try/catch` هدایت می‌کند.
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';

import { db } from '@/db';
import { sanjesh_file_rows, sanjesh_files, sanjesh_templates, sanjesh_value_maps } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { getCurrentUniversity } from '@/lib/university-scope';
import { ingestSanjeshFile, matchFileRows, remapFileRows, stageMatchedRows, updateFieldMapping } from '@/lib/sanjesh/ingest';
import { getScopedFile } from '@/lib/sanjesh/access';
import { parseSanjeshFile } from '@/lib/sanjesh/parse';
import { cloneTemplate, loadTemplateByKey, saveTemplate, seedBuiltinTemplates, templateKeyExists } from '@/lib/sanjesh/template-store';

const ROLES = ['ADMIN', 'EDU_EXPERT'];
const BASE = '/admin/sanjesh';

/** نتیجهٔ اکشن: پیام + مقصد هدایت */
type Outcome = { to: string; msg: string; err?: boolean };

function go(o: Outcome): never {
  const key = o.err ? 'err' : 'msg';
  redirect(`${o.to}?${key}=${encodeURIComponent(o.msg)}`);
}

function reason(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

/**
 * مالکیت فایل را در دانشگاه جاری تضمین می‌کند.
 *
 * ⚠ چندانتگاهی: صفحه‌ها با `getScopedFile` فیلتر می‌شوند، اما اکشن‌ها با
 * `fileId` خام از فرم صدا زده می‌شوند و هر کاربری می‌تواند شناسه را دستکاری کند.
 * پس هر اکشنی که `fileId` می‌گیرد باید اول از این دروازه بگذرد، وگرنه فایل
 * دانشگاه دیگر قابل حذف/تغییر است.
 */
async function ownedFile(fileId: number) {
  if (!Number.isFinite(fileId)) throw new Error('شناسهٔ فایل نامعتبر است.');
  const uni = await getCurrentUniversity();
  const file = await getScopedFile(fileId, uni?.id ?? null);
  if (!file) throw new Error('فایل در دامنهٔ این دانشگاه یافت نشد.');
  return file;
}

/* ------------------------------------------------------------------ */
/* مرحلهٔ ۱ — بارگذاری فایل                                           */
/* ------------------------------------------------------------------ */

export async function uploadSanjeshFileAction(formData: FormData) {
  const user = await requireRole(ROLES);
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    go({ to: BASE, msg: 'فایل انتخاب نشده است.', err: true });
  }

  const title = String(formData.get('title') ?? '').trim() || file.name;
  const templateKey = String(formData.get('templateKey') ?? '').trim() || null;
  const examKind = String(formData.get('examKind') ?? '').trim() || null;
  const examYearRaw = String(formData.get('examYear') ?? '').trim();
  const examYear = examYearRaw ? Number(examYearRaw) : null;
  const termIdRaw = String(formData.get('termId') ?? '').trim();
  const termId = termIdRaw ? Number(termIdRaw) : null;
  // جداکننده و کدینگ — همان دو گزینه‌ای که در سیستم قبلی هنگام افزودن فایل
  // گرفته می‌شد. خالی بودنشان یعنی رفتار پیش‌فرض (`$` و تشخیص خودکار).
  const separatorRaw = String(formData.get('separator') ?? '');
  const separator = separatorRaw === '' ? null : separatorRaw === '\\t' ? '\t' : separatorRaw;
  const encRaw = String(formData.get('encoding') ?? '').trim();
  const encoding =
    encRaw === 'utf-8' || encRaw === 'utf-16le' || encRaw === 'windows-1256' ? encRaw : null;

  let outcome: Outcome;
  try {
    const buffer = new Uint8Array(await file.arrayBuffer());
    const uni = await getCurrentUniversity();
    // قالب‌های پیش‌فرض یک‌بار در دیتابیس seed می‌شوند تا قابل کپی/ویرایش باشند
    await seedBuiltinTemplates().catch(() => undefined);

    const result = await ingestSanjeshFile({
      buffer,
      fileName: file.name,
      title,
      templateKey,
      examKind,
      examYear,
      termId,
      universityId: uni?.id ?? null,
      userId: user.id,
      separator,
      encoding,
    });

    const bits = [
      `${result.rowCount} ردیف ثبت شد`,
      `${result.columnCount} ستون`,
      result.templateKey ? `قالب ${result.templateKey}` : 'بدون قالب',
    ];
    if (result.unmappedFields > 0) bits.push(`${result.unmappedFields} ستون نگاشت‌نشده`);
    if (result.duplicatesInFile > 0) bits.push(`${result.duplicatesInFile} ردیف تکراری`);
    if (result.invalidNationalCodes > 0) bits.push(`${result.invalidNationalCodes} کد ملی نامعتبر`);
    if (result.repairedNationalCodes > 0) bits.push(`${result.repairedNationalCodes} کد ملی با صفرِ اول اصلاح شد`);

    revalidatePath(BASE);
    outcome = { to: `${BASE}/${result.fileId}/fields`, msg: bits.join(' · ') };
  } catch (e) {
    outcome = { to: BASE, msg: reason(e, 'بارگذاری فایل ناموفق بود.'), err: true };
  }
  go(outcome);
}

export async function deleteSanjeshFileAction(formData: FormData) {
  await requireRole(ROLES);
  const id = Number(formData.get('id'));
  if (!Number.isFinite(id)) go({ to: BASE, msg: 'شناسهٔ فایل نامعتبر است.', err: true });

  let outcome: Outcome;
  try {
    await ownedFile(id);
    await db.delete(sanjesh_files).where(eq(sanjesh_files.id, id));
    revalidatePath(BASE);
    outcome = { to: BASE, msg: 'فایل و همهٔ ردیف‌های آن حذف شد.' };
  } catch (e) {
    outcome = { to: BASE, msg: reason(e, 'حذف فایل ناموفق بود.'), err: true };
  }
  go(outcome);
}

/* ------------------------------------------------------------------ */
/* مرحلهٔ ۲ — تطبیق فیلدها                                            */
/* ------------------------------------------------------------------ */

export async function saveFieldMappingAction(formData: FormData) {
  await requireRole(ROLES);
  const fileId = Number(formData.get('fileId'));
  if (!Number.isFinite(fileId)) go({ to: BASE, msg: 'شناسهٔ فایل نامعتبر است.', err: true });
  const dest = `${BASE}/${fileId}/fields`;

  // ورودی‌ها به شکل field_<colIndex> = targetField
  const updates: { col: number; field: string | null }[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith('field_')) continue;
    const col = Number(key.slice('field_'.length));
    if (!Number.isFinite(col)) continue;
    const v = String(value).trim();
    updates.push({ col, field: v === '' || v === '__none__' ? null : v });
  }

  if (updates.length === 0) go({ to: dest, msg: 'تغییری ثبت نشد.' });

  // یک فیلد مقصد نمی‌تواند به دو ستون داده شود (وگرنه دومی اولی را بازنویسی می‌کند)
  const used = new Map<string, number>();
  for (const u of updates) {
    if (!u.field) continue;
    const prev = used.get(u.field);
    if (prev !== undefined && prev !== u.col) {
      go({ to: dest, msg: `فیلد «${u.field}» هم به ستون ${prev} و هم به ستون ${u.col} داده شده است.`, err: true });
    }
    used.set(u.field, u.col);
  }

  let outcome: Outcome;
  try {
    await ownedFile(fileId);
    for (const u of updates) await updateFieldMapping(fileId, u.col, u.field);
    await remapFileRows(fileId);
    await db.update(sanjesh_files).set({ status: 'FIELDS_READY', updatedAt: new Date() }).where(eq(sanjesh_files.id, fileId));
    revalidatePath(dest);
    outcome = { to: dest, msg: `${updates.length} ستون به‌روزرسانی شد و داده‌ها بازنگاشت شدند.` };
  } catch (e) {
    outcome = { to: dest, msg: reason(e, 'ذخیرهٔ تطبیق ناموفق بود.'), err: true };
  }
  go(outcome);
}

/** اعمال نگاشت قالب روی همهٔ ستون‌ها */
export async function autoMapFieldsAction(formData: FormData) {
  await requireRole(ROLES);
  const fileId = Number(formData.get('fileId'));
  if (!Number.isFinite(fileId)) go({ to: BASE, msg: 'شناسهٔ فایل نامعتبر است.', err: true });
  const dest = `${BASE}/${fileId}/fields`;

  let outcome: Outcome;
  try {
    const file = await ownedFile(fileId);
    if (!file.templateKey) throw new Error('برای نگاشت خودکار، فایل باید قالب داشته باشد.');

    const tpl = await loadTemplateByKey(file.templateKey, file.universityId);
    if (!tpl) throw new Error('قالب فایل یافت نشد.');

    for (const c of tpl.columns) {
      await updateFieldMapping(fileId, c.colIndex, c.targetField.startsWith('extra_') ? null : c.targetField);
    }
    await remapFileRows(fileId);
    revalidatePath(dest);
    outcome = { to: dest, msg: `نگاشت قالب «${tpl.key}» روی ${tpl.columns.length} ستون اعمال شد.` };
  } catch (e) {
    outcome = { to: dest, msg: reason(e, 'نگاشت خودکار ناموفق بود.'), err: true };
  }
  go(outcome);
}

/* ------------------------------------------------------------------ */
/* مرحلهٔ ۳ — جدول براورد                                             */
/* ------------------------------------------------------------------ */

export async function saveValueMapAction(formData: FormData) {
  await requireRole(ROLES);
  const fileId = Number(formData.get('fileId'));
  const dest = `${BASE}/${fileId}/values`;
  const field = String(formData.get('field') ?? '').trim();
  const sanjeshValue = String(formData.get('sanjeshValue') ?? '').trim();
  const sanjeshLabel = String(formData.get('sanjeshLabel') ?? '').trim() || null;
  const internalValue = String(formData.get('internalValue') ?? '').trim() || null;
  const internalLabel = String(formData.get('internalLabel') ?? '').trim() || null;

  if (!Number.isFinite(fileId) || !field || !sanjeshValue) {
    go({ to: dest, msg: 'فیلد و مقدار سنجش الزامی است.', err: true });
  }

  let outcome: Outcome;
  try {
    const parent = await ownedFile(fileId);
    await db
      .insert(sanjesh_value_maps)
      .values({ fileId, universityId: parent.universityId ?? null, field, sanjeshValue, sanjeshLabel, internalValue, internalLabel })
      .onConflictDoUpdate({
        target: [sanjesh_value_maps.fileId, sanjesh_value_maps.field, sanjesh_value_maps.sanjeshValue],
        set: { sanjeshLabel, internalValue, internalLabel },
      });
    revalidatePath(dest);
    outcome = { to: dest, msg: `براورد «${sanjeshValue}» ذخیره شد.` };
  } catch (e) {
    outcome = { to: dest, msg: reason(e, 'ذخیرهٔ براورد ناموفق بود.'), err: true };
  }
  go(outcome);
}

export async function deleteValueMapAction(formData: FormData) {
  await requireRole(ROLES);
  const fileId = Number(formData.get('fileId'));
  const id = Number(formData.get('id'));
  const dest = `${BASE}/${fileId}/values`;

  let outcome: Outcome;
  try {
    await ownedFile(fileId);
    if (Number.isFinite(id)) {
      await db
        .delete(sanjesh_value_maps)
        .where(and(eq(sanjesh_value_maps.id, id), eq(sanjesh_value_maps.fileId, fileId)));
    }
    revalidatePath(dest);
    outcome = { to: dest, msg: 'ردیف براورد حذف شد.' };
  } catch (e) {
    outcome = { to: dest, msg: reason(e, 'حذف ناموفق بود.'), err: true };
  }
  go(outcome);
}

/** پرکردن براورد از جدول‌های دیکد قالب (idempotent) */
export async function seedValueMapsFromTemplateAction(formData: FormData) {
  await requireRole(ROLES);
  const fileId = Number(formData.get('fileId'));
  const dest = `${BASE}/${fileId}/values`;

  let outcome: Outcome;
  try {
    const file = await ownedFile(fileId);
    if (!file.templateKey) throw new Error('فایل قالب ندارد.');

    const tpl = await loadTemplateByKey(file.templateKey, file.universityId);
    if (!tpl) throw new Error('قالب یافت نشد.');

    let count = 0;
    for (const [field, entries] of Object.entries(tpl.decodeTables)) {
      for (const e of entries) {
        await db
          .insert(sanjesh_value_maps)
          .values({
            fileId,
            universityId: file.universityId ?? null,
            field,
            sanjeshValue: e.value,
            sanjeshLabel: e.label,
            internalValue: e.internalValue ?? null,
            internalLabel: e.label,
          })
          .onConflictDoNothing();
        count++;
      }
    }
    revalidatePath(dest);
    outcome = { to: dest, msg: `${count} ردیف براورد از قالب «${tpl.key}» بررسی/درج شد.` };
  } catch (e) {
    outcome = { to: dest, msg: reason(e, 'درج براورد ناموفق بود.'), err: true };
  }
  go(outcome);
}

/* ------------------------------------------------------------------ */
/* مرحلهٔ ۴/۵ — تطبیق و انتقال                                        */
/* ------------------------------------------------------------------ */

export async function runMatchAction(formData: FormData) {
  await requireRole(ROLES);
  const fileId = Number(formData.get('fileId'));
  if (!Number.isFinite(fileId)) go({ to: BASE, msg: 'شناسهٔ فایل نامعتبر است.', err: true });
  const dest = `${BASE}/${fileId}/rows`;

  let outcome: Outcome;
  try {
    await ownedFile(fileId);
    const r = await matchFileRows(fileId);
    revalidatePath(dest);
    outcome = { to: dest, msg: `${r.matched} تطبیق یافت · ${r.unmatched} بدون تطبیق · ${r.ambiguous} مبهم` };
  } catch (e) {
    outcome = { to: dest, msg: reason(e, 'تطبیق ناموفق بود.'), err: true };
  }
  go(outcome);
}

export async function stageMatchedAction(formData: FormData) {
  await requireRole(ROLES);
  const fileId = Number(formData.get('fileId'));
  if (!Number.isFinite(fileId)) go({ to: BASE, msg: 'شناسهٔ فایل نامعتبر است.', err: true });
  const dest = `${BASE}/${fileId}/matched`;

  let outcome: Outcome;
  try {
    await ownedFile(fileId);
    const r = await stageMatchedRows(fileId);
    revalidatePath(dest);
    outcome = { to: dest, msg: `${r.staged} ردیف به پذیرش منتقل شد · ${r.skipped} از قبل منتقل شده بود` };
  } catch (e) {
    outcome = { to: dest, msg: reason(e, 'انتقال ناموفق بود.'), err: true };
  }
  go(outcome);
}

/** تغییر وضعیت یک ردیف (نادیده‌گرفتن / بازگردانی به انتظار) */
export async function setRowStatusAction(formData: FormData) {
  await requireRole(ROLES);
  const fileId = Number(formData.get('fileId'));
  const rowId = Number(formData.get('rowId'));
  const status = String(formData.get('status') ?? 'PENDING');
  const dest = `${BASE}/${fileId}/rows`;
  const allowed = ['PENDING', 'IGNORED', 'INVALID'];
  if (!allowed.includes(status)) go({ to: dest, msg: 'وضعیت نامعتبر است.', err: true });

  let outcome: Outcome;
  try {
    await ownedFile(fileId);
    await db
      .update(sanjesh_file_rows)
      .set({ matchStatus: status, matchNote: status === 'IGNORED' ? 'دستی نادیده گرفته شد' : null })
      .where(and(eq(sanjesh_file_rows.id, rowId), eq(sanjesh_file_rows.fileId, fileId)));
    revalidatePath(dest);
    outcome = { to: dest, msg: 'وضعیت ردیف به‌روزرسانی شد.' };
  } catch (e) {
    outcome = { to: dest, msg: reason(e, 'تغییر وضعیت ناموفق بود.'), err: true };
  }
  go(outcome);
}

/* ------------------------------------------------------------------ */
/* قالب‌ها — تعریف توسط کاربر                                         */
/* ------------------------------------------------------------------ */

export async function seedBuiltinTemplatesAction() {
  await requireRole(ROLES);
  const dest = `${BASE}/templates`;

  let outcome: Outcome;
  try {
    const r = await seedBuiltinTemplates();
    revalidatePath(dest);
    outcome = { to: dest, msg: `${r.inserted} قالب پیش‌فرض درج شد · ${r.skipped} از قبل موجود بود` };
  } catch (e) {
    outcome = { to: dest, msg: reason(e, 'درج قالب‌های پیش‌فرض ناموفق بود.'), err: true };
  }
  go(outcome);
}

export async function cloneTemplateAction(formData: FormData) {
  const user = await requireRole(ROLES);
  const dest = `${BASE}/templates`;
  const sourceKey = String(formData.get('sourceKey') ?? '').trim();
  const newKey = String(formData.get('newKey') ?? '').trim();
  const title = String(formData.get('title') ?? '').trim();
  const examYear = Number(formData.get('examYear'));

  if (!sourceKey || !newKey || !title || !Number.isFinite(examYear)) {
    go({ to: dest, msg: 'کلید، عنوان و سال قالب الزامی است.', err: true });
  }
  if (!/^[A-Z0-9_]+$/.test(newKey)) {
    go({ to: dest, msg: 'کلید قالب فقط حروف بزرگ انگلیسی، رقم و زیرخط.', err: true });
  }

  let outcome: Outcome;
  try {
    const uni = await getCurrentUniversity();
    if (await templateKeyExists(newKey, uni?.id ?? null)) throw new Error(`کلید «${newKey}» قبلاً استفاده شده است.`);
    const { id } = await cloneTemplate(sourceKey, newKey, title, examYear, user.id, uni?.id ?? null);
    revalidatePath(dest);
    outcome = { to: `${BASE}/templates/${id}`, msg: 'قالب کپی شد؛ اکنون می‌توانید ستون‌ها را ویرایش کنید.' };
  } catch (e) {
    outcome = { to: dest, msg: reason(e, 'کپی قالب ناموفق بود.'), err: true };
  }
  go(outcome);
}

/** ذخیرهٔ ویرایش قالب — ستون‌ها از فرم می‌آیند (col_<n>_title / _len / _field) */
export async function saveTemplateAction(formData: FormData) {
  const user = await requireRole(ROLES);
  const id = Number(formData.get('id'));
  const key = String(formData.get('key') ?? '').trim();
  const title = String(formData.get('title') ?? '').trim();
  const examKind = String(formData.get('examKind') ?? '').trim();
  const examYear = Number(formData.get('examYear'));
  const columnCount = Number(formData.get('columnCount'));
  const dest = Number.isFinite(id) && id > 0 ? `${BASE}/templates/${id}` : `${BASE}/templates`;

  if (!key || !title || !examKind || !Number.isFinite(examYear) || !Number.isFinite(columnCount)) {
    go({ to: dest, msg: 'اطلاعات قالب ناقص است.', err: true });
  }

  const columns = [];
  for (let c = 1; c <= columnCount; c++) {
    const t = String(formData.get(`col_${c}_title`) ?? '').trim();
    const len = Number(formData.get(`col_${c}_len`) ?? 0);
    const field = String(formData.get(`col_${c}_field`) ?? '').trim();
    columns.push({
      colIndex: c,
      sanjeshTitle: t || `ستون ${c}`,
      charCount: Number.isFinite(len) ? len : 0,
      targetField: field === '' || field === '__none__' ? null : field,
    });
  }

  let outcome: Outcome;
  try {
    // ویرایش قالب هم چنددانشگاهی است: قالب پیش‌فرض (سراسری) قفل است و قالب
    // دانشگاه دیگر از راه دستکاری id قابل تغییر نیست.
    if (Number.isFinite(id) && id > 0) {
      const uni = await getCurrentUniversity();
      const [tpl] = await db
        .select({ universityId: sanjesh_templates.universityId, isBuiltin: sanjesh_templates.isBuiltin })
        .from(sanjesh_templates)
        .where(eq(sanjesh_templates.id, id))
        .limit(1);
      if (!tpl) throw new Error('قالب یافت نشد.');
      if (tpl.isBuiltin) throw new Error('قالب پیش‌فرض قابل ویرایش نیست؛ ابتدا آن را کپی کنید.');
      if (tpl.universityId != null && uni?.id != null && tpl.universityId !== uni.id) {
        throw new Error('این قالب متعلق به دانشگاه دیگری است.');
      }
    }
    await saveTemplate({
      id: Number.isFinite(id) && id > 0 ? id : null,
      key,
      title,
      examKind,
      examYear,
      columns,
      createdByUserId: user.id,
    });
    revalidatePath(`${BASE}/templates`);
    outcome = { to: dest, msg: 'قالب ذخیره شد.' };
  } catch (e) {
    outcome = { to: dest, msg: reason(e, 'ذخیرهٔ قالب ناموفق بود.'), err: true };
  }
  go(outcome);
}

/**
 * ساخت قالب از روی یک فایل — تعداد و طول ستون‌ها از خود فایل گرفته می‌شود.
 * فیلدهای مقصد خالی می‌مانند تا مدیر تعیین کند.
 */
export async function buildTemplateFromFileAction(formData: FormData) {
  const user = await requireRole(ROLES);
  const dest = `${BASE}/templates`;
  const file = formData.get('file');
  const key = String(formData.get('key') ?? '').trim();
  const title = String(formData.get('title') ?? '').trim();
  const examKind = String(formData.get('examKind') ?? 'CUSTOM').trim();
  const examYear = Number(formData.get('examYear'));

  if (!(file instanceof File) || file.size === 0) {
    go({ to: dest, msg: 'فایل انتخاب نشده است.', err: true });
  }
  if (!key || !title || !Number.isFinite(examYear)) {
    go({ to: dest, msg: 'کلید، عنوان و سال قالب الزامی است.', err: true });
  }
  if (!/^[A-Z0-9_]+$/.test(key)) {
    go({ to: dest, msg: 'کلید قالب فقط حروف بزرگ انگلیسی، رقم و زیرخط.', err: true });
  }

  let outcome: Outcome;
  try {
    const uni = await getCurrentUniversity();
    if (await templateKeyExists(key, uni?.id ?? null)) throw new Error(`کلید «${key}» قبلاً استفاده شده است.`);

    const buffer = new Uint8Array(await file.arrayBuffer());
    const parsed = parseSanjeshFile(buffer, null);
    if (parsed.colCount === 0) throw new Error('فایل هیچ ستونی ندارد.');

    const columns = [];
    for (let c = 1; c <= parsed.colCount; c++) {
      const sample = parsed.samples[String(c)] ?? '';
      columns.push({
        colIndex: c,
        sanjeshTitle: sample ? `ستون ${c} — ${sample.slice(0, 40)}` : `ستون ${c}`,
        charCount: parsed.observedLengths[String(c)] ?? 0,
        targetField: null,
      });
    }

    const { id } = await saveTemplate({
      key,
      title,
      examKind,
      examYear,
      columns,
      createdByUserId: user.id,
      universityId: uni?.id ?? null,
      notes: `ساخته‌شده از فایل «${file.name}» (${parsed.rowCount} ردیف، ${parsed.colCount} ستون).`,
    });
    revalidatePath(dest);
    outcome = { to: `${BASE}/templates/${id}`, msg: `قالب با ${parsed.colCount} ستون ساخته شد؛ فیلدهای مقصد را تعیین کنید.` };
  } catch (e) {
    outcome = { to: dest, msg: reason(e, 'ساخت قالب از فایل ناموفق بود.'), err: true };
  }
  go(outcome);
}
