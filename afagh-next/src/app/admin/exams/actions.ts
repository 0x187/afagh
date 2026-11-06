'use server';

// ════════════════════════════════════════════════════════════════════════
// فاز ۸ (گام ۵ نقشهٔ ۱۰ گامی) — Server Actions صفحهٔ اداری امتحانات
// ────────────────────────────────────────────────────────────────────────
// D3: الگوی استاندارد «Server Actions» — گارد مستقیم + تراکنش موتور +
// auditChain + { ok,error } فارسی. هیچ دادهٔ Mock در کلاینت؛ همه از DB.
// ════════════════════════════════════════════════════════════════════════

import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import {
  academic_terms, course_exam_sessions, course_offerings, courses, exam_attendances,
  exam_halls, exam_sessions, invigilators, schedules, staff, users,
} from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { getCurrentUniversity } from '@/lib/university-scope';
import { pickEffectiveTerm } from '@/lib/term-scope';
import * as engine from '@/lib/exam-engine';
import { normalizeExamDate } from '@/lib/shamsi';

const EDITORS = ['ADMIN', 'EDU_EXPERT'];

/** نرمال‌سازی تاریخ سشن به شمسی YYYY/MM/DD (ردیف قدیمی میلادی → تبدیل) */
function normSessionDate(v: unknown): string {
  return normalizeExamDate(v) ?? String(v ?? '');
}

// ─────────────────────────── helpers (غیر export — گارد CI) ───────────────────────────

async function listRealTerms(universityId?: number) {
  const where = universityId ? eq(academic_terms.universityId, universityId) : undefined;
  return db
    .select({
      id: academic_terms.id,
      code: academic_terms.termCode,
      title: academic_terms.title,
      isCurrent: academic_terms.isCurrent,
      // تاریخ‌ها لازم است تا «نیمسال فعال» تاریخ‌محور انتخاب شود (پرچم isCurrent
      // ممکن است سال‌ها روی چند ترم کهنه مانده باشد)
      startDate: academic_terms.startDate,
      endDate: academic_terms.endDate,
    })
    .from(academic_terms)
    .where(where)
    .orderBy(desc(academic_terms.id));
}

