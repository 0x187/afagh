// گزارش‌های «تشکیل کلاس استادان» (r-prof-class)
//
// NOTE: بدون 'use server' تا export const CARDS مجاز بماند؛ فراخوانی فقط از سمت سرور.
//
// ── تعریف «تشکیل کلاس» ──
// یک جلسه **تشکیل‌شده** است اگر برایش ردیفِ `professor_class_attendance` با
// وضعیت VALID ثبت شده باشد — همان چیزی که کارتابل «کنترل حضور و غیاب کلاس‌ها»
// (کنترل‌کننده/کارشناس) یا QR اتاق ثبت می‌کند. یعنی معیار، «ثبتِ حضور استاد»
// است نه صرفِ وجود جلسه در تقویم.
//
// ── منبع جلسات ──
// `class_sessions` (نه `schedules`): فقط این جدول تاریخِ واقعی هر جلسه را دارد.
// `sessionDate` برچسبِ **شمسی** با اسلش است (`1405/10/12`) — قالبِ کل این ستون
// در دادهٔ زنده یکدست است و مقایسه/MAX گرفتنِ رشته‌ای روی آن درست کار می‌کند.
//
// ── انتساب استاد ──
// هر ارائه به `course_offerings."professorId"` نسبت داده می‌شود (تک‌مالک).
// دلیل: در دادهٔ زنده هیچ ارائه‌ای نیست که فقط از طریق `offering_professors`
// استاد داشته باشد، و اگر هر دو منبع را OR کنیم جلساتِ استادانِ مشترک دو بار
// شمرده می‌شوند و درصدِ تشکیل بی‌معنا می‌شود.
//
// NOTE(term): ترم از f.term (کد ترم مثل ۱۴۰۵۱)؛ خالی = آخرین ترم.

import type { ReportFilters, ReportResult } from './report-helpers';
import { paged } from './report-helpers';
import { escapeLikeChars, toEnDigits } from '@/lib/persian-search';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { requireRole } from '@/lib/auth';

const READ_ROLES = ['ADMIN', 'EDU_EXPERT'] as never[];

export const CARDS = [
  { kind: 'prof-formation-summary', title: '📊 تشکیل کلاس استادان (خلاصه)', desc: 'جلسات برنامه‌ریزی‌شده/تشکیل‌شده و درصد تشکیل هر استاد' },
  { kind: 'prof-formation-detail', title: '📚 تشکیل کلاس استادان (به تفکیک درس)', desc: 'همان آمار برای هر (استاد × درس)' },
  { kind: 'prof-formation-none', title: '🚫 استادان بدون هیچ جلسهٔ تشکیل‌شده', desc: 'استادانی که در ترم هیچ حضوری ثبت نکرده‌اند' },
  { kind: 'prof-sessions-unformed', title: '⏳ جلسات تشکیل‌نشده', desc: 'ریزِ جلساتی که حضور استاد برایشان ثبت نشده' },
];

async function resolveTerm(f: ReportFilters): Promise<string> {
  if (f.term) return String(f.term);
  const r = await db.execute<{ code: string }>(
    sql`SELECT "termCode" AS code FROM academic_terms ORDER BY "termCode" DESC LIMIT 1`,
  );
  return r.rows[0]?.code ?? '';
}

/** «جلسه تشکیل شده» — تنها تعریفِ مجاز در این فایل */
const FORMED_EXISTS = sql`EXISTS (SELECT 1 FROM professor_class_attendance a
  WHERE a."sessionId" = cs.id AND a.status = 'VALID')`;

/**
 * شناسهٔ ترم — **زیرکوئریِ غیرهمبسته** (نه JOIN به academic_terms).
 *
 * ⚠ چرا: با `JOIN academic_terms t ON t.id = o."termId"` شرطِ
 * `t."termCode" = $term` به `o` وابسته می‌شود، پس پلنر مجبور است جدول ترم را
 * **به‌ازای هر استاد** یک بار seq-scan کند. در EXPLAIN ANALYZE روی دادهٔ زنده
 * همین یک تغییر، اجرا را از ۲۷ms به ۵٫۵ms رساند (Buffers: 3887 → ~700) چون
 * زیرکوئریِ غیرهمبسته یک InitPlan است و فقط یک بار اجرا می‌شود.
 */
const termIdSql = (term: string) =>
  sql`(SELECT id FROM academic_terms WHERE "termCode" = ${term} LIMIT 1)`;

/** شرط دانشگاه روی ارائه — با قاعدهٔ fail-closedِ بقیهٔ گزارش‌ها */
function uniCond(f: ReportFilters) {
  if (!f.universityId) return null;
  return sql`(o."universityId" = ${f.universityId} OR o."universityId" IS NULL)`;
}

