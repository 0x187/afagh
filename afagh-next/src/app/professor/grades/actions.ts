/**
 * Server Actions ماژول نمرات استاد (گام ۲ نقشهٔ جراحی)
 *
 * هر تغییر نمره از کلاینت این‌جا می‌آید؛ سرور:
 *   ۱) هویت/نقش را با requireRole(['PROFESSOR']) تأیید می‌کند؛
 *   ۲) مقادیر را اعتبارسنجی می‌کند (بازهٔ ۰..۲۰، سقف بارم، ایزوله‌سازی درس مشترک)؛
 *   ۳) در پایگاه داده ثبت می‌کند (Drizzle ORM) — در دمو با خودترمیمی ردیف‌ها؛
 *   ۴) کش مسیر را revalidate می‌کند تا همهٔ بخش‌ها همگام شوند.
 *
 * قرارداد: هر اکشن state قبلی را می‌گیرد (برای useActionState) و همیشه
 * { ok, ... } برمی‌گرداند — هرگز throw نمی‌کند (قابل مصرف در useActionState).
 */
'use server';

import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { createHash } from 'node:crypto';
import { db } from '@/db';
import {
  course_offerings,
  enrollments,
  grade_appeals,
  grade_submission_otps,
  grade_unfinalize_requests,
  offering_professors,
  users,
} from '@/db/schema';
import { getStaffByUser, isDemoMode, requireRole } from '@/lib/auth';
import { globalCompliance } from '@/lib/compliance-integrations';
import { legacyOtpDigest, newOtpCode, otpDigest, otpEqual } from '@/lib/otp';
import { rateLimit } from '@/lib/rateLimit';
import { notifyUserMultichannel, sendSms } from '@/lib/messaging';
import { ensureGradePersistence, resolveStudentRow } from '@/lib/demo-grades-seed';
import { logGradeChange, logBulkGradeChange } from '@/lib/grade-change-log';
import { resolveSamaGradeStatusCode } from '@/lib/resolve-sama-code';
import type { StudentGradeField } from './types';
import { DEFAULT_RUBRIC, SCORE_FIELDS, rubricFieldMax } from './grades-core';

// ─────────────────────────────────────────────────────────────────────────────
// انواع
// ─────────────────────────────────────────────────────────────────────────────

export interface SaveGradeState {
  ok: boolean;
  message?: string;
  error?: string;
  persisted?: boolean;
  savedAt?: string;
}

export interface SaveGradePayload {
  offeringId: number;
  offeringCode: string;
  offeringTitle: string;
  offeringUnits: number;
  termTitle: string;
  studentId: number;        // شناسه در دادهٔ پیش‌نمایش
  studentCode: string;
  fullName: string;
  entryYear: number;
  field: StudentGradeField;
  value: number | null;     // null = پاک کردن
  rubricMax: number;        // سقف بارم همان فیلد (برای اعتبارسنجی سمت سرور)
  coTaughtRole?: 'THEORY' | 'LAB'; // نقش فعلی استاد در درس مشترک
  isCoTaught: boolean;
}

function fail(err: unknown): SaveGradeState {
  return { ok: false, error: (err as Error)?.message || 'خطای ناشناختهٔ سرور.' };
}

function invalid(message: string): SaveGradeState {
  return { ok: false, error: message };
}

function mergedTargets(payload: { offeringId: number; memberOfferingIds?: number[] }): number[] {
  return [...new Set([Number(payload.offeringId), ...((payload.memberOfferingIds ?? []).map(Number))])];
}

async function memberOwnershipOk(staffId: number, targets: number[]): Promise<boolean> {
  if (targets.length === 0) return false;
  const offs = await db
    .select({ id: course_offerings.id, professorId: course_offerings.professorId })
    .from(course_offerings)
    .where(inArray(course_offerings.id, targets));
  if (offs.length !== targets.length) return false;
  const coRows = await db
    .select({ offeringId: offering_professors.offeringId })
    .from(offering_professors)
    .where(and(inArray(offering_professors.offeringId, targets), eq(offering_professors.staffId, staffId)));
  const coSet = new Set(coRows.map(r => r.offeringId));
  return offs.every(o => o.professorId === staffId || coSet.has(o.id));
}

/**
 * نقش/وضعیت درس مشترک از پایگاه داده (مرجع — نه ادعای کلاینت).
 * نگاشت نقش از professor-data.ts: ‏PRACTICAL/LAB → بخش عملی، بقیه → تئوری.
 * درس مشترک = حداقل دو ردیف در offering_professors (همان قاعدهٔ coTaughtPartners).
 */