/** سشن‌های واقعی ترم + مراقبین هر سشن + آمار حضور */
async function loadSessions(termId: number, universityId?: number) {
  const where = universityId
    ? and(eq(exam_sessions.termId, termId), eq(exam_sessions.universityId, universityId))
    : eq(exam_sessions.termId, termId);
  const sessions = await db
    .select()
    .from(exam_sessions)
    .where(where)
    .orderBy(asc(exam_sessions.examDate), asc(exam_sessions.startTime));

  if (sessions.length === 0) return [];
  const ids = sessions.map(s => s.id);

  const [inv, att] = await Promise.all([
    db
      .select({
        sessionId: invigilators.sessionId,
        hallId: invigilators.hallId,
        role: invigilators.role,
        attendanceStatus: invigilators.attendanceStatus,
        staffId: invigilators.staffId,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(invigilators)
      .leftJoin(staff, eq(staff.id, invigilators.staffId))
      .leftJoin(users, eq(users.id, staff.userId))
      .where(inArray(invigilators.sessionId, ids)),
    db
      .select({
        sessionId: exam_attendances.examId,
        present: sql<number>`count(*) filter (where ${exam_attendances.isPresent} = 1)::int`,
        total: sql<number>`count(*)::int`,
      })
      .from(exam_attendances)
      .where(inArray(exam_attendances.examId, ids))
      .groupBy(exam_attendances.examId),
  ]);

  return sessions.map(s => ({
    id: s.id,
    // قرارداد: exam_sessions شمسی YYYY/MM/DD است؛ اما ردیف‌های قدیمی/مهاجرتی
    // میلادی YYYY-MM-DD دارند — این‌جا نرمال می‌کنیم تا UI همیشه شمسی ببیند.
    examDate: normSessionDate(s.examDate),
    startTime: s.startTime,
    endTime: s.endTime,
    proctors: inv
      .filter(i => i.sessionId === s.id)
      .map(i => ({
        staffId: i.staffId,
        name: i.firstName ? `${i.firstName} ${i.lastName ?? ''}`.trim() : '—',
        hallId: i.hallId,
        role: i.role ?? 'PROCTOR',
        attendanceStatus: i.attendanceStatus ?? 'PENDING',
      })),
    attendance: {
      present: Number(att.find(a => a.sessionId === s.id)?.present ?? 0),
      total: Number(att.find(a => a.sessionId === s.id)?.total ?? 0),
    },
  }));
}

/** دروس امتحانی: schedules با scheduleType='EXAM' + جزئیات + بستهٔ اوراق */
async function loadExamCourses(termId: number, universityId?: number) {
  // فیلتر دانشگاه از روی ارائهٔ درس (نه سالن) تا ردیف‌های بدون سالن حذف نشوند
  const uniFilter = universityId ? eq(course_offerings.universityId, universityId) : undefined;
  const rows = await db
    .select({
      offeringId: course_offerings.id,
      courseCode: courses.code,
      courseTitle: courses.title,
      units: courses.units,
      groupNumber: course_offerings.groupNumber,
      professorId: course_offerings.professorId,
      profFirstName: users.firstName,
      profLastName: users.lastName,
      examDate: schedules.examDate,
      startTime: schedules.startTime,
      endTime: schedules.endTime,
      roomId: schedules.roomId,
      roomName: exam_halls.name,
      buildingName: exam_halls.buildingName,
      expectedSheets: course_exam_sessions.totalExpectedSheets,
      deliveredSheets: course_exam_sessions.totalDeliveredSheets,
      isFullyCollected: course_exam_sessions.isFullyCollected,
    })
    .from(schedules)
    .innerJoin(course_offerings, eq(course_offerings.id, schedules.offeringId))
    .innerJoin(courses, eq(courses.id, course_offerings.courseId))
    .leftJoin(staff, eq(staff.id, course_offerings.professorId))
    .leftJoin(users, eq(users.id, staff.userId))
    .leftJoin(exam_halls, eq(exam_halls.id, schedules.roomId))
    .leftJoin(course_exam_sessions, eq(course_exam_sessions.courseOfferingId, course_offerings.id))
    .where(and(eq(schedules.scheduleType, 'EXAM'), sql`${schedules.examDate} is not null`, eq(course_offerings.termId, termId), uniFilter))
    .orderBy(courses.code);

  return rows.map(r => ({
    offeringId: r.offeringId,
    courseCode: r.courseCode,
    courseTitle: r.courseTitle,
    units: String(r.units),
    groupNumber: r.groupNumber,
    professorId: r.professorId,
    professorName: r.profFirstName ? `${r.profFirstName} ${r.profLastName ?? ''}`.trim() : 'تخصیص‌نیافته',
    // ⚠ تاریخ در این ستون می‌تواند شمسیِ ذخیره‌شده (۱۴۰۵-۱۰-۲۸) یا میلادی باشد؛
    // `normalizeExamDate` هر دو را می‌شناسد. پیش‌تر کورکورانه میلادی فرض می‌شد و
    // تاریخ‌ها به شکل ۷۸۴/۰۸/۰۶ درمی‌آمدند.
    examDate: normalizeExamDate(r.examDate),
    startTime: String(r.startTime ?? '').slice(0, 5),
    endTime: String(r.endTime ?? '').slice(0, 5),
    roomName: r.roomName ?? '—',
    buildingName: r.buildingName ?? '—',
    expectedSheets: Number(r.expectedSheets ?? 0),
    deliveredSheets: Number(r.deliveredSheets ?? 0),
    isFullyCollected: Number(r.isFullyCollected ?? 0) === 1,
  }));
}

async function loadHalls(universityId?: number) {
  const where = universityId ? eq(exam_halls.universityId, universityId) : undefined;
  const rows = await db
    .select({
      id: exam_halls.id,
      name: exam_halls.name,
      buildingName: exam_halls.buildingName,
      totalCapacity: exam_halls.totalCapacity,
      rowsCount: exam_halls.rowsCount,
      colsCount: exam_halls.colsCount,
    })
    .from(exam_halls)
    .where(where)
    .orderBy(asc(exam_halls.id));
  return rows;
}

// ─────────────────────────── اکشن‌ها ───────────────────────────

export type ExamWorkspaceResult =
  | {
      ok: true;
      data: {
        terms: { id: number; code: string; title: string; isCurrent: boolean }[];
        selectedTermId: number | null;
        sessions: Awaited<ReturnType<typeof loadSessions>>;
        courses: Awaited<ReturnType<typeof loadExamCourses>>;
        halls: Awaited<ReturnType<typeof loadHalls>>;
        /** سشن‌های هم‌زمان (تاریخ + ساعت شروع یکسان) — کاندیدای تداخل */
        concurrentCount: number;
        /** سشن‌های فیزیکیِ بدون هیچ درس رزروشده (یتیم) — تقویم معیار = جدول دروس امتحانی (schedules نوع EXAM) */
        orphanSessionCount: number;
      };
    }
  | { ok: false; error: string };

/** کارتابل واقعی صفحهٔ اداری امتحانات (جایگزین Mock های ۲۶۵۷ خطی) */
export async function getExamWorkspaceAction(termId?: number, universityId?: number): Promise<ExamWorkspaceResult> {
  try {
    await requireRole(EDITORS);
    // دانشگاه فعال سرور معیار است؛ پارامتر کلاینت فقط fallback
    const serverUni = await getCurrentUniversity().catch(() => null);
    const uid = serverUni?.id ?? universityId;
    const terms = await listRealTerms(uid);
    const resolvedTermId = termId ?? pickEffectiveTerm(terms)?.id ?? terms[0]?.id ?? null;

    let sessions: Awaited<ReturnType<typeof loadSessions>> = [];
    let courses: Awaited<ReturnType<typeof loadExamCourses>> = [];
    let concurrentCount = 0;
    let orphanSessionCount = 0;
    if (resolvedTermId != null) {
      [sessions, courses] = await Promise.all([loadSessions(resolvedTermId, uid), loadExamCourses(resolvedTermId, uid)]);
      const seen = new Map<string, number>();
      for (const c of courses) {
        if (!c.examDate || !c.startTime) continue;
        const k = `${c.examDate}|${c.startTime}`;
        seen.set(k, (seen.get(k) ?? 0) + 1);
      }
      concurrentCount = Array.from(seen.values()).filter(n => n > 1).length;
      // تقویم معیار = دروس امتحانی (schedules)؛ سشن فیزیکیِ بدون درس = یتیم
      const courseKeys = new Set(
        courses.filter(c => c.examDate && c.startTime).map(c => `${c.examDate}|${String(c.startTime).slice(0, 5)}`),
      );
      orphanSessionCount = sessions.filter(
        s => !courseKeys.has(`${s.examDate}|${String(s.startTime).slice(0, 5)}`),
      ).length;
    }
    const halls = await loadHalls(uid);

    return {
      ok: true,
      data: {
        terms: terms.map(t => ({ id: t.id, code: t.code, title: t.title, isCurrent: t.isCurrent === 1 })),
        selectedTermId: resolvedTermId,
        sessions,
        courses,
        halls,
        concurrentCount,
        orphanSessionCount,
      },
    };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'خطا در بارگذاری کارتابل امتحانات.' };
  }
}

/** صدور حضور و غیاب دسته‌ای برای یک سشن (موتور: exam_attendances + seat allocations) */
export async function issueExamAttendanceAction(sessionId: number) {
  try {
    const user = await requireRole(EDITORS);
    const out = await engine.issueExamAttendance(user.id, sessionId);
    revalidatePath('/admin/exams');
    return { ok: true, issued: Number((out as any).issued ?? 0), skipped: Number((out as any).skipped ?? 0) };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'خطا در صدور حضور و غیاب.' };
  }
}

