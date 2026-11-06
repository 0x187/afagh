'use server';

import { db } from '@/db';
import { samin_staging, students } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { and, eq, inArray } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { buildSaminPayloadForStudent } from '@/lib/samin/samin-mapper';
import { saminBulkImport, type SaminBulkResult } from '@/lib/samin/client';

export async function enqueueForSamin(universityId: number): Promise<{ inserted: number; skipped: number }> {
  await requireRole(['ADMIN']);
  // اگر universityId=null بود (دادهٔ قدیم)، فقط همان دانشگاه را فیلتر می‌کنیم
  const studs = await db.select({ id: students.id }).from(students).where(eq(students.universityId, universityId)).limit(5000);
  // اگر هیچ دانشجویی با universityId نداشتیم (دادهٔ قدیم)، برای سازگاری همه را برای AFAGH در نظر می‌گیریم
  const ids = studs.length ? studs.map(s => s.id) : [];

  // ⚡ پیش‌تر برای هر دانشجو یک SELECT «تکراری است؟» و یک INSERT جدا می‌رفت
  // (تا ۵۰۰۰ دانشجو ⇒ تا ۱۰٬۰۰۰ رفت‌وبرگشتِ شبکه). حالا کلیدهای موجود یک‌بار
  // خوانده می‌شوند و درج‌ها دسته‌ای (۵۰۰تایی) انجام می‌شود.
  const existingRows = await db
    .select({ pk: samin_staging.personPkInSource })
    .from(samin_staging)
    .where(and(eq(samin_staging.universityId, universityId), eq(samin_staging.entityCode, '1000')));
  const existing = new Set(existingRows.map(r => String(r.pk ?? '')));

  let inserted = 0; let skipped = 0;
  const values: {
    universityId: number; entityCode: string; personPkInSource: string;
    studentPkInSource: string; payload: Record<string, unknown>; status: string;
  }[] = [];

  for (const sid of ids) {
    const payload = await buildSaminPayloadForStudent(sid);
    if (!payload) { skipped++; continue; }
    const pk = String(payload.person_pk_in_source || sid);
    if (existing.has(pk)) { skipped++; continue; }
    // کلید تازه در همان دسته هم نباید دوباره درج شود
    existing.add(pk);
    values.push({
      universityId,
      entityCode: '1000',
      personPkInSource: pk,
      studentPkInSource: String(payload.student_pk_in_source || sid),
      payload,
      status: 'PENDING',
    });
  }

  // درج دسته‌ای؛ شمارش از خروجی واقعی (نه از تعداد تلاش) تا با onConflict هم‌خوان باشد
  for (let i = 0; i < values.length; i += 500) {
    const chunk = values.slice(i, i + 500);
    const done = await db.insert(samin_staging).values(chunk)
      .onConflictDoNothing()
      .returning({ id: samin_staging.id });
    inserted += done.length;
  }
  revalidatePath('/admin/samin');
  return { inserted, skipped };
}

export async function sendToSamin(universityId: number, entityCode: string) {
  await requireRole(['ADMIN']);
  const batch = await db.select().from(samin_staging).where(and(eq(samin_staging.universityId, universityId), eq(samin_staging.entityCode, entityCode), eq(samin_staging.status, 'PENDING'))).limit(50);
  if (!batch.length) throw new Error('صفی برای ارسال نیست — ابتدا آماده‌سازی را بزنید');

  // payload در DB از نوع jsonb است (unknown) و امضای client هم unknown[] می‌خواهد
  const data_object: unknown[] = batch.map(r => r.payload);
  const res: SaminBulkResult =
    await saminBulkImport(universityId, { data_object, entity_code: entityCode, import_type_code: '0' });

  const traceId = Number(res.trace_id ?? res.traceId ?? 0) || null;
  // یک UPDATE دسته‌ای به‌جای ۵۰ آپدیت تک‌ردیفی (همهٔ ردیف‌ها همان وضعیت/زمان را می‌گیرند)
  await db.update(samin_staging)
    .set({ status: 'SENT', traceId, sentAt: new Date() })
    .where(inArray(samin_staging.id, batch.map(r => r.id)));
  revalidatePath('/admin/samin');
  return res;
}

export async function traceSamin(universityId: number, traceId: number) {
  await requireRole(['ADMIN']);
  const { saminTrace } = await import('@/lib/samin/client');
  return saminTrace(universityId, traceId);
}

/**
 * ارسال «نمونه» به ثمین — چند **فارغ‌التحصیل** مشخص (پیش‌فرض ۲ نفر) برای
 * آزمون واقعی اتصال. برخلاف `enqueueForSamin` که کل دانشجویان را صف می‌کند،
 * اینجا فقط چند رکورد با وضعیت GRADUATED انتخاب، به صف اضافه و همان لحظه
 * با `bulk_import_data` ارسال می‌شوند تا `trace_id` و وضعیت سامانه دیده شود.
 */
export async function sendSampleGraduatesToSamin(universityId: number, count = 2) {
  await requireRole(['ADMIN']);
  const limit = Math.min(Math.max(Number(count) || 2, 1), 10);

  const rows = await db
    .select({ id: students.id })
    .from(students)
    .where(and(eq(students.universityId, universityId), eq(students.status, 'GRADUATED')))
    .orderBy(students.id)
    .limit(limit);
  if (!rows.length) {
    throw new Error('برای این مؤسسه دانش‌آموخته‌ای با وضعیت «فارغ‌التحصیل» پیدا نشد.');
  }

  const batch: { pk: string; studentPk: string; payload: Record<string, unknown> }[] = [];
  for (const r of rows) {
    const payload = await buildSaminPayloadForStudent(r.id);
    if (!payload) continue;
    batch.push({
      pk: String(payload.person_pk_in_source || r.id),
      studentPk: String(payload.student_pk_in_source || r.id),
      payload,
    });
  }
  if (!batch.length) throw new Error('ساخت payload برای نمونه‌ها ناموفق بود (دادهٔ دانشجو ناقص است).');

  // ثبت در همان صف تا در صفحه قابل رصد باشد (تکراری‌ها بی‌اثر) — یک درجِ دسته‌ای
  await db.insert(samin_staging).values(batch.map(b => ({
    universityId,
    entityCode: '1000',
    personPkInSource: b.pk,
    studentPkInSource: b.studentPk,
    payload: b.payload,
    status: 'PENDING',
  }))).onConflictDoNothing();

  const res: any = await saminBulkImport(universityId, {
    data_object: batch.map((b) => b.payload),
    entity_code: '1000',
    import_type_code: '0',
  });

  const traceId = Number(res?.trace_id ?? res?.traceId ?? 0) || null;
  // یک UPDATE برای کل دسته (کلید یکتای staging: university+entity+personPk)
  await db.update(samin_staging)
    .set({ status: 'SENT', traceId, sentAt: new Date() })
    .where(and(
      eq(samin_staging.universityId, universityId),
      eq(samin_staging.entityCode, '1000'),
      inArray(samin_staging.personPkInSource, batch.map(b => b.pk)),
    ));
  revalidatePath('/admin/samin');
  return { sent: batch.length, ...res };
}
