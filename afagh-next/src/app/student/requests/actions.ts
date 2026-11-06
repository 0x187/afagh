'use server';

import { and, eq, inArray } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { getStudentByUser, requireRole } from '@/lib/auth';
import {
  courses,
  course_offerings,
  degree_level_configs,
  enrollments,
  grade_objections,
  process_definitions,
  student_requests,
} from '@/db/schema';
import { db } from '@/db';
import {
  ensureDefaultProcesses,
  submitRequestSatisfaction,
  submitStudentRequest,
} from '@/lib/workflow-engine';
import { isGraduateDegreeLevel, isThesisProcess } from '@/lib/request-visibility';
import { issueTranscriptToken } from '@/lib/verification';
import { qrSvg } from '@/lib/qr';
import { getPublicBaseUrl, getSetting } from '@/lib/settings';
import { archiveKey, putArchiveObject } from '@/lib/objectStore';
import { checkUpload, MAX_UPLOAD_BYTES, sanitizeRequestFormData } from '@/lib/safe-input';

/** آپلود پیوست درخواست (مثل کارنامه ممهور) در Object Storage — فقط متادیتا در فرم ذخیره می‌شود */
export async function uploadRequestAttachmentAction(formData: FormData): Promise<{
  ok: boolean;
  error?: string;
  attachment?: { key: string; name: string; size: number; mimeType: string };
}> {
  const user = await requireRole(['STUDENT']);
  const me = await getStudentByUser(user.id);
  if (!me) return { ok: false, error: 'پروندهٔ دانشجویی یافت نشد.' };

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'فایلی انتخاب نشده است.' };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: 'حجم پیوست نباید بیش از ۱۰ مگابایت باشد.' };

  const buf = Buffer.from(await file.arrayBuffer());
  const check = checkUpload(file.name, file.type, buf);
  if (!check.ok) return { ok: false, error: check.error };
  const key = `requests/${me.id}/attach-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}.${check.ext}`;
  try {
    await putArchiveObject(key, buf, check.mime);
  } catch (e: any) {
    return { ok: false, error: 'خطا در ذخیرهٔ پیوست (Object Storage در دسترس نیست): ' + (e?.message || '') };
  }
  return { ok: true, attachment: { key, name: file.name, size: file.size, mimeType: check.mime } };
}

export async function submitStudentRequestAction(processCode: string, formData: Record<string, any>) {
  const user = await requireRole(['STUDENT']);
  const me = await getStudentByUser(user.id);
  if (!me) return { ok: false, error: 'پرونده دانشجویی یافت نشد.' };

  const clean = sanitizeRequestFormData(formData, me.id);
  if (!clean.ok) return { ok: false, error: clean.error };

  // گارد مقطع (نه فقط مخفی‌سازی UI): درخواست‌های پایان‌نامه/پروپوزال/دفاع فقط
  // برای تحصیلات تکمیلی مجاز است؛ کاردانی/کارشناسی حتی با فراخوانی مستقیم اکشن
  // نمی‌توانند ثبت کنند.
  const [proc] = await db
    .select({
      code: process_definitions.code,
      title: process_definitions.title,
      description: process_definitions.description,
    })
    .from(process_definitions)
    .where(eq(process_definitions.code, processCode))
    .limit(1);
  if (proc && isThesisProcess(proc)) {
    const [lvl] = me.degreeLevelId
      ? await db
        .select({
          code: degree_level_configs.code,
          title: degree_level_configs.title,
          isGraduate: degree_level_configs.isGraduate,
        })
        .from(degree_level_configs)
        .where(eq(degree_level_configs.id, me.degreeLevelId))
        .limit(1)
      : [null];
    if (!isGraduateDegreeLevel(lvl ?? null)) {
      return {
        ok: false,
        error: 'درخواست‌های پایان‌نامه فقط برای مقاطع تحصیلات تکمیلی (کارشناسی ارشد و دکتری) فعال است.',
      };
    }
  }

  try {
    const created = await submitStudentRequest({
      studentId: me.id,
      userId: user.id,
      processCode,
      formData: clean.data,
    });

    revalidatePath('/student/requests');
    revalidatePath('/admin');
    revalidatePath('/admin/workflows');
    return { ok: true, trackingCode: created.trackingCode, status: created.status };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'خطا در ثبت درخواست.' };
  }
}

export async function submitSatisfactionRatingAction(requestId: number, score: number, feedback?: string) {
  const user = await requireRole(['STUDENT']);

  try {
    // 🔒 فقط درخواست خودِ همین دانشجو قابل امتیازدهی است (ضد IDOR)
    const me = await getStudentByUser(user.id);
    if (!me) return { ok: false, error: 'پروندهٔ دانشجویی یافت نشد.' };

    await submitRequestSatisfaction({
      requestId,
      score,
      feedback,
      studentId: me.id,
    });

    revalidatePath('/student/requests');
    revalidatePath('/admin/workflows');
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'خطا در ثبت امتیاز نظرسنجی.' };
  }
}

/**
 * صدور رمز تایید (QR) کارنامهٔ معتبر — فقط پس از تأیید نهایی درخواست
 * «درخواست کارنامه معتبر» توسط کارشناس آموزش. ضد IDOR: درخواست باید متعلق
 * به همین دانشجو باشد و وضعیتش APPROVED باشد.
 */