/** امضای صورت‌جلسهٔ سالن توسط مراقبِ تخصیص‌یافته (موتور: exam_minutes + مش) */
export async function signExamMinutesAction(px: {
  sessionId: number;
  hallId: number;
  supervisorStaffId: number;
  notes?: string;
  cheatingIncidentsCount?: number;
}) {
  try {
    const user = await requireRole(EDITORS);
    const out = await engine.signHallMinutes(user.id, px);
    revalidatePath('/admin/exams');
    return { ok: true, ...(out as object) };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'خطا در امضای صورت‌جلسه.' };
  }
}

/** تحویل اوراق جمع‌آوری‌شده به استاد درس (موتور: instructor_deliveries + pickupToken) */
export async function deliverToInstructorAction(px: { offeringId: number; instructorId: number; vaultManagerId: number }) {
  try {
    const user = await requireRole(EDITORS);
    const out = await engine.deliverToInstructor(user.id, px);
    revalidatePath('/admin/exams');
    return { ok: true, ...(out as object) };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'خطا در تحویل به استاد.' };
  }
}

// ════════════════════════════════════════════════════════════════════════
// فاز ۹ — برنامه‌ریزی امتحانات (زون‌بندی تقویم + رادار ظرفیت + قفل شیفت +
// امتحان تجمیعی خوشه‌های هم‌ارز + ۴ پیشنهاد هوشمند) و فاز ۱۰ — تخصیص صندلی
// ────────────────────────────────────────────────────────────────────────
// هر اکشن: requireRole مستقیم (گارد CI) + pass-through به موتور exam-planning
// (قفل توافقی/گیت ظرفیت/audit داخل موتور) + { ok,error } فارسی.
// ════════════════════════════════════════════════════════════════════════

