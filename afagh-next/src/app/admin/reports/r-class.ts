// گزارش‌های کلاس/فضا/ظرفیت (r-class)
// NOTE: بدون 'use server' تا export const CARDS مجاز بماند؛ فراخوانی فقط از سمت سرور.
// NOTE(term): ترم از f.term (کد ترم، مثل ۱۴۰۳۱) خوانده می‌شود؛ خالی = آخرین ترم.
// NOTE(weekly-source): ساعت هفتگی کلاس در جدول schedules است
// (roomId, dayOfWeek, startTime, endTime) نه class_sessions؛
// class_sessions ستون roomId/dayOfWeek ندارد (فقط offeringId/sessionDate/startTime/endTime
// به‌صورت varchar) پس هر سه گزارشِ room-based از schedules تغذیه می‌شوند.
// NOTE(low-enrollment): آستانه از f.q خوانده می‌شود (کسر ۰–۱ یا درصد ۱–۱۰۰)؛ پیش‌فرض 0.5.

import type { ReportFilters, ReportResult } from './report-helpers';
import { paged, studentWhere, joinAnd } from './report-helpers';
import { escapeLikeChars } from '@/lib/persian-search';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { requireRole } from '@/lib/auth';
import { revalidatePath } from 'next/cache';

const READ_ROLES = ['ADMIN', 'EDU_EXPERT'];

export const CARDS: { kind: string; title: string; desc: string }[] = [
  { kind: 'empty-rooms', title: '🏚 کلاس‌های خالی', desc: 'کلاس‌های بدون برنامه در ترم' },
  { kind: 'weekly-timetable', title: '🗓 برنامه هفتگی کلاس‌ها', desc: 'سانس هر کلاس به تفکیک روز' },
  { kind: 'room-conflicts', title: '⚠️ تداخل هفتگی کلاس‌ها', desc: 'هم‌پوشانی زمانی در یک کلاس' },
  { kind: 'low-enrollment', title: '📉 ظرفیت به حدنصاب نرسیده', desc: 'ثبت‌نام کمتر از آستانه (q، پیش‌فرض ۰٫۵)' },
  { kind: 'makeup-courses', title: '🩹 جبرانی/پیش‌دانشگاهی', desc: 'ارائه‌های معادل‌سازی/جبرانی (الگوی مستندشده)' },
];

async function resolveTermCode(f: ReportFilters): Promise<string> {
  if (f.term) return f.term;
  const r = await db.execute<{ code: string }>(
    sql`SELECT "termCode" AS code FROM academic_terms ORDER BY "termCode" DESC LIMIT 1`,
  );
  return r.rows[0]?.code ?? '';
}