/** جست‌وجوی متنی روی کد/نام استاد و (اختیاری) کد/عنوان درس */
function searchCond(f: ReportFilters, withCourse: boolean) {
  if (!f.q) return null;
  const like = `%${escapeLikeChars(String(f.q))}%`;
  return withCourse
    ? sql`(st."staffCode" ILIKE ${like} ESCAPE '\\' OR u."firstName" ILIKE ${like} ESCAPE '\\' OR u."lastName" ILIKE ${like} ESCAPE '\\' OR c.code ILIKE ${like} ESCAPE '\\' OR c.title ILIKE ${like} ESCAPE '\\')`
    : sql`(st."staffCode" ILIKE ${like} ESCAPE '\\' OR u."firstName" ILIKE ${like} ESCAPE '\\' OR u."lastName" ILIKE ${like} ESCAPE '\\')`;
}

const RATE = sql`(CASE WHEN agg.planned > 0 THEN ROUND(100.0 * agg.formed / agg.planned)::int ELSE NULL END)`;

export async function run(kind: string, f: ReportFilters): Promise<ReportResult | null> {
  await requireRole(READ_ROLES);
  const term = await resolveTerm(f);
  if (!term) return { columns: [], rows: [], total: 0, page: 1, per: 50, totalPages: 1 };

  switch (kind) {
    // ── 📊 خلاصهٔ هر استاد ──
    case 'prof-formation-summary':
    case 'prof-formation-none': {
      const onlyNone = kind === 'prof-formation-none';
      const from = sql`FROM staff st
        JOIN users u ON u.id = st."userId"
        LEFT JOIN departments dep ON dep.id = st."departmentId"
        JOIN LATERAL (
          SELECT COUNT(DISTINCT o.id)::int AS offerings,
                 COUNT(cs.id)::int AS planned,
                 COUNT(cs.id) FILTER (WHERE ${FORMED_EXISTS})::int AS formed,
                 MAX(cs."sessionDate") FILTER (WHERE ${FORMED_EXISTS}) AS last_formed
            FROM course_offerings o
            LEFT JOIN class_sessions cs ON cs."offeringId" = o.id AND cs."isActive" = 1
           WHERE o."professorId" = st.id AND o."termId" = ${termIdSql(term)}
             ${uniCond(f) ? sql`AND ${uniCond(f)}` : sql``}
        ) agg ON agg.planned > 0`;
      const conds: ReturnType<typeof sql>[] = [];
      const sc = searchCond(f, false);
      if (sc) conds.push(sc);
      if (f.departmentId) conds.push(sql`st."departmentId" = ${Number(f.departmentId)}`);
      // «بدون هیچ جلسهٔ تشکیل‌شده» = درصد تشکیل صفر
      if (onlyNone) conds.push(sql`agg.formed = 0`);

      const cols = sql`st."staffCode" AS code,
        u."firstName" || ' ' || u."lastName" AS name,
        dep.name AS department,
        agg.offerings AS offerings, agg.planned AS planned, agg.formed AS formed,
        ${RATE} AS rate, agg.last_formed AS last_formed`;
      const r = await paged(
        [
          { key: 'code', title: 'کد استاد' },
          { key: 'name', title: 'نام استاد' },
          { key: 'department', title: 'گروه' },
          { key: 'offerings', title: 'ارائه‌ها' },
          { key: 'planned', title: 'جلسات برنامه' },
          { key: 'formed', title: 'تشکیل‌شده' },
          { key: 'rate', title: 'درصد تشکیل' },
          { key: 'last_formed', title: 'آخرین تشکیل', format: 'DATE' },
        ],
        from, conds, cols,
        onlyNone ? sql`ORDER BY agg.planned DESC, code` : sql`ORDER BY rate ASC NULLS FIRST, code`,
        f,
      );
      const sumPlanned = r.rows.reduce((s, x) => s + Number(x.planned ?? 0), 0);
      const sumFormed = r.rows.reduce((s, x) => s + Number(x.formed ?? 0), 0);
      const pct = sumPlanned > 0 ? Math.round((100 * sumFormed) / sumPlanned) : 0;
      r.summary = onlyNone
        ? `${r.total.toLocaleString('fa-IR')} استاد در ترم ${term} هیچ جلسهٔ تشکیل‌شده‌ای ندارند`
        : `${r.total.toLocaleString('fa-IR')} استاد در ترم ${term} — در این صفحه ${sumFormed.toLocaleString('fa-IR')} از ${sumPlanned.toLocaleString('fa-IR')} جلسه (${pct.toLocaleString('fa-IR')}٪) تشکیل شده است`;
      return r;
    }

    // ── 📚 به تفکیک (استاد × درس) ──
    case 'prof-formation-detail': {
      const from = sql`FROM course_offerings o
        JOIN courses c ON c.id = o."courseId"
        JOIN staff st ON st.id = o."professorId"
        JOIN users u ON u.id = st."userId"
        JOIN LATERAL (
          SELECT COUNT(*)::int AS planned,
                 COUNT(*) FILTER (WHERE ${FORMED_EXISTS})::int AS formed,
                 MAX(cs."sessionDate") FILTER (WHERE ${FORMED_EXISTS}) AS last_formed
            FROM class_sessions cs
           WHERE cs."offeringId" = o.id AND cs."isActive" = 1
        ) agg ON agg.planned > 0`;
      const conds: ReturnType<typeof sql>[] = [sql`o."termId" = ${termIdSql(term)}`];
      const u = uniCond(f);
      if (u) conds.push(u);
      const sc = searchCond(f, true);
      if (sc) conds.push(sc);
      if (f.departmentId) conds.push(sql`c."departmentId" = ${Number(f.departmentId)}`);

      const cols = sql`st."staffCode" AS code,
        u."firstName" || ' ' || u."lastName" AS name,
        c.code AS course_code, c.title AS course,
        o."groupNumber" AS grp, o."enrolledCount" AS enrolled,
        agg.planned AS planned, agg.formed AS formed, ${RATE} AS rate,
        agg.last_formed AS last_formed`;
      const r = await paged(
        [
          { key: 'code', title: 'کد استاد' },
          { key: 'name', title: 'نام استاد' },
          { key: 'course_code', title: 'کد درس' },
          { key: 'course', title: 'عنوان درس' },
          { key: 'grp', title: 'گروه' },
          { key: 'enrolled', title: 'ثبت‌نامی' },
          { key: 'planned', title: 'جلسات برنامه' },
          { key: 'formed', title: 'تشکیل‌شده' },
          { key: 'rate', title: 'درصد تشکیل' },
          { key: 'last_formed', title: 'آخرین تشکیل', format: 'DATE' },
        ],
        from, conds, cols, sql`ORDER BY rate ASC NULLS FIRST, code, course_code`, f,
      );
      r.summary = `${r.total.toLocaleString('fa-IR')} ارائه در ترم ${term} — مرتب‌شده از کم‌ترین درصد تشکیل`;
      return r;
    }

    // ── ⏳ ریز جلسات تشکیل‌نشده ──
    case 'prof-sessions-unformed': {
      const from = sql`FROM class_sessions cs
        JOIN course_offerings o ON o.id = cs."offeringId"
        JOIN courses c ON c.id = o."courseId"
        LEFT JOIN staff st ON st.id = o."professorId"
        LEFT JOIN users u ON u.id = st."userId"
        LEFT JOIN classrooms r ON r.id = cs."roomId"`;
      const conds: ReturnType<typeof sql>[] = [
        sql`cs."isActive" = 1`,
        sql`o."termId" = ${termIdSql(term)}`,
        sql`NOT ${FORMED_EXISTS}`,
      ];
      const u = uniCond(f);
      if (u) conds.push(u);
      const sc = searchCond(f, true);
      if (sc) conds.push(sc);
      // فیلتر تاریخ (شمسی، اختیاری) — مقایسهٔ رشته‌ای چون ستون varchar با قالب یکدست است.
      // ارقام فارسی و جداکنندهٔ «-» هم پذیرفته می‌شوند و به قالب ستون (`YYYY/MM/DD`) نرمال می‌شوند.
      const jDate = (v: unknown) => {
        const s = toEnDigits(String(v ?? '').trim()).replace(/-/g, '/');
        return /^\d{4}\/\d{1,2}\/\d{1,2}$/.test(s) ? s : '';
      };
      const fromDate = jDate(f.dateFrom);
      const toDate = jDate(f.dateTo);
      if (fromDate) conds.push(sql`cs."sessionDate" >= ${fromDate}`);
      if (toDate) conds.push(sql`cs."sessionDate" <= ${toDate}`);

      const cols = sql`cs."sessionDate" AS session_date,
        cs."startTime" AS start_time, cs."endTime" AS end_time,
        COALESCE(u."firstName" || ' ' || u."lastName", 'تخصیص‌نیافته') AS name,
        st."staffCode" AS code,
        c.code AS course_code, c.title AS course,
        o."groupNumber" AS grp,
        COALESCE(r.name, '—') AS room`;
      const r = await paged(
        [
          { key: 'session_date', title: 'تاریخ جلسه', format: 'DATE' },
          { key: 'start_time', title: 'شروع' },
          { key: 'end_time', title: 'پایان' },
          { key: 'code', title: 'کد استاد' },
          { key: 'name', title: 'نام استاد' },
          { key: 'course_code', title: 'کد درس' },
          { key: 'course', title: 'عنوان درس' },
          { key: 'grp', title: 'گروه' },
          { key: 'room', title: 'کلاس' },
        ],
        from, conds, cols, sql`ORDER BY cs."sessionDate" DESC, cs."startTime"`, f,
      );
      r.summary = `${r.total.toLocaleString('fa-IR')} جلسهٔ تشکیل‌نشده در ترم ${term}`;
      return r;
    }

    default:
      return null;
  }
}