import * as planning from '@/lib/exam-planning';

export type ExamPlanningData = {
  zoning: { globalStart: string; globalEnd: string; generalStart: string; generalEnd: string; specializedStart: string; specializedEnd: string } | null;
  radar: { examDate: string; startTime: string; endTime: string; booked: number; available: number; status: 'OK' | 'OVERFLOW'; usagePercent: number; splitOptions: { label: string; shifts: number; seatsPerShift: number }[] }[];
  clusters: { clusterId: number; clusterTitle: string; courseCount: number; demand: number; scheduledSlot: { examDate: string; startTime: string; endTime: string } | null }[];
  halls: { id: number; name: string; totalCapacity: number }[];
  totalCapacity: number;
};
export type ExamPlanningResult = { ok: true; data: ExamPlanningData } | { ok: false; error: string };

/** کارتابل برنامه‌ریزی: زون‌بندی + رادار ظرفیت + خوشه‌های هم‌ارز */
export async function getExamPlanningAction(termId: number, universityId?: number): Promise<ExamPlanningResult> {
  await requireRole(EDITORS);
  try {
    const serverUni = await getCurrentUniversity().catch(() => null);
    const uid = serverUni?.id ?? universityId;
    const [zoning, radar, clusters] = await Promise.all([
      planning.getExamZoningRow(termId),
      planning.examCapacityRadar(termId, uid),
      planning.listEquivClusters(termId, uid),
    ]);
    const hallWhere = uid ? eq(exam_halls.universityId, uid) : undefined;
    const halls = await db.select().from(exam_halls).where(hallWhere).orderBy(asc(exam_halls.id));
    return {
      ok: true,
      data: {
        zoning,
        radar,
        clusters,
        halls: halls.map(h => ({ id: h.id, name: h.name, totalCapacity: Number(h.totalCapacity) })),
        totalCapacity: halls.reduce((s, h) => s + Number(h.totalCapacity), 0),
      },
    };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'خطا در بارگیری کارتابل برنامه‌ریزی امتحانات.' };
  }
}

/** ذخیرهٔ زون‌بندی تقویم امتحانات ترم */
export type SimpleAct = { ok: true; message: string } | { ok: false; error: string };
export async function upsertExamZoningAction(termId: number, zoning: {
  globalStart: string; globalEnd: string;
  generalStart: string; generalEnd: string;
  specializedStart: string; specializedEnd: string;
}, universityId?: number) {
  try {
    const user = await requireRole(EDITORS);
    const serverUni = await getCurrentUniversity().catch(() => null);
    const uid = serverUni?.id ?? universityId;
    const out = await planning.saveExamZoning(user.id, termId, zoning, uid);
    revalidatePath('/admin/exams');
    return out.ok ? { ok: true, message: 'بازه‌های تقویم امتحانات ذخیره شد.' } : { ok: false, error: out.error ?? 'خطا' };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'خطا در ذخیرهٔ تقویم امتحانات.' };
  }
}