export async function run(kind: string, f: ReportFilters): Promise<ReportResult | null> {
  await requireRole(READ_ROLES);
  const term = await resolveTermCode(f);
  const uni = f.universityId;

  switch (kind) {
    // ── 🏚 کلاس‌های خالی: بدون هیچ ردیف schedules برای ارائه‌های فعال ترم ──
    case 'empty-rooms': {
      const like = f.q ? `%${escapeLikeChars(String(f.q))}%` : null;
      const conds = [
        ...(uni ? [sql`(r."universityId" = ${uni} OR r."universityId" IS NULL)`] : []),
        // جست‌وجو روی نام اتاق، کد اتاق و نام دانشکده (منبع: faculties) —
        // ستون قدیمیِ buildingName هم‌نویسیِ همان نام است، پس نتیجه یکی است.
        ...(like ? [sql`(r.name ILIKE ${like} ESCAPE '\\' OR r.code ILIKE ${like} ESCAPE '\\' OR f.name ILIKE ${like} ESCAPE '\\')`] : []),
        sql`NOT EXISTS (SELECT 1 FROM schedules sch
          JOIN course_offerings o ON o.id = sch."offeringId"
          JOIN academic_terms t ON t.id = o."termId"
          WHERE sch."roomId" = r.id AND t."termCode" = ${term} AND o."isActive" = 1)`,
      ];
      const r = await paged(
        [
          { key: 'id', title: 'شناسه' }, { key: 'room', title: 'کلاس' },
          { key: 'faculty', title: 'دانشکده' }, { key: 'capacity', title: 'ظرفیت' },
          { key: 'type', title: 'نوع' },
        ],
        sql`FROM classrooms r LEFT JOIN faculties f ON f.id = r."facultyId"`,
        conds,
        // COALESCE: اگر دانشکده تعیین نشده باشد، همان هم‌نویسیِ قدیمی نمایش داده می‌شود.
        sql`r.id AS id, r.name AS room, COALESCE(f.name, r."buildingName") AS faculty,
          r.capacity AS capacity, r."roomType" AS type`,
        sql`ORDER BY faculty NULLS LAST, r.name`,
        f,
      );
      r.summary = `${r.total.toLocaleString('fa-IR')} کلاس بدون برنامه در ترم ${term} (مبنا: schedules؛ class_sessions اتصال به کلاس ندارد)`;
      return r;
    }

    // ── 🗓 برنامه هفتگی کلاس‌ها: هر سانس (کلاس/روز/ساعت) یک ردیف ──
    case 'weekly-timetable': {
      const like = f.q ? `%${escapeLikeChars(String(f.q))}%` : null;
      const conds = [
        sql`t."termCode" = ${term}`,
        ...(uni ? [sql`(sch."universityId" = ${uni} OR sch."universityId" IS NULL)`] : []),
        ...(like ? [sql`(r.name ILIKE ${like} ESCAPE '\\' OR c.title ILIKE ${like} ESCAPE '\\' OR c.code ILIKE ${like} ESCAPE '\\')`] : []),
      ];
      const r = await paged(
        [
          { key: 'room', title: 'کلاس' }, { key: 'day', title: 'روز هفته (عدد)' },
          { key: 'start', title: 'از ساعت' }, { key: 'end', title: 'تا ساعت' },
          { key: 'type', title: 'نوع سانس' }, { key: 'course_code', title: 'کد درس' },
          { key: 'course_title', title: 'نام درس' }, { key: 'grp', title: 'گروه' },
        ],
        sql`FROM schedules sch
          JOIN course_offerings o ON o.id = sch."offeringId"
          JOIN academic_terms t ON t.id = o."termId"
          JOIN courses c ON c.id = o."courseId"
          LEFT JOIN classrooms r ON r.id = sch."roomId"`,
        conds,
        sql`r.name AS room, sch."dayOfWeek" AS day, sch."startTime" AS start, sch."endTime" AS "end",
          sch."scheduleType" AS type, c.code AS course_code, c.title AS course_title, o."groupNumber" AS grp`,
        sql`ORDER BY room NULLS LAST, day NULLS LAST, start`,
        f,
      );
      r.summary = `${r.total.toLocaleString('fa-IR')} سانس در ترم ${term} — نگاشت عدد روز به شنبه..جمعه تابع قرارداد زمان‌بندی است`;
      return r;
    }

    // ── ⚠️ تداخل هفتگی: دو سانس هم‌کلاس، هم‌روز، با اشتراک بازه زمانی ──
    case 'room-conflicts': {
      const conds = [
        sql`ta."termCode" = ${term}`,
        sql`ta.id = tb.id`,
        ...(uni ? [sql`(a."universityId" = ${uni} OR a."universityId" IS NULL)`] : []),
      ];
      const r = await paged(
        [
          { key: 'room', title: 'کلاس' }, { key: 'day', title: 'روز هفته (عدد)' },
          { key: 'a_start', title: 'شروع اول' }, { key: 'a_end', title: 'پایان اول' },
          { key: 'b_start', title: 'شروع دوم' }, { key: 'b_end', title: 'پایان دوم' },
          { key: 'offering_a', title: 'ارائه اول' }, { key: 'offering_b', title: 'ارائه دوم' },
        ],
        sql`FROM schedules a
          JOIN schedules b ON b."roomId" = a."roomId"
            AND b."dayOfWeek" = a."dayOfWeek"
            AND b.id > a.id
            AND b."startTime" < a."endTime"
            AND b."endTime" > a."startTime"
          JOIN course_offerings oa ON oa.id = a."offeringId"
          JOIN course_offerings ob ON ob.id = b."offeringId"
          JOIN academic_terms ta ON ta.id = oa."termId"
          JOIN academic_terms tb ON tb.id = ob."termId"
          LEFT JOIN classrooms r ON r.id = a."roomId"`,
        conds,
        sql`r.name AS room, a."dayOfWeek" AS day,
          a."startTime" AS a_start, a."endTime" AS a_end,
          b."startTime" AS b_start, b."endTime" AS b_end,
          oa.id AS offering_a, ob.id AS offering_b`,
        sql`ORDER BY room, day, a_start`,
        f,
      );
      r.summary = `${r.total.toLocaleString('fa-IR')} جفت متداخل در ترم ${term} (سانس‌های امتحانیِ بدون dayOfWeek کنار گذاشته می‌شوند)`;
      return r;
    }

    // ── 📉 ظرفیت به حدنصاب نرسیده: enrolledCount < capacity * threshold ──
    case 'low-enrollment': {
      // آستانه از f.q: کسر ۰–۱ یا درصد ۱–۱۰۰؛ پیش‌فرض 0.5
      const raw = parseFloat(String(f.q ?? ''));
      const threshold = Number.isFinite(raw) && raw > 0 && raw <= 100 ? (raw > 1 ? raw / 100 : raw) : 0.5;
      const r = await paged(
        [
          { key: 'code', title: 'کد درس' }, { key: 'title', title: 'نام درس' },
          { key: 'grp', title: 'گروه' }, { key: 'capacity', title: 'ظرفیت' },
          { key: 'enrolled', title: 'ثبت‌نام‌شده' }, { key: 'pct', title: 'درصد پرشدن' },
          { key: 'term', title: 'ترم' },
        ],
        sql`FROM course_offerings o
          JOIN courses c ON c.id = o."courseId"
          JOIN academic_terms t ON t.id = o."termId"`,
        [
          sql`t."termCode" = ${term}`,
          sql`o."isActive" = 1`,
          sql`o.capacity > 0`,
          sql`o."enrolledCount" < o.capacity * ${threshold}`,
          ...(uni ? [sql`(o."universityId" = ${uni} OR o."universityId" IS NULL)`] : []),
        ],
        sql`c.code AS code, c.title AS title, o."groupNumber" AS grp,
          o.capacity AS capacity, o."enrolledCount" AS enrolled,
          ROUND(o."enrolledCount" * 100.0 / o.capacity, 1) AS pct, t."termCode" AS term`,
        sql`ORDER BY pct ASC NULLS FIRST`,
        f,
      );
      r.summary = `${r.total.toLocaleString('fa-IR')} ارائه زیر حدنصاب ${(threshold * 100).toLocaleString('fa-IR')}٪ در ترم ${term} (آستانه از q؛ مبنا: ستون enrolledCount)`;
      return r;
    }

    // ── 🩹 جبرانی/پیش‌دانشگاهی: الگوی مستند (کد متعارف جدا ثبت نشده) ──
    case 'makeup-courses': {
      const makeupCond = sql`(t."termType" = 'EQUIVALENCE'
        OR o."offeringType" ILIKE '%EQUIV%'
        OR c."courseType" ILIKE ANY (ARRAY['%جبران%', '%COMPENS%', '%EQUIV%', '%پیش%'])
        OR c.title ILIKE '%جبرانی%' OR c.title ILIKE '%پیش‌دانشگاهی%'
        OR c.title ILIKE '%پیش دانشگاهی%' OR c.title ILIKE '%پیشدانشگاهی%')`;
      const r = await paged(
        [
          { key: 'code', title: 'کد درس' }, { key: 'title', title: 'نام درس' },
          { key: 'course_type', title: 'نوع درس' }, { key: 'offering_type', title: 'نوع ارائه' },
          { key: 'term', title: 'ترم' }, { key: 'term_type', title: 'نوع ترم' },
          { key: 'grp', title: 'گروه' }, { key: 'enrolled', title: 'ثبت‌نام‌شده' },
        ],
        sql`FROM course_offerings o
          JOIN courses c ON c.id = o."courseId"
          JOIN academic_terms t ON t.id = o."termId"`,
        [
          ...(f.term ? [sql`t."termCode" = ${term}`] : []),
          makeupCond,
          ...(uni ? [sql`(o."universityId" = ${uni} OR o."universityId" IS NULL)`] : []),
        ],
        sql`c.code AS code, c.title AS title, c."courseType" AS course_type,
          o."offeringType" AS offering_type, t."termCode" AS term, t."termType" AS term_type,
          o."groupNumber" AS grp, o."enrolledCount" AS enrolled`,
        sql`ORDER BY term DESC, code`,
        f,
      );
      r.summary = `${r.total.toLocaleString('fa-IR')} ارائه جبرانی/معادل‌سازی — الگو: termType=EQUIVALENCE یا offeringType/courseType/title حاوی EQUIV/COMPENS/جبران/پیش؛ کد متعارف جدا در اسکیما نیست، بازبینی دستی شود`;
      return r;
    }

    default:
      return null;
  }
}