async function serverCoTeach(
  offeringId: number,
  staffId: number,
): Promise<{ isCoTaught: boolean; role?: 'THEORY' | 'LAB' }> {
  const rows = await db
    .select({ staffId: offering_professors.staffId, role: offering_professors.role })
    .from(offering_professors)
    .where(eq(offering_professors.offeringId, offeringId));
  if (rows.length < 2) return { isCoTaught: false };
  const mine = rows.find(r => r.staffId === staffId);
  const role = mine && (mine.role === 'PRACTICAL' || mine.role === 'LAB') ? 'LAB' as const : 'THEORY' as const;
  return { isCoTaught: true, role };
}

// ─────────────────────────────────────────────────────────────────────────────
// ذخیرهٔ یک نمره (با پس‌زمینهٔ غیرمزاحم — بدون قفل UI)
// ─────────────────────────────────────────────────────────────────────────────

export async function saveGradeAction(
  _prev: SaveGradeState,
  payload: SaveGradePayload
): Promise<SaveGradeState> {
  try {
    const user = await requireRole(['PROFESSOR']);
    const me = await getStaffByUser(user.id);
    if (!me) return invalid('پروندهٔ هیئت علمی یافت نشد.');

    // 🔒 مالکیت: فقط استادِ خودِ ارائه می‌تواند نمره ثبت کند (همان الگوی submitTemporaryAction)
    if (!(await memberOwnershipOk(me.id, [payload.offeringId]))) return invalid('شما استاد مسئول این درس نیستید.');

    // 🔒 قفل نهایی: پس از finalize هیچ ویرایشی از این مسیر مجاز نیست.
    // بازگشایی فقط توسط مدیر انجام می‌شود (قلاب آینده: اکشن unfinalize مخصوص ADMIN که
    // gradesFinalizedAt را پاک می‌کند — این‌جا فقط رد می‌کنیم، UI بازگشایی ساخته نمی‌شود).
    const [offeringLock] = await db
      .select({ gradesFinalizedAt: course_offerings.gradesFinalizedAt })
      .from(course_offerings)
      .where(eq(course_offerings.id, payload.offeringId))
      .limit(1);
    if (offeringLock?.gradesFinalizedAt) {
      return invalid('نمرات این ارائه نهایی شده است؛ تغییر فقط با بازگشایی توسط مدیر.');
    }

    // ۱) اعتبارسنجی فیلد
    if (!SCORE_FIELDS.includes(payload.field)) {
      return invalid('فیلد نمره نامعتبر است.');
    }

    // ۲) اعتبارسنجی عددی: سقف سخت ۰..۲۰.
    // ⚠️ سقف بارم (payload.rubricMax) فقط راهنمای UI است و برای مجوز استفاده نمی‌شود:
    // هیچ جدول بارم سمت سرور وجود ندارد (بارم فقط در DEFAULT_RUBRIC کلاینت است)، پس
    // سرور فقط سقف ۰..۲۰ را اعمال می‌کند. ایزوله‌سازی درس مشترک پایین‌تر از روی
    // نقش پایگاه داده (offering_professors.role) اعمال می‌شود.
    if (payload.value === null) {
      // پاک‌سازی نمره مجاز است
    } else if (!Number.isFinite(payload.value) || payload.value < 0 || payload.value > 20) {
      return invalid('نمره باید بین ۰ تا ۲۰ باشد.');
    }
    // در درس مشترک: ایزوله‌سازی از روی مرجع سرور (نه ادعای کلاینت).
    // ادعای کلاینت فقط می‌تواند محدودیت را بیشتر کند، نه کمتر (تضعیف ممنوع).
    const serverCo = await serverCoTeach(payload.offeringId, me.id);
    const effectiveCoTaught = serverCo.isCoTaught || payload.isCoTaught;
    const effectiveRole = serverCo.role ?? payload.coTaughtRole;
    if (effectiveCoTaught) {
      if (effectiveRole === 'THEORY' && payload.field === 'labProfScore') {
        return invalid('دسترسی: استاد بخش تئوری اجازهٔ تغییر نمرهٔ عملی را ندارد.');
      }
      if (effectiveRole === 'LAB' && payload.field === 'theoryProfScore') {
        return invalid('دسترسی: استاد بخش عملی اجازهٔ تغییر نمرهٔ تئوری را ندارد.');
      }
    }

    // ۳) تضمین ردیف‌های پایه (فقط دمو) — در production داده‌ها seed هستند
    await ensureGradePersistence({
      offeringId: payload.offeringId,
      offeringCode: payload.offeringCode,
      offeringTitle: payload.offeringTitle,
      offeringUnits: payload.offeringUnits,
      termTitle: payload.termTitle,
      professorStaffId: me.id,
      students: [{
        studentId: payload.studentId,
        studentCode: payload.studentCode,
        fullName: payload.fullName,
        entryYear: payload.entryYear,
      }],
    });

    // ۴) ثبت در enrollments (فقط اگر ردیف‌های واقعی موجود باشند)
    const row = await resolveStudentRow(payload.offeringId, payload.studentCode);
    let persisted = false;
    if (row) {
      // 🔒 قفل نمرهٔ نهایی‌شده: این اکشن با `onConflictDoUpdate` ردیف را
      //    DRAFT می‌کرد، یعنی استاد می‌توانست نمرهٔ قطعیِ تأییدشده را خودش
      //    برگرداند. حالا فقط با درخواست بازگشاییِ تأییدشده ممکن است.
      {
        const { assertGradeWriteAllowed } = await import('@/lib/grades/finalize-lock');
        const gate = await assertGradeWriteAllowed(payload.offeringId);
        if (!gate.ok) return invalid(gate.error!);
      }
      const gradeValue = payload.value === null ? null : String(Number(payload.value.toFixed(2)));
      await db
        .insert(enrollments)
        .values({
          studentId: row.student.id,
          offeringId: payload.offeringId,
          status: 'REGISTERED',
          gradeValue,
          gradeStatus: 'DRAFT',
        })
        .onConflictDoUpdate({
          target: [enrollments.studentId, enrollments.offeringId],
          set: { gradeValue, gradeStatus: 'DRAFT' },
        });

      // ثبت تکی در audit log
      const [enr] = await db.select({ id: enrollments.id }).from(enrollments)
        .where(and(eq(enrollments.studentId, row.student.id), eq(enrollments.offeringId, payload.offeringId))).limit(1);
      if (enr) {
        await logGradeChange({
          enrollmentId: enr.id, studentId: row.student.id, offeringId: payload.offeringId,
          action: 'DRAFT', newGradeValue: gradeValue, newGradeStatus: 'DRAFT',
          actorUserId: user.id, actorRole: 'PROFESSOR',
        });
      }

      persisted = true;
    }

    // ۵) همگام‌سازی کش
    revalidatePath('/professor/grades');

    return {
      ok: true,
      persisted,
      savedAt: new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    };
  } catch (err) {
    return fail(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ثبت موقت نمرات (رویت توسط دانشجو + مهلت اعتراض)
// ─────────────────────────────────────────────────────────────────────────────

export async function submitTemporaryAction(
  _prev: SaveGradeState,
  payload: { offeringId: number; offeringCode: string; offeringTitle: string; offeringUnits: number; termTitle: string; professorRank: string; memberOfferingIds?: number[] }
): Promise<SaveGradeState> {
  try {
    const user = await requireRole(['PROFESSOR']);
    const me = await getStaffByUser(user.id);
    if (!me) return invalid('پروندهٔ هیئت علمی یافت نشد.');

    const targets = mergedTargets(payload);
    if (!(await memberOwnershipOk(me.id, targets))) return invalid('شما استاد مسئول این درس نیستید.');

    // 🔒 قفل نهایی: ثبت موقت مجدد روی ارائهٔ نهایی‌شده ممنوع است (همان قاعدهٔ saveGradeAction).
    // تغییر نمرهٔ نهایی‌شده فقط از مسیر دومرحله‌ای درخواست بازگشایی (unfinalize) می‌گذرد.
    const finalizedLocks = await db
      .select({ id: course_offerings.id, gradesFinalizedAt: course_offerings.gradesFinalizedAt })
      .from(course_offerings)
      .where(inArray(course_offerings.id, targets));
    if (finalizedLocks.some(l => l.gradesFinalizedAt)) {
      return invalid('نمرات این ارائه نهایی شده است؛ ثبت موقت مجدد فقط با بازگشایی توسط مدیر (درخواست بازگشایی) امکان‌پذیر است.');
    }

    await ensureGradePersistence({
      offeringId: payload.offeringId,
      offeringCode: payload.offeringCode,
      offeringTitle: payload.offeringTitle,
      offeringUnits: payload.offeringUnits,
      termTitle: payload.termTitle,
      professorStaffId: me.id,
      students: [],
    });

    await db
      .update(course_offerings)
      .set({ gradesTemporaryAt: new Date() })
      .where(inArray(course_offerings.id, targets));
    await db
      .update(enrollments)
      .set({ gradeStatus: 'TEMPORARY' })
      .where(inArray(enrollments.offeringId, targets));

    for (const id of targets) {
      await logBulkGradeChange(id, 'TEMPORARY', user.id, 'PROFESSOR', 'ثبت موقت نمرات توسط استاد');
    }

    revalidatePath('/professor/grades');
    return { ok: true, persisted: true };
  } catch (err) {
    return fail(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// قفل قطعی نمرات با OTP (تماس با grade_submission_otps)
// ─────────────────────────────────────────────────────────────────────────────

/** درخواست صدور کد OTP — کد واقعی تصادفی؛ فقط هش SHA-256 ذخیره می‌شود + پیامک واقعی */
export async function requestFinalizeOtpAction(
  _prev: SaveGradeState,
  payload: { offeringId: number; memberOfferingIds?: number[] }
): Promise<SaveGradeState & { sent?: boolean; demoOtp?: string }> {
  try {
    const user = await requireRole(['PROFESSOR']);
    const me = await getStaffByUser(user.id);
    if (!me) return invalid('پروندهٔ هیئت علمی یافت نشد.');

    // 🔒 مالکیت: فقط استادِ خودِ ارائه می‌تواند کد بگیرد
    const [off] = await db.select({ professorId: course_offerings.professorId })
      .from(course_offerings).where(eq(course_offerings.id, payload.offeringId)).limit(1);
    if (!off) return invalid('ارائهٔ درس یافت نشد.');
    if (off.professorId !== me.id) return invalid('شما استاد مسئول این درس نیستید.');
    const extraMembers = (payload.memberOfferingIds ?? []).map(Number).filter(id => id !== Number(payload.offeringId));
    if (extraMembers.length > 0 && !(await memberOwnershipOk(me.id, extraMembers))) {
      return invalid('شما استاد مسئول این درس نیستید.');
    }

    // 🔒 سقف صدور: ۳ کد در ۱۵ دقیقه به‌ازای هر (استاد + ارائه) — ضد اسپم و
    //    ضد حملهٔ حدسِ کد روی پیامک. پیش از این هیچ محدودیتی نبود.
    const rl = await rateLimit(`gradeotp:issue:${me.id}:${payload.offeringId}`, 3, 15 * 60);
    if (!rl.ok) {
      return invalid('تعداد درخواست کد بیش از حد مجاز است. چند دقیقهٔ دیگر دوباره تلاش کنید.');
    }

    // 🔐 کد ۶ رقمی با HMAC فلفل‌دار + بافت یکتا (پیش از این: ۵ رقمی با
    //    sha256 ساده ⇒ با یک خواندن از دیتابیس/بکاپ در چند میلی‌ثانیه شکسته می‌شد
    //    و قفل نهایی نمره قابل جعل بود).
    const code = newOtpCode();
    const hash = otpDigest(code, `grade:${me.id}:${payload.offeringId}`);
    // هر کد قبلیِ مصرف‌نشده باطل می‌شود (کد تازه جایگزین می‌شود)
    await db
      .delete(grade_submission_otps)
      .where(and(eq(grade_submission_otps.staffId, me.id), eq(grade_submission_otps.offeringId, payload.offeringId)));
    await db
      .insert(grade_submission_otps)
      .values({
        staffId: me.id,
        offeringId: payload.offeringId,
        otpHash: hash,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      })
      .onConflictDoNothing();

    // پیامک واقعی از طریق سرویس‌دهندهٔ پیکربندی‌شده (Kavenegar/SMS.ir/…)
    const [u] = await db.select({ mobile: users.mobile }).from(users).where(eq(users.id, user.id)).limit(1);
    const otpText = `کد تأیید قفل نهایی نمرات (آفاق): ${code} — تا ۵ دقیقه معتبر است.`;
    if (u?.mobile) await sendSms(u.mobile, otpText).catch(() => { /* SMS خاموش/خاموش — ادامه به messenger */ });
    // علاوه بر SMS، از کانال پیام‌رسان متصل استاد (سروش/بله/…) هم بفرست
    await notifyUserMultichannel({ userId: user.id, eventCode: 'GRADE_FINALIZE_OTP', text: otpText, channels: ['SOROUSH', 'BALE', 'EITAA', 'TELEGRAM'] }).catch(() => { /* messenger خاموش */ });

    // در دمو کد در پاسخ برمی‌گردد تا بدون پیامک هم تست شود
    return { ok: true, sent: true, demoOtp: isDemoMode() ? code : undefined };
  } catch (err) {
    return fail(err);
  }
}

/** قفل نهایی نمرات — تأیید OTP از جدول (هش) + مالکیت درس + هش زنجیره‌ای واقعی نمرات */
export async function finalizeSignedAction(
  _prev: SaveGradeState,
  payload: { offeringId: number; otp: string; code: string; groupNo: number; memberOfferingIds?: number[] }
): Promise<SaveGradeState> {
  try {
    const user = await requireRole(['PROFESSOR']);
    const me = await getStaffByUser(user.id);
    if (!me) return invalid('پروندهٔ هیئت علمی یافت نشد.');

    // 🔒 مالکیت درس
    const [off] = await db.select({ professorId: course_offerings.professorId })
      .from(course_offerings).where(eq(course_offerings.id, payload.offeringId)).limit(1);
    if (!off) return invalid('ارائهٔ درس یافت نشد.');
    if (off.professorId !== me.id) return invalid('شما استاد مسئول این درس نیستید.');
    const targets = mergedTargets(payload);
    const extraMembers = targets.filter(id => id !== Number(payload.offeringId));
    if (extraMembers.length > 0 && !(await memberOwnershipOk(me.id, extraMembers))) {
      return invalid('شما استاد مسئول این درس نیستید.');
    }

    // 🔒 بررسی OTP: هش کد ورودی باید با ردیف فعالِ استفاده‌نشده و غیرمنقضی یکی باشد
    const [row] = await db.select().from(grade_submission_otps)
      .where(and(
        eq(grade_submission_otps.staffId, me.id),
        eq(grade_submission_otps.offeringId, payload.offeringId),
        eq(grade_submission_otps.isUsed, 0),
      ))
      .orderBy(desc(grade_submission_otps.id)).limit(1);
    if (!row) return invalid('کد تأییدی فعالی وجود ندارد؛ دوباره درخواست کد بدهید.');
    if (new Date(row.expiresAt).getTime() < Date.now()) return invalid('کد تأیید منقضی شده است؛ کد جدید بگیرید.');
    if (row.lockedAt) return invalid('به دلیل تلاش‌های ناموفق، درخواست امضا قفل شده است.');

    // 🔐 مقایسهٔ HMAC با زمان-ثابت + پذیرش هشِ قدیمیِ در‌جریان
    //    (پیش از این: sha256 ساده با `!==` — هم قابل‌معکوس، هم oracle زمانی).
    const inputHash = otpDigest(payload.otp, `grade:${me.id}:${payload.offeringId}`);
    const legacyHash = legacyOtpDigest(payload.otp);
    if (!otpEqual(inputHash, row.otpHash) && !otpEqual(legacyHash, row.otpHash)) {
      const attempts = (row.attempts ?? 0) + 1;
      await db.update(grade_submission_otps).set({ attempts, lockedAt: attempts >= 5 ? new Date() : null }).where(eq(grade_submission_otps.id, row.id));
      return invalid(`کد تأیید نادرست است. (تلاش ${attempts} از ۵)`);
    }
    await db.update(grade_submission_otps).set({ isUsed: 1 }).where(eq(grade_submission_otps.id, row.id));

    // 🔒 هش زنجیره‌ای واقعی: از خودِ نمرات ذخیره‌شده (ضد دستکاری)
    const grades = await db
      .select({ id: enrollments.id, offeringId: enrollments.offeringId, studentId: enrollments.studentId, gradeValue: enrollments.gradeValue, gradeStatus: enrollments.gradeStatus, samaGradeStatusCode: enrollments.samaGradeStatusCode })
      .from(enrollments)
      .where(inArray(enrollments.offeringId, targets))
      .orderBy(enrollments.offeringId, enrollments.studentId);
    const now = new Date();

    // مادهٔ ۷: اعمال نمرهٔ صفر پیش از ساخت هش زنجیرهای، تا زنجیره با نمرهٔ
    // ذخیرهشده یکسان بماند (تغییر نمره بعد از هش، راستیآزمایی را میشکست).
    const absencePolicy = await globalCompliance().catch(() => null);
    if (absencePolicy?.absence_auto_zero && grades.length > 0) {
      const penaltyRows = await db
        .select({ id: enrollments.id, absencePenalty: enrollments.absencePenalty })
        .from(enrollments)
        .where(inArray(enrollments.id, grades.map(g => g.id)));
      const penalized = new Set(penaltyRows.filter(r => Number(r.absencePenalty) === 1).map(r => r.id));
      for (const g of grades) {
        if (penalized.has(g.id)) (g as { gradeValue: string | null }).gradeValue = '0';
      }
    }
    // 🔗 زنجیره‌سازی: هشِ قبلیِ هر ارائه در ورودی هش جدید گنجانده می‌شود تا
    // نهایی‌سازیِ مجدد روی مقادیر دستکاری‌شده، زنجیره را آشکارا ادامه دهد
    // (ستون gradesHash از قبل وجود دارد — نیازی به مهاجرت نیست).
    const prevHashRows = await db
      .select({ id: course_offerings.id, gradesHash: course_offerings.gradesHash })
      .from(course_offerings)
      .where(inArray(course_offerings.id, targets));
    const prevHashById = new Map(prevHashRows.map(r => [r.id, r.gradesHash]));
    for (const targetId of targets) {
      const memberGrades = grades.filter(gr => gr.offeringId === targetId);
      const chainInput = JSON.stringify({
        offeringId: targetId,
        finalizedAt: now.toISOString(),
        prevHash: prevHashById.get(targetId) ?? null,
        grades: memberGrades.map(gr => [gr.studentId, gr.gradeValue, gr.gradeStatus]),
      });
      const memberHash = 'SHA256:' + createHash('sha256').update(chainInput).digest('hex');
      await db
        .update(course_offerings)
        .set({ gradesFinalizedAt: now, gradesHash: memberHash })
        .where(eq(course_offerings.id, targetId));
    }

    // نهایی‌سازی + محاسبه کد وضعیت سما برای هر دانشجو
    for (const g of grades) {
      const samaCode = await resolveSamaGradeStatusCode(g.studentId, g.offeringId, g.gradeValue, g.samaGradeStatusCode ?? null);
      await db
        .update(enrollments)
        .set({ gradeStatus: 'FINALIZED', samaGradeStatusCode: samaCode })
        .where(eq(enrollments.id, g.id));

      await logGradeChange({
        enrollmentId: g.id,
        studentId: g.studentId,
        offeringId: g.offeringId,
        action: 'FINALIZED',
        oldGradeValue: g.gradeValue,
        newGradeValue: g.gradeValue,
        oldGradeStatus: g.gradeStatus,
        newGradeStatus: 'FINALIZED',
        newSamaStatusCode: samaCode,
        actorUserId: user.id,
        actorRole: 'PROFESSOR',
        reason: 'نهایی‌سازی نمرات با OTP',
      });
    }

    revalidatePath('/professor/grades');
    return { ok: true, persisted: true };
  } catch (err) {
    return fail(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// رسیدگی به اعتراض دانشجو (کارتابل)
// ─────────────────────────────────────────────────────────────────────────────

export interface ResolveAppealPayload {
  appealId: number;
  studentCode: string;
  offeringId: number;
  decision: 'ACCEPTED' | 'REJECTED';
  reply: string;
  newGrade: number; // نمرهٔ محاسبه‌شده از ریزمولفه‌ها (در صورت پذیرش)
  // ریزمولفه‌ها (اختیاری): اگر داده شود، سرور نمرهٔ جدید را خودش از روی آن‌ها
  // بازمحاسبه می‌کند و مقدار newGrade کلاینت فقط سقف پشتیبان است.
  components?: {
    midtermScore?: number;
    homeworkScore?: number;
    participationScore?: number;
    practicalScore?: number;
    finalExamScore?: number;
  } | null;
}

/**
 * بازمحاسبهٔ سروری نمره از ریزمولفه‌ها با سقف بارم مرجع (DEFAULT_RUBRIC).
 * هر مؤلفه باید عدد متناهی ≥۰ باشد؛ در غیر این صورت null (یعنی «قابل بازمحاسبه نیست»).
 */
function recomputeAppealGradeFromComponents(comp: NonNullable<ResolveAppealPayload['components']>): number | null {
  const entries: Array<[StudentGradeField, number | undefined]> = [
    ['midtermScore', comp.midtermScore],
    ['homeworkScore', comp.homeworkScore],
    ['participationScore', comp.participationScore],
    ['practicalScore', comp.practicalScore],
    ['finalExamScore', comp.finalExamScore],
  ];
  let sum = 0;
  let seen = 0;
  for (const [field, v] of entries) {
    if (v === undefined) continue;
    if (!Number.isFinite(v) || (v as number) < 0) return null;
    sum += Math.min(v as number, rubricFieldMax(field, DEFAULT_RUBRIC));
    seen++;
  }
  if (seen === 0) return null;
  return Math.max(0, Math.min(20, Math.round(sum * 100) / 100));
}

export async function resolveAppealAction(
  _prev: SaveGradeState,
  payload: ResolveAppealPayload
): Promise<SaveGradeState> {
  try {
    const user = await requireRole(['PROFESSOR']);
    const me = await getStaffByUser(user.id);
    if (!me) return invalid('پروندهٔ هیئت علمی یافت نشد.');

    // 🔒 مالکیت: فقط استادِ خودِ ارائه می‌تواند به اعتراض رسیدگی کند
    if (!(await memberOwnershipOk(me.id, [payload.offeringId]))) return invalid('شما استاد مسئول این درس نیستید.');

    if (payload.decision !== 'ACCEPTED' && payload.decision !== 'REJECTED') {
      return invalid('تصمیم نامعتبر است.');
    }
    if (payload.decision === 'ACCEPTED' &&
        (!Number.isFinite(payload.newGrade) || payload.newGrade < 0 || payload.newGrade > 20)) {
      return invalid('نمرهٔ جدید باید بین ۰ تا ۲۰ باشد.');
    }
    if (payload.reply.length > 1000) return invalid('متن پاسخ بیش از حد طولانی است.');

    const [appeal] = await db
      .select()
      .from(grade_appeals)
      .where(and(eq(grade_appeals.id, payload.appealId), eq(grade_appeals.status, 'OPEN')))
      .limit(1);
    if (!appeal) return invalid('اعتراض یافت نشد یا قبلاً بسته شده است.');

    // 🔒 تطابق: اعتراض باید متعلق به همین ارائه و همین دانشجو باشد
    // (جدول grade_appeals فقط enrollmentId دارد — تطابق از روی enrollments بررسی می‌شود)
    const [appealEnr] = await db.select({
      id: enrollments.id, studentId: enrollments.studentId, offeringId: enrollments.offeringId,
      gradeValue: enrollments.gradeValue, gradeStatus: enrollments.gradeStatus,
    }).from(enrollments).where(eq(enrollments.id, appeal.enrollmentId)).limit(1);
    if (!appealEnr || appealEnr.offeringId !== payload.offeringId) {
      return invalid('مشخصات اعتراض با این ارائه مطابقت ندارد.');
    }
    // 🔒 قفل نهایی: رسیدگیِ پذیرش روی نمرهٔ FINALIZED ممنوع است — حتی gradeValue هم
    // دست نمی‌خورد. تغییر نمرهٔ نهایی‌شده فقط از مسیر دومرحله‌ای بازگشایی (unfinalize) می‌گذرد.
    if (payload.decision === 'ACCEPTED' && appealEnr.gradeStatus === 'FINALIZED') {
      return invalid('این نمره نهایی شده است؛ تغییر آن فقط با درخواست بازگشایی و تأیید مدیر امکان‌پذیر است.');
    }
    if (payload.decision === 'ACCEPTED') {
      const { assertGradeWriteAllowed } = await import('@/lib/grades/finalize-lock');
      const gate = await assertGradeWriteAllowed(payload.offeringId);
      if (!gate.ok) return invalid(gate.error!);
    }
    const appealStudent = await resolveStudentRow(payload.offeringId, payload.studentCode);
    if (!appealStudent || appealStudent.student.id !== appealEnr.studentId) {
      return invalid('مشخصات اعتراض با این دانشجو مطابقت ندارد.');
    }

    // 🧮 نمرهٔ جدید: بازمحاسبهٔ سروری از ریزمولفه‌ها هرجا موجود باشد (درس تک‌استادی)؛
    // در غیر این صورت مقدار کلاینت با سقف ۰..۲۰. مقدار کلاینت هرگز کورکورانه اعتماد نمی‌شود.
    let serverNewGrade = payload.newGrade;
    if (payload.decision === 'ACCEPTED' && payload.components) {
      const serverCo = await serverCoTeach(payload.offeringId, me.id);
      if (!serverCo.isCoTaught) {
        const recomputed = recomputeAppealGradeFromComponents(payload.components);
        if (recomputed !== null) serverNewGrade = recomputed;
      }
    }
    serverNewGrade = Math.max(0, Math.min(20, Number(Number(serverNewGrade).toFixed(2))));

    await db
      .update(grade_appeals)
      .set({
        status: payload.decision,
        professorReply: payload.reply,
        newGrade: payload.decision === 'ACCEPTED' ? String(serverNewGrade) : undefined,
      })
      .where(eq(grade_appeals.id, payload.appealId));

    if (payload.decision === 'ACCEPTED') {
      const row = await resolveStudentRow(payload.offeringId, payload.studentCode);
      if (row) {
        const newGradeStr = String(serverNewGrade);
        const [enr] = await db.select({ id: enrollments.id, gradeValue: enrollments.gradeValue, gradeStatus: enrollments.gradeStatus }).from(enrollments)
          .where(and(eq(enrollments.studentId, row.student.id), eq(enrollments.offeringId, payload.offeringId))).limit(1);

        // وضعیت نمره دست نمی‌خورد: به‌ویژه نمرهٔ FINALIZED نباید به TEMPORARY تنزل یابد.
        await db
          .update(enrollments)
          .set({ gradeValue: newGradeStr })
          .where(and(eq(enrollments.studentId, row.student.id), eq(enrollments.offeringId, payload.offeringId)));

        if (enr) {
          await logGradeChange({
            enrollmentId: enr.id, studentId: row.student.id, offeringId: payload.offeringId,
            action: 'APPEAL', oldGradeValue: enr.gradeValue, newGradeValue: newGradeStr,
            oldGradeStatus: enr.gradeStatus, newGradeStatus: enr.gradeStatus,
            reason: `پذیرش اعتراض: ${payload.reply}`,
            actorUserId: user.id,
            actorRole: 'PROFESSOR',
          });
        }
      }
    }

    revalidatePath('/professor/grades');
    revalidatePath('/student');
    return { ok: true, persisted: true };
  } catch (err) {
    return fail(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// درخواست بازگشایی نمرات نهایی‌شده (تأیید دومرحله‌ای توسط مدیر)
// ─────────────────────────────────────────────────────────────────────────────

export async function requestUnfinalizeAction(
  offeringId: number,
  reason: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const user = await requireRole(['PROFESSOR']);
    const me = await getStaffByUser(user.id);
    if (!me) return { ok: false, error: 'پروندهٔ هیئت علمی یافت نشد.' };
    if (!(await memberOwnershipOk(me.id, [offeringId]))) {
      return { ok: false, error: 'شما استاد مسئول این درس نیستید.' };
    }
    const [off] = await db
      .select({ id: course_offerings.id, gradesFinalizedAt: course_offerings.gradesFinalizedAt, universityId: course_offerings.universityId })
      .from(course_offerings)
      .where(eq(course_offerings.id, offeringId))
      .limit(1);
    if (!off) return { ok: false, error: 'ارائهٔ درس یافت نشد.' };
    if (!off.gradesFinalizedAt) return { ok: false, error: 'نمرات این ارائه نهایی نشده است.' };
    const clean = (reason ?? '').trim();
    if (clean.length < 10) return { ok: false, error: 'دلیل درخواست الزامی است (حداقل ۱۰ نویسه).' };
    const existing = await db
      .select({ id: grade_unfinalize_requests.id, status: grade_unfinalize_requests.status })
      .from(grade_unfinalize_requests)
      .where(and(
        eq(grade_unfinalize_requests.offeringId, offeringId),
        inArray(grade_unfinalize_requests.status, ['PENDING', 'REVIEWED']),
      ))
      .limit(1);
    if (existing.length > 0) {
      return { ok: false, error: 'برای این ارائه یک درخواست باز در جریان است.' };
    }
    await db.insert(grade_unfinalize_requests).values({
      offeringId,
      requestedByUserId: user.id,
      reason: clean,
      status: 'PENDING',
      universityId: off.universityId,
    });
    revalidatePath('/professor/grades');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message || 'خطای ناشناختهٔ سرور.' };
  }
}

export async function getMyUnfinalizeRequests(
  offeringIds: number[],
): Promise<Record<number, { status: string; createdAt: string }>> {
  const out: Record<number, { status: string; createdAt: string }> = {};
  try {
    if (!offeringIds || offeringIds.length === 0) return out;
    const user = await requireRole(['PROFESSOR']);
    const rows = await db
      .select({
        offeringId: grade_unfinalize_requests.offeringId,
        status: grade_unfinalize_requests.status,
        createdAt: grade_unfinalize_requests.createdAt,
      })
      .from(grade_unfinalize_requests)
      .where(and(
        inArray(grade_unfinalize_requests.offeringId, offeringIds),
        eq(grade_unfinalize_requests.requestedByUserId, user.id),
      ))
      .orderBy(desc(grade_unfinalize_requests.id));
    for (const r of rows) {
      if (!(r.offeringId in out)) {
        out[r.offeringId] = {
          status: r.status,
          createdAt: r.createdAt ? new Date(r.createdAt).toLocaleString('fa-IR') : '',
        };
      }
    }
    return out;
  } catch {
    return out;
  }
}
