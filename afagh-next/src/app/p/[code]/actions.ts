'use server';

import { and, eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { course_offerings, class_sessions, offering_professors, professor_class_attendance } from '@/db/schema';
import { getSessionUser, getStaffByUser, type SessionUser } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { checkinState, parseRoomCode, tehranNow } from '@/lib/room-checkin';
import { getRoomContext, listSessionsInRoom } from '@/lib/room-session-lookup';
import { resolveMergedSessionTargets } from '@/lib/merged-class-sessions';
import {
  canControlRoom,
  getRecorderPolicy,
  type RecorderPolicy,
} from '@/lib/attendance-control';

/**
 * ثبت حضورِ استاد در یک جلسه — هستهٔ مشترکِ صفحهٔ QR و کارتابل کنترل‌کننده.
 *
 * ⚠ این تابع تنها مرجعِ تصمیم است. صفحه فقط «نمایش» می‌دهد؛ هر درخواستی —
 * حتی اگر از UI دستکاری‌شده بیاید — اینجا دوباره کامل بررسی می‌شود:
 *   ۱) کاربر وارد شده و پروندهٔ هیئت علمی دارد.
 *   ۲) جلسه واقعاً در همین اتاق و در «امروزِ تهران» است
 *      (با همان تابعِ حلِ اتاق که صفحه استفاده می‌کند، تا هرگز واگرا نشوند).
 *   ۳) اکنون داخل پنجرهٔ مجاز است (نه زودتر، نه بعد از مهلت).
 *   ۴) یکی از دو مسیرِ مجاز برقرار است:
 *        الف) استادِ همان درس است  → حضورِ خودش را ثبت می‌کند (QR_SCAN)
 *        ب) کنترل‌کنندهٔ مجازِ اتاق → حضورِ استادِ کلاس را ثبت می‌کند
 *           (QR_BY_CONTROLLER، با `confirmedByStaffId` = خودش)
 *      کدام مسیر مجاز است با تنظیمِ `ATTENDANCE_RECORDER_MODE` تعیین می‌شود.
 *   ۵) مرزِ بین‌دانشگاهی رعایت شده است.
 *   ۶) ثبت تکراری انجام نمی‌شود (به‌ازای هر جلسه یک ردیف برای هر استاد).
 *   ۷) اگر جلسه جزءِ یک «کلاس ادغامی» باشد، ثبت روی همهٔ جلسه‌های عضو اعمال
 *      می‌شود — کاربر فقط ردیفِ نماینده را می‌بیند و یک بار «ثبت حضور» می‌زند.
 */
interface RecordCoreResult {
  ok: boolean;
  error?: string;
  via?: 'professor' | 'controller';
  staffId?: number;
  already?: boolean;
  /** چند جلسه در همین درخواست ثبت شد (کلاس ادغامی = بیش از یکی) */
  recordedCount?: number;
  /** آیا این جلسه جزءِ یک کلاسِ ادغامی بود؟ */
  merged?: boolean;
}

async function recordCore(px: {
  roomId: number;
  sessionId: number;
  user: SessionUser;
  date?: string;
}): Promise<RecordCoreResult> {
  const { roomId, sessionId, user } = px;

  const me = await getStaffByUser(user.id);
  if (!me) return { ok: false, error: 'notstaff' };

  const now = tehranNow();
  const jalaliDate = (px.date || '').trim() || now.jalali;

  // همان منبعِ حقیقتی که صفحه استفاده می‌کند: اتاق از برنامهٔ هفتگی حل می‌شود.
  const todaySessions = await listSessionsInRoom(roomId, jalaliDate);
  const session = todaySessions.find((s) => s.id === sessionId);
  if (!session) return { ok: false, error: 'nosession' };

  const isAdmin = user.roles.includes('ADMIN');
  if (!isAdmin && checkinState(session.startTime, session.endTime, now.minutes) !== 'OPEN') {
    return { ok: false, error: 'window' };
  }

  const [offering] = await db
    .select({ professorId: course_offerings.professorId })
    .from(course_offerings)
    .where(eq(course_offerings.id, session.offeringId))
    .limit(1);
  if (!offering) return { ok: false, error: 'nosession' };

  // مرزِ بین‌دانشگاهی — همان گاردِ صفحه، اینجا هم چون سرور مرجعِ نهاییِ تصمیم است.
  const room = await getRoomContext(roomId);
  if (!room) return { ok: false, error: 'badroom' };

  const myUni = me.universityId ?? user.universityId ?? null;
  if (myUni != null && room.universityId != null && myUni !== room.universityId) {
    return { ok: false, error: 'wronguni' };
  }

  // ── مسیرِ الف: استادِ خودِ درس ──
  let owns = offering.professorId === me.id;
  if (!owns) {
    const [shared] = await db
      .select({ id: offering_professors.id })
      .from(offering_professors)
      .where(and(
        eq(offering_professors.offeringId, session.offeringId),
        eq(offering_professors.staffId, me.id),
      ))
      .limit(1);
    owns = !!shared;
  }

  let policy: RecorderPolicy;
  let controlAllowed = false;
  try {
    policy = await getRecorderPolicy();
    controlAllowed = (await canControlRoom(user.id, roomId)).allowed;
  } catch {
    // اگر تنظیمات در دسترس نبود، محافظه‌کارانه‌ترین حالت: فقط استادِ خودش
    policy = { mode: 'PROFESSOR', professorAllowed: true, controllerAllowed: false, roomScoped: true };
  }

  let via: 'professor' | 'controller' | null = null;
  if (owns && policy.professorAllowed) via = 'professor';
  else if (controlAllowed && policy.controllerAllowed) via = 'controller';

  if (!via) {
    if (owns) return { ok: false, error: 'profblocked' };
    if (controlAllowed) return { ok: false, error: 'ctrlblocked' };
    return { ok: false, error: 'notyours' };
  }

  /* ── گسترش به کلِ «کلاس ادغامی» ───────────────────────────────────────
     یک کلاسِ فیزیکی ممکن است چند عرضه داشته باشد («ریاضی» و «ریاضی ۱» با یک
     استاد، یک اتاق، ساعت ۸). کاربر فقط ردیفِ نماینده را می‌بیند و یک بار
     «ثبت حضور» می‌زند؛ اینجا همهٔ جلسه‌های عضو هم ثبت می‌شوند تا آن کلاس
     برای همیشه «بدون حضور» نماند (که حق‌التدریس را ناقوب می‌کرد).

     ⚠ مسیرِ «استادِ خودش» فقط روی عرضه‌هایی ثبت می‌کند که واقعاً استادِ
       آن‌هاست؛ وگرنه حضورِ یک استاد روی کلاسِ استادِ دیگری نوشته می‌شد.
       مسیرِ «کنترل‌کننده» روی همهٔ اعضا ثبت می‌کند، هر کدام به نامِ
       استادِ خودش. */
  const targets = await resolveMergedSessionTargets({
    roomId,
    sessionId: session.id,
    offeringId: session.offeringId,
    sessionDate: session.sessionDate,
    startTime: session.startTime,
    endTime: session.endTime,
    roomSessions: todaySessions,
  });

  // استادی که برای هر جلسه باید ثبت شود (برای مسیرِ کنترل‌کننده از خودِ عرضه)
  const staffFor = new Map<number, number | null>();
  for (const sid of targets.sessionIds) {
    const [o] = await db
      .select({ professorId: course_offerings.professorId })
      .from(class_sessions)
      .innerJoin(course_offerings, eq(course_offerings.id, class_sessions.offeringId))
      .where(eq(class_sessions.id, sid))
      .limit(1);
    if (via === 'professor') {
      const mine = o?.professorId === me.id;
      if (!mine) {
        const [shared] = await db
          .select({ id: offering_professors.id })
          .from(offering_professors)
          .innerJoin(class_sessions, eq(class_sessions.offeringId, offering_professors.offeringId))
          .where(and(eq(class_sessions.id, sid), eq(offering_professors.staffId, me.id)))
          .limit(1);
        staffFor.set(sid, shared ? me.id : null);
      } else {
        staffFor.set(sid, me.id);
      }
    } else {
      staffFor.set(sid, o?.professorId ?? null);
    }
  }

  const h = await headers();
  const forwarded = (h.get('x-forwarded-for') ?? '').split(',')[0].trim();
  const ip = (forwarded || h.get('x-real-ip') || '').slice(0, 50) || null;
  const ua = (h.get('user-agent') ?? '').slice(0, 500) || null;

  let recordedCount = 0;
  let eligibleCount = 0;
  let alreadyAll = true;
  for (const sid of targets.sessionIds) {
    const recordedStaffId = staffFor.get(sid) ?? null;
    if (recordedStaffId == null) continue;
    eligibleCount++;

    // ثبت تکراری: دوباره‌اسکن نباید ردیف دوم بسازد و نباید مهرِ زمانی اول را خراب کند.
    const [existing] = await db
      .select({ id: professor_class_attendance.id })
      .from(professor_class_attendance)
      .where(and(
        eq(professor_class_attendance.sessionId, sid),
        eq(professor_class_attendance.staffId, recordedStaffId),
      ))
      .limit(1);
    if (existing) continue;
    alreadyAll = false;

    await db.insert(professor_class_attendance).values({
      sessionId: sid,
      staffId: recordedStaffId,
      // همان مقداری که کامنتِ ستون در schema برای اسکن QR نام برده است.
      verificationMethod: via === 'professor' ? 'QR_SCAN' : 'QR_BY_CONTROLLER',
      status: 'VALID',
      recordedIpAddress: ip,
      deviceUserAgent: ua,
      // در مسیرِ کنترل‌کننده، «چه کسی ثبت کرد» جدا از «حضورِ چه کسی» نگه داشته می‌شود.
      confirmedByStaffId: via === 'controller' ? me.id : null,
      note: via === 'controller'
        ? (targets.merged
          ? 'ثبت با اسکن QR سردر توسط کنترل‌کنندهٔ حضور و غیاب (کلاس ادغامی)'
          : 'ثبت با اسکن QR سردر توسط کنترل‌کنندهٔ حضور و غیاب')
        : (targets.merged ? 'ثبت با اسکن QR سردر (کلاس ادغامی)' : null),
      universityId: room.universityId ?? null,
    });
    recordedCount++;
  }

  // هیچ جلسه‌ای استادِ ثبت‌شدنی نداشت — همان خطای پیشین («برای این جلسه استادی ثبت نشده»).
  if (eligibleCount === 0) return { ok: false, error: 'noprof' };

  logger.info('class_attendance_recorded', {
    sessionId: session.id,
    staffId: via === 'professor' ? me.id : undefined,
    recordedByStaffId: me.id,
    via,
    roomId,
    offeringId: session.offeringId,
    at: now.jalali,
    minutes: now.minutes,
    mergedGroup: targets.merged ? targets.sessionIds : undefined,
    recordedCount,
    createdSessions: targets.createdSessionIds.length ? targets.createdSessionIds : undefined,
  });

  return {
    ok: true,
    via,
    staffId: via === 'professor' ? me.id : undefined,
    already: alreadyAll,
    recordedCount,
    merged: targets.merged,
  };
}

/** ثبت حضور از صفحهٔ QRِ سردر (فرمِ HTML) — با redirect و پیام */
export async function recordRoomAttendance(formData: FormData): Promise<void> {
  const rawCode = String(formData.get('code') ?? '').trim();
  const roomId = parseRoomCode(rawCode);
  // مسیرِ بازگشت همیشه از کدِ خودِ فرم ساخته می‌شود تا کاربر به صفحهٔ درست برگردد.
  const back = `/p/${roomId ? `room-${roomId}` : 'room-0'}`;

  if (!roomId) redirect(`${back}?err=badroom`);

  const sessionId = Number(formData.get('sessionId'));
  if (!Number.isInteger(sessionId) || sessionId <= 0) redirect(`${back}?err=nosession`);

  const user = await getSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(back)}`);

  const res = await recordCore({ roomId, sessionId, user });
  if (!res.ok) redirect(`${back}?err=${res.error ?? 'unknown'}`);

  revalidatePath(back);
  revalidatePath('/professor/attendance');
  revalidatePath('/admin/attendance-control');
  redirect(
    `${back}?msg=${
      res.already
        ? 'already'
        : res.via === 'controller'
          ? (res.merged ? 'okctrlmerged' : 'okctrl')
          : (res.merged ? 'okmerged' : 'ok')
    }`,
  );
}

/**
 * همان هسته، ولی برای کارتابل کنترل‌کننده — نتیجه به‌جای redirect برگردانده
 * می‌شود تا UI بتواند بدون پرشِ صفحه، ردیف را «ثبت شد» کند.
 */
export async function recordAttendanceFromConsole(px: {
  roomId: number;
  sessionId: number;
  date?: string;
}): Promise<{
  ok: boolean;
  error?: string;
  via?: 'professor' | 'controller';
  already?: boolean;
  recordedCount?: number;
  merged?: boolean;
}> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'notloggedin' };

  const roomId = Number(px.roomId);
  const sessionId = Number(px.sessionId);
  if (!roomId || !sessionId) return { ok: false, error: 'nosession' };

  const res = await recordCore({ roomId, sessionId, user });
  if (res.ok) {
    revalidatePath('/admin/attendance-control');
    revalidatePath('/professor/attendance');
    revalidatePath(`/p/room-${roomId}`);
  }
  return res.ok
    ? { ok: true, via: res.via, already: res.already, recordedCount: res.recordedCount, merged: res.merged }
    : { ok: false, error: res.error };
}