export type ClassMutationResult = { ok: boolean; error?: string; updated?: number };

// ادغام گروه درس: انتقال ثبت‌نام‌های A به B (رد شدن تکراری‌ها) + غیرفعال‌سازی A
export async function mergeGroups(fromOfferingId: number, toOfferingId: number): Promise<ClassMutationResult> {
  await requireRole(['ADMIN']);
  if (!Number.isInteger(fromOfferingId) || !Number.isInteger(toOfferingId) || fromOfferingId === toOfferingId)
    return { ok: false, error: 'شناسهٔ گروه مبدأ و مقصد معتبر نیست' };
  const offs = await db.execute<{ id: number; termId: number; courseId: number; isActive: number }>(
    sql`SELECT id, "termId", "courseId", "isActive" FROM course_offerings WHERE id IN (${fromOfferingId}, ${toOfferingId})`,
  );
  const from = offs.rows.find(r => Number(r.id) === fromOfferingId);
  const to = offs.rows.find(r => Number(r.id) === toOfferingId);
  if (!from || !to) return { ok: false, error: 'گروه مبدأ یا مقصد یافت نشد' };
  if (Number(from.termId) !== Number(to.termId) || Number(from.courseId) !== Number(to.courseId))
    return { ok: false, error: 'ادغام فقط برای دو گروه هم‌درس و هم‌ترم مجاز است' };
  const moved = await db.execute<{ id: number }>(
    sql`UPDATE enrollments AS e SET "offeringId" = ${toOfferingId}
      WHERE e."offeringId" = ${fromOfferingId}
      AND NOT EXISTS (SELECT 1 FROM enrollments d WHERE d."studentId" = e."studentId" AND d."offeringId" = ${toOfferingId})
      RETURNING e.id`,
  );
  // باقی‌مانده‌های A (دانشجویانی که هم‌زمان در B بودند) حذف می‌شوند تا رکورد یتیم نماند
  await db.execute(sql`DELETE FROM enrollments WHERE "offeringId" = ${fromOfferingId}`);
  await db.execute(sql`UPDATE course_offerings SET "isActive" = 0 WHERE id = ${fromOfferingId}`);
  await db.execute(
    sql`UPDATE course_offerings AS o SET "enrolledCount" =
      (SELECT COUNT(*) FROM enrollments e WHERE e."offeringId" = o.id AND e.status <> 'DROPPED')
      WHERE o.id IN (${fromOfferingId}, ${toOfferingId})`,
  );
  revalidatePath('/admin/reports');
  return { ok: true, updated: moved.rows.length };
}