/** رزرو شیفت امتحان یک درس (گیت زون‌بندی + قفل ظرفیت + تجزیه در سرریز) */
export type ScheduleExamResult =
  | { ok: true; message: string }
  | { ok: false; error: string; status?: 'OVERFLOW'; splitOptions?: { label: string; shifts: number; seatsPerShift: number }[] };
export async function scheduleExamSlotAction(px: {
  termId: number; offeringId: number; examDate: string; startTime: string; endTime: string; universityId?: number;
}): Promise<ScheduleExamResult> {
  try {
    const user = await requireRole(EDITORS);
    const serverUni = await getCurrentUniversity().catch(() => null);
    const out = await planning.scheduleExamForOffering(user.id, { ...px, universityId: serverUni?.id ?? px.universityId });
    revalidatePath('/admin/exams');
    return out;
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'خطا در رزرو شیفت امتحان.' };
  }
}

/** امتحان تجمیعی خوشهٔ هم‌ارز — یک آزمون واحد برای همهٔ دروس هم‌ارز */
export type UnifiedClusterResult = { ok: true; message: string } | { ok: false; error: string; status?: 'OVERFLOW'; splitOptions?: { label: string; shifts: number; seatsPerShift: number }[] };
export async function scheduleUnifiedClusterAction(px: {
  termId: number; clusterId: number; examDate: string; startTime: string; endTime: string; universityId?: number;
}): Promise<UnifiedClusterResult> {
  try {
    const user = await requireRole(EDITORS);
    const serverUni = await getCurrentUniversity().catch(() => null);
    const out = await planning.scheduleUnifiedCluster(user.id, { ...px, universityId: serverUni?.id ?? px.universityId });
    revalidatePath('/admin/exams');
    return out;
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'خطا در ثبت امتحان تجمیعی.' };
  }
}

/** ۴ پیشنهاد طلایی زمان امتحان (ظرفیت گیت + امتیاز عصرِ ارشد/شاغل) */
export type SuggestSlotsResult = { ok: true; data: { examDate: string; startTime: string; endTime: string; score: number; reasons: string[]; booked: number; available: number }[] } | { ok: false; error: string };
export async function suggestExamSlotsAction(termId: number, offeringId: number, universityId?: number): Promise<SuggestSlotsResult> {
  await requireRole(EDITORS);
  try {
    const serverUni = await getCurrentUniversity().catch(() => null);
    const suggestions = await planning.suggestExamSlots(termId, offeringId, serverUni?.id ?? universityId);
    return { ok: true, data: suggestions };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'خطا در محاسبهٔ پیشنهادهای زمان امتحان.' };
  }
}

/** فاز ۱۰ — تولید/بازتولید تخصیص صندلی همهٔ سشن‌های ترم (سالن + شماره + بلوک) */
export type GenerateSeatsResult = { ok: true; message: string; data: { ok: boolean; sessionCount: number; allocated: number; perSession: { sessionId: number; examDate: string; startTime: string; allocated: number; hallsUsed: number }[] } } | { ok: false; error: string };
export async function generateSeatAllocationsAction(termId: number, universityId?: number): Promise<GenerateSeatsResult> {
  try {
    const user = await requireRole(EDITORS);
    const serverUni = await getCurrentUniversity().catch(() => null);
    const out = await planning.generateSeatAllocations(user.id, termId, serverUni?.id ?? universityId);
    revalidatePath('/admin/exams');
    revalidatePath('/student/exam-card');
    return {
      ok: true,
      message: `${out.allocated} صندلی در ${out.sessionCount} سشن تخصیص یافت.`,
      data: out,
    };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'خطا در تخصیص صندلی.' };
  }
}