export async function issueApprovedTranscriptTokenAction(requestId: number): Promise<{
  ok: boolean;
  error?: string;
  url?: string;
  qr?: string;
  expiresAt?: string | null;
}> {
  const user = await requireRole(['STUDENT']);
  const me = await getStudentByUser(user.id);
  if (!me) return { ok: false, error: 'پروندهٔ دانشجویی یافت نشد.' };

  try {
    const [req] = await db
      .select({
        id: student_requests.id,
        studentId: student_requests.studentId,
        status: student_requests.status,
        processId: student_requests.processId,
        formData: student_requests.formData,
      })
      .from(student_requests)
      .where(eq(student_requests.id, requestId))
      .limit(1);
    if (!req) return { ok: false, error: 'درخواست یافت نشد.' };
    if (req.studentId !== me.id) return { ok: false, error: 'این درخواست متعلق به شما نیست.' };
    if (req.status !== 'APPROVED') return { ok: false, error: 'درخواست هنوز تأیید نهایی نشده است.' };

    const [proc] = await db
      .select({ code: process_definitions.code })
      .from(process_definitions)
      .where(eq(process_definitions.id, req.processId))
      .limit(1);
    if (proc?.code !== 'VALID_TRANSCRIPT') return { ok: false, error: 'این درخواست از نوع کارنامهٔ معتبر نیست.' };

    // پروندهٔ مقصد (برای دانشجوی چندمقطعی) — پیش‌فرض پروندهٔ فعال
    let recordId = me.id;
    try {
      const f = JSON.parse(req.formData || '{}');
      if (f.recordId) recordId = Number(f.recordId) || me.id;
    } catch { /* نادیده گرفته شود */ }

    const publicBaseUrl = await getPublicBaseUrl();
    const issued = await issueTranscriptToken(user.id, {
      id: recordId,
      code: me.studentCode,
      universityId: me.universityId,
    });
    const url = `${publicBaseUrl}/verify-transcript/${encodeURIComponent(issued.token)}`;
    const qr = await qrSvg(url, { errorCorrectionLevel: 'Q', size: 160, margin: 4 });
    return { ok: true, url, qr, expiresAt: issued.expiresAt };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'خطا در صدور رمز تایید.' };
  }
}

/**
 * ثبت اعتراض به نمرهٔ یک درسِ قطعی — فقط در بازهٔ زمانی اعتراض
 * (تنظیم GRADE_OBJECTION_DEADLINE) و فقط برای ثبت‌نامِ متعلق به همین دانشجو.
 */
export async function submitGradeObjectionAction(
  enrollmentId: number,
  requestText: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireRole(['STUDENT']);
  const me = await getStudentByUser(user.id);
  if (!me) return { ok: false, error: 'پروندهٔ دانشجویی یافت نشد.' };

  const text = (requestText || '').trim();
  if (text.length < 5) return { ok: false, error: 'متن اعتراض بسیار کوتاه است.' };

  try {
    // پنجرهٔ اعتراض — اگر تنظیم نشده یا گذشته باشد، دکمه‌ها عملاً قفل‌اند
    const deadline = await getSetting('GRADE_OBJECTION_DEADLINE');
    if (!deadline || !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) {
      return { ok: false, error: 'پنجرهٔ اعتراض به نمره در حال حاضر باز نیست.' };
    }
    const end = new Date(deadline + 'T23:59:59');
    if (new Date() > end) return { ok: false, error: 'مهلت اعتراض به نمره به پایان رسیده است.' };

    const [enr] = await db
      .select({
        id: enrollments.id,
        studentId: enrollments.studentId,
        grade: enrollments.gradeValue,
        gradeStatus: enrollments.gradeStatus,
        offeringId: enrollments.offeringId,
      })
      .from(enrollments)
      .where(eq(enrollments.id, enrollmentId))
      .limit(1);
    if (!enr || enr.studentId !== me.id) return { ok: false, error: 'این ثبت‌نام متعلق به شما نیست.' };
    if (enr.grade == null && enr.gradeStatus !== 'FINALIZED') {
      return { ok: false, error: 'نمرهٔ این درس هنوز قطعی نشده است.' };
    }

    // جلوگیری از ثبت تکراری در حال بررسی
    const [dup] = await db
      .select({ id: grade_objections.id })
      .from(grade_objections)
      .where(
        and(
          eq(grade_objections.studentId, me.id),
          eq(grade_objections.enrollmentId, enrollmentId),
          inArray(grade_objections.status, ['PENDING', 'REVIEWED']),
        ),
      )
      .limit(1);
    if (dup) return { ok: false, error: 'قبلاً اعتراضی برای این درس ثبت و در حال بررسی است.' };

    const [off] = await db
      .select({ termId: course_offerings.termId, courseId: course_offerings.courseId })
      .from(course_offerings)
      .where(eq(course_offerings.id, enr.offeringId))
      .limit(1);
    const [c] = off
      ? await db.select({ code: courses.code, title: courses.title }).from(courses).where(eq(courses.id, off.courseId)).limit(1)
      : [null];

    await db.insert(grade_objections).values({
      studentId: me.id,
      enrollmentId,
      termId: off?.termId ?? null,
      courseCode: c?.code ?? null,
      courseTitle: c?.title ?? null,
      gradeAtObjection: enr.grade != null ? String(enr.grade) : null,
      requestText: text,
      status: 'PENDING',
      universityId: me.universityId,
    });

    revalidatePath('/student/transcript');
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'خطا در ثبت اعتراض.' };
  }
}