// انتخاب واحد جمعی: ثبت‌نام studentIds در offeringId با رد تکراری‌ها و نامعتبرها
export async function bulkEnroll(offeringId: number, studentIds: number[]): Promise<ClassMutationResult> {
  await requireRole(['ADMIN']);
  const ids = [...new Set((studentIds ?? []).map(Number).filter(n => Number.isInteger(n) && n > 0))].slice(0, 500);
  if (!Number.isInteger(offeringId) || ids.length === 0)
    return { ok: false, error: 'شناسهٔ ارائه یا فهرست دانشجویان معتبر نیست' };
  const off = await db.execute<{ id: number; isActive: number }>(
    sql`SELECT id, "isActive" FROM course_offerings WHERE id = ${offeringId}`,
  );
  if (!off.rows[0]) return { ok: false, error: 'ارائه یافت نشد' };
  if (Number(off.rows[0].isActive) !== 1) return { ok: false, error: 'ارائه غیرفعال است' };
  const vals = sql.join(ids.map(id => sql`(${id})`), sql`, `);
  const ins = await db.execute<{ id: number }>(
    sql`INSERT INTO enrollments ("studentId", "offeringId", status, "gradeStatus")
      SELECT v.id, ${offeringId}, 'REGISTERED', 'PENDING' FROM (VALUES ${vals}) AS v(id)
      WHERE NOT EXISTS (SELECT 1 FROM enrollments e WHERE e."studentId" = v.id AND e."offeringId" = ${offeringId})
      AND EXISTS (SELECT 1 FROM students s WHERE s.id = v.id)
      ON CONFLICT ("studentId", "offeringId") DO NOTHING
      RETURNING id`,
  );
  await db.execute(
    sql`UPDATE course_offerings AS o SET "enrolledCount" =
      (SELECT COUNT(*) FROM enrollments e WHERE e."offeringId" = o.id AND e.status <> 'DROPPED')
      WHERE o.id = ${offeringId}`,
  );
  revalidatePath('/admin/reports');
  return { ok: true, updated: ins.rows.length };
}

// حذف واحد جمعی: حذف enrollments بر اساس شناسه‌ها
export async function bulkDrop(enrollmentIds: number[]): Promise<ClassMutationResult> {
  await requireRole(['ADMIN']);
  const ids = [...new Set((enrollmentIds ?? []).map(Number).filter(n => Number.isInteger(n) && n > 0))].slice(0, 500);
  if (ids.length === 0) return { ok: false, error: 'فهرست شناسه‌های ثبت‌نام خالی است' };
  const list = sql.join(ids.map(id => sql`${id}`), sql`, `);
  const aff = await db.execute<{ offeringId: number }>(
    sql`SELECT DISTINCT "offeringId" FROM enrollments WHERE id IN (${list})`,
  );
  const del = await db.execute<{ id: number }>(
    sql`DELETE FROM enrollments WHERE id IN (${list}) RETURNING id`,
  );
  if (aff.rows.length > 0) {
    const olist = sql.join(aff.rows.map(r => sql`${Number(r.offeringId)}`), sql`, `);
    await db.execute(
      sql`UPDATE course_offerings AS o SET "enrolledCount" =
        (SELECT COUNT(*) FROM enrollments e WHERE e."offeringId" = o.id AND e.status <> 'DROPPED')
        WHERE o.id IN (${olist})`,
    );
  }
  revalidatePath('/admin/reports');
  return { ok: true, updated: del.rows.length };
}

// ارجاع نگه‌داشته‌شده برای قرارداد import مشترک (در این ماژول دانشجویی کاربرد ندارد)
void studentWhere;
void joinAnd;
