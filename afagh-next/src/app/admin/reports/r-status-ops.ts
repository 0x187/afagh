// ── گزارش‌های عملیات وضعیت دانشجو (r-status-ops) ────────────────────────────
// خواندن‌ها: requireRole(['ADMIN','EDU_EXPERT']) — جهش‌ها: فقط ADMIN.
// قرارداد: CARDS + run(kind, f) برای خواندن‌ها؛ جهش‌ها توابع جداگانه‌اند.
//
// وضعیت اسکیما (بررسی‌شده در src/db/schema.ts):
// - جدول تاریخچهٔ «تغییر رشته» وجود ندارد (فقط students.samaStatusCode و
//   students.studyingMode به‌صورت وضعیت فعلی) → NEEDS-SCHEMA.
// - جدول تاریخچهٔ «تغییر وضعیت» به‌صورت صریح وجود ندارد؛ نزدیک‌ترین دادهٔ
//   واقعی student_term_states است (وضعیت هر دانشجو در هر نیمسال) + audit_logs
//   عمومی → گزارش از student_term_states ساخته می‌شود.
// - جدول outbox/export پرتال وجود ندارد؛ نزدیک‌ترین موجودها alumni_profiles
//   (پورتال دانش‌آموختگان) و samin_staging (ثمین، نه پرتال) هستند → ارسال به
//   پرتال = ساخت ردیف alumni_profiles برای فارغ‌التحصیلان بدون پروفایل.

import type { ReportFilters, ReportResult } from './report-helpers';
import { paged, studentWhere, joinAnd, studentListReport } from './report-helpers';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { requireRole } from '@/lib/auth';
import { STUDENT_STATUS_FA } from '@/lib/student-labels';
import { calculateOfficialGpaBreakdown } from '@/lib/regulations-engine';
import { graduationDateFor } from '@/lib/compliance-integrations';

export type StatusOpsCard = {
  kind: string;
  icon: string;
  title: string;
  needsTerm?: boolean;
  filters?: string[];
};

export const CARDS: StatusOpsCard[] = [
  { kind: 'status-report', icon: '🧑‍🎓', title: 'وضعیت دانشجویان', filters: ['degree', 'faculty', 'department', 'major', 'entryYear', 'q', 'nationalCode'] },
  { kind: 'major-change-report', icon: '🔀', title: 'تغییر رشته', filters: ['degree', 'faculty', 'major', 'entryYear', 'q'] },
  { kind: 'status-change-report', icon: '📜', title: 'تغییر وضعیت', filters: ['degree', 'faculty', 'major', 'entryYear', 'q'] },
  { kind: 'gpa-refresh-preview', icon: '🔄', title: 'بروزروزرسانی معدل نیمسال (پیش‌نمایش)', needsTerm: true, filters: ['degree', 'major', 'entryYear'] },
  { kind: 'profile-refresh', icon: '🧮', title: 'بازمحاسبه جمع واحد/معدل (پیش‌نمایش)', filters: ['degree', 'major', 'entryYear', 'q'] },
  { kind: 'portal-export', icon: '📤', title: 'ارسال به پرتال دانش‌آموختگان', filters: ['degree', 'major', 'entryYear'] },
];

export type MutationResult = { ok: boolean; error?: string; updated?: number };

type Filters = ReportFilters & Record<string, unknown>;

const READ_ROLES = ['ADMIN', 'EDU_EXPERT'];
const ADMIN_ROLE = ['ADMIN'];

// نمرهٔ عددی (کپی الگوی actions.ts)
const NUMERIC_GRADE = sql`e."gradeValue"::text ~ '^[0-9]+(\\.[0-9]+)?$'`;

function faStatus(s: unknown): string {
  const k = String(s ?? '');
  return STUDENT_STATUS_FA[k] ?? k;
}

function asIds(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  const out: number[] = [];
  for (const x of v) {
    const n = Number(x);
    if (Number.isInteger(n) && n > 0) out.push(n);
  }
  return [...new Set(out)];
}

/** DDL پیشنهادی برای تاریخچهٔ کامل تغییر رشته (جدول موجود نیست — NEEDS-SCHEMA) */
export const MAJOR_CHANGE_DDL = `CREATE TABLE IF NOT EXISTS student_major_changes (
  id SERIAL PRIMARY KEY,
  "studentId" INTEGER NOT NULL REFERENCES students(id),
  "fromMajorId" INTEGER REFERENCES majors(id),
  "toMajorId" INTEGER NOT NULL REFERENCES majors(id),
  "termId" INTEGER REFERENCES academic_terms(id),
  reason TEXT,
  "approvedBy" INTEGER REFERENCES users(id),
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "universityId" INTEGER REFERENCES universities(id)
);
CREATE INDEX IF NOT EXISTS idx_student_major_changes_student ON student_major_changes("studentId");`;

/** DDL پیشنهادی برای ثبت صریح تغییر وضعیت (اختیاری — فعلاً از student_term_states خوانده می‌شود) */
export const STATUS_CHANGE_DDL = `CREATE TABLE IF NOT EXISTS student_status_changes (
  id SERIAL PRIMARY KEY,
  "studentId" INTEGER NOT NULL REFERENCES students(id),
  "fromStatus" VARCHAR(30),
  "toStatus" VARCHAR(30) NOT NULL,
  "termId" INTEGER REFERENCES academic_terms(id),
  reason TEXT,
  "actorUserId" INTEGER REFERENCES users(id),
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "universityId" INTEGER REFERENCES universities(id)
);
CREATE INDEX IF NOT EXISTS idx_student_status_changes_student ON student_status_changes("studentId");`;

/** گزارش‌هایی که جدول اختصاصی ندارند و DDL می‌خواهند */
export const NEEDS_SCHEMA: Record<string, string> = {
  'major-change-report': MAJOR_CHANGE_DDL,
};

const STU_JOIN = sql`FROM students s JOIN users u ON u.id = s."userId" LEFT JOIN majors m ON m.id = s."majorId" LEFT JOIN degree_level_configs d ON d.id = s."degreeLevelId"`;

export async function run(kind: string, f: Filters): Promise<ReportResult | null> {
  await requireRole(READ_ROLES);

  switch (kind) {
    // ── وضعیت دانشجویان: شمارش + فهرست با همهٔ فیلترهای استاندارد ──
    case 'status-report': {
      const stFilter = typeof f.status === 'string' && f.status ? f.status : '';
      const conds = [...studentWhere(f)];
      if (stFilter) conds.push(sql`s.status = ${stFilter}`);
      const where = joinAnd(conds);
      const agg = await db.execute<{ st: string; n: string }>(
        sql`SELECT s.status AS st, COUNT(*)::int AS n ${STU_JOIN} ${where} GROUP BY s.status ORDER BY n DESC`,
      );
      const total = agg.rows.reduce((a, r) => a + Number(r.n), 0);
      const summary =
        `جمع: ${total.toLocaleString('fa-IR')} نفر — ` +
        agg.rows.map(r => `${faStatus(r.st)}: ${Number(r.n).toLocaleString('fa-IR')}`).join(' | ');
      const list = await studentListReport(
        [
          { key: 'code', title: 'شماره دانشجویی' }, { key: 'name', title: 'نام' },
          { key: 'nc', title: 'کد ملی' }, { key: 'major', title: 'رشته' },
          { key: 'degree', title: 'مقطع' }, { key: 'y', title: 'ورودی' }, { key: 'st', title: 'وضعیت' },
        ],
        stFilter ? [sql`s.status = ${stFilter}`] : [],
        f,
      );
      list.summary = summary;
      return list;
    }

    // ── تغییر رشته: جدول تاریخچه وجود ندارد → NEEDS-SCHEMA؛ فقط تصویر لحظه‌ای
    //    واقعی از وضعیت فعلی سما (samaStatusCode=4/14 یا studyingMode=2/8) ──
    case 'major-change-report': {
      const conds = [
        ...studentWhere(f),
        sql`(s."samaStatusCode" IN ('4', '14') OR s."studyingMode" IN ('2', '8'))`,
      ];
      const cols = sql`s."studentCode" AS code, u."firstName" || ' ' || u."lastName" AS name, u."nationalCode" AS nc, m.name AS major, d.title AS degree, s."entryYear" AS y, s.status AS st, s."samaStatusCode" AS sama, s."studyingMode" AS mode`;
      const r = await paged(
        [
          { key: 'code', title: 'شماره دانشجویی' }, { key: 'name', title: 'نام' },
          { key: 'nc', title: 'کد ملی' }, { key: 'major', title: 'رشتهٔ فعلی' },
          { key: 'degree', title: 'مقطع' }, { key: 'y', title: 'ورودی' },
          { key: 'st', title: 'وضعیت' }, { key: 'sama', title: 'کد سما' }, { key: 'mode', title: 'شیوه آموزش' },
        ],
        STU_JOIN, conds, cols, sql`ORDER BY s."studentCode"`, f,
      );
      r.rows = r.rows.map(x => ({ ...x, st: faStatus(x.st) }));
      r.summary =
        `NEEDS-SCHEMA — جدول تاریخچهٔ تغییر رشته وجود ندارد. ` +
        `این فهرست فقط تصویر لحظه‌ای واقعی است (${r.total.toLocaleString('fa-IR')} نفر با نشانهٔ تغییر رشته در وضعیت فعلی سما). ` +
        `برای تاریخچهٔ کامل، DDL پیشنهادی (MAJOR_CHANGE_DDL) را اعمال کنید.`;
      return r;
    }

    // ── تغییر وضعیت: گذار بین نیمسال‌های متوالی از student_term_states ──
    case 'status-change-report': {
      const baseFrom = sql`FROM (
        SELECT sts."studentId" AS sid, t."termCode" AS tc,
          COALESCE(sts."normalizedStatusTitle", sts."statusTitle", sts."sourceStatusTitle") AS stt,
          LAG(COALESCE(sts."normalizedStatusTitle", sts."statusTitle", sts."sourceStatusTitle")) OVER w AS prev_stt,
          LAG(t."termCode") OVER w AS prev_tc
        FROM student_term_states sts JOIN academic_terms t ON t.id = sts."termId"
        WINDOW w AS (PARTITION BY sts."studentId" ORDER BY t."sortOrder" NULLS LAST, t."termCode")
      ) ch
      JOIN students s ON s.id = ch.sid
      JOIN users u ON u.id = s."userId"
      LEFT JOIN majors m ON m.id = s."majorId"`;
      const conds = [sql`ch.stt IS DISTINCT FROM ch.prev_stt`, ...studentWhere(f)];
      const cols = sql`s."studentCode" AS code, u."firstName" || ' ' || u."lastName" AS name, m.name AS major, ch.prev_tc AS from_term, ch.prev_stt AS from_st, ch.tc AS to_term, ch.stt AS to_st`;
      const r = await paged(
        [
          { key: 'code', title: 'شماره دانشجویی' }, { key: 'name', title: 'نام' },
          { key: 'major', title: 'رشته' }, { key: 'from_term', title: 'از ترم' },
          { key: 'from_st', title: 'وضعیت قبل' }, { key: 'to_term', title: 'تا ترم' },
          { key: 'to_st', title: 'وضعیت بعد' },
        ],
        baseFrom, conds, cols, sql`ORDER BY to_term DESC, code`, f,
      );
      r.summary = `${r.total.toLocaleString('fa-IR')} گذار وضعیت بین نیمسال‌ها (از student_term_states؛ تغییرات درون‌ترمی ثبت نمی‌شود)`;
      return r;
    }

    // ── بروزروزرسانی معدل نیمسال: مقایسهٔ termAvg ذخیره‌شده با بازمحاسبه — فقط خواندن ──
    case 'gpa-refresh-preview': {
      const term = typeof f.term === 'string' ? f.term : '';
      const onlyStale = f.onlyStale !== false;
      const stored = sql`COALESCE(sts."normalizedTermAvg", sts."termAvg", sts."sourceTermAvg")`;
      const baseFrom = sql`FROM student_term_states sts
        JOIN academic_terms t ON t.id = sts."termId"
        JOIN students s ON s.id = sts."studentId"
        JOIN users u ON u.id = s."userId"
        LEFT JOIN majors m ON m.id = s."majorId"
        JOIN LATERAL (
          SELECT
            -- 🔒 معدل وزنی بر واحد (نه میانگین سادهٔ نمره‌ها) و فقط دروس مؤثر در معدل
            ROUND(
              SUM(e."gradeValue"::numeric * COALESCE(c.units, 0))
                FILTER (WHERE e."gradeStatus" = 'FINALIZED' AND ${NUMERIC_GRADE} AND COALESCE(c."affectsGpa", 1) = 1)
              / NULLIF(SUM(COALESCE(c.units, 0))
                FILTER (WHERE e."gradeStatus" = 'FINALIZED' AND ${NUMERIC_GRADE} AND COALESCE(c."affectsGpa", 1) = 1), 0)
            , 2) AS reavg,
            COUNT(*) FILTER (WHERE e."gradeStatus" = 'FINALIZED' AND ${NUMERIC_GRADE})::int AS n
          FROM enrollments e JOIN course_offerings o ON o.id = e."offeringId"
            LEFT JOIN courses c ON c.id = o."courseId"
          WHERE e."studentId" = s.id AND o."termId" = sts."termId"
        ) g ON true`;
      const conds = [...studentWhere(f)];
      if (term) conds.push(sql`t."termCode" = ${term}`);
      if (onlyStale) conds.push(sql`${stored} IS DISTINCT FROM g.reavg`);
      const cols = sql`s."studentCode" AS code, u."firstName" || ' ' || u."lastName" AS name, m.name AS major, t."termCode" AS term, ${stored} AS stored_avg, g.reavg AS recomputed_avg, g.n AS final_count, ROUND((g.reavg - ${stored})::numeric, 2) AS diff`;
      const r = await paged(
        [
          { key: 'code', title: 'شماره دانشجویی' }, { key: 'name', title: 'نام' },
          { key: 'major', title: 'رشته' }, { key: 'term', title: 'ترم' },
          { key: 'stored_avg', title: 'معدل ذخیره‌شده' }, { key: 'recomputed_avg', title: 'معدل بازمحاسبه‌شده' },
          { key: 'final_count', title: 'درس نهایی' }, { key: 'diff', title: 'اختلاف' },
        ],
        baseFrom, conds, cols, sql`ORDER BY term DESC, code`, f,
      );
      r.summary = onlyStale
        ? `${r.total.toLocaleString('fa-IR')} نیمسال با معدل ناهمگام (فقط پیش‌نمایش — هیچ رکوردی تغییر نکرد)`
        : `${r.total.toLocaleString('fa-IR')} نیمسال (فقط پیش‌نمایش — هیچ رکوردی تغییر نکرد)`;
      return r;
    }

    // ── بازمحاسبه جمع واحد/معدل: پیش‌نمایش فقط‌خواندنی ──
    case 'profile-refresh': {
      const ids = asIds(f.ids);
      const onlyStale = f.onlyStale !== false;
      const baseFrom = sql`FROM students s
        JOIN users u ON u.id = s."userId"
        LEFT JOIN majors m ON m.id = s."majorId"
        JOIN LATERAL (
          SELECT COALESCE(SUM(c.units) FILTER (WHERE e.status <> 'DROPPED'), 0)::int AS taken_u,
            COALESCE(SUM(c.units) FILTER (WHERE e."gradeStatus" = 'FINALIZED' AND ${NUMERIC_GRADE} AND e."gradeValue"::numeric >= 10), 0)::int AS passed_u,
            -- 🔒 معدل وزنی بر واحد (پیش‌تر میانگین ساده بود ⇒ اختلاف‌های کاذب با موتور رسمی)
            ROUND(
              SUM(e."gradeValue"::numeric * COALESCE(c.units, 0))
                FILTER (WHERE e."gradeStatus" = 'FINALIZED' AND ${NUMERIC_GRADE} AND COALESCE(c."affectsGpa", 1) = 1)
              / NULLIF(SUM(COALESCE(c.units, 0))
                FILTER (WHERE e."gradeStatus" = 'FINALIZED' AND ${NUMERIC_GRADE} AND COALESCE(c."affectsGpa", 1) = 1), 0)
            , 2) AS reavg
          FROM enrollments e
            LEFT JOIN course_offerings o ON o.id = e."offeringId"
            LEFT JOIN courses c ON c.id = o."courseId"
          WHERE e."studentId" = s.id
        ) g ON true`;
      const conds = [...studentWhere(f)];
      if (ids.length) conds.push(sql`s.id IN (${sql.join(ids, sql`, `)})`);
      if (onlyStale) {
        conds.push(sql`(s."totalTakenUnits" IS DISTINCT FROM g.taken_u OR s."totalPassedUnits" IS DISTINCT FROM g.passed_u OR s."totalAverage" IS DISTINCT FROM g.reavg)`);
      }
      const cols = sql`s."studentCode" AS code, u."firstName" || ' ' || u."lastName" AS name, m.name AS major, s."totalTakenUnits" AS stored_taken, g.taken_u AS calc_taken, s."totalPassedUnits" AS stored_passed, g.passed_u AS calc_passed, s."totalAverage" AS stored_avg, g.reavg AS calc_avg`;
      const r = await paged(
        [
          { key: 'code', title: 'شماره دانشجویی' }, { key: 'name', title: 'نام' },
          { key: 'major', title: 'رشته' }, { key: 'stored_taken', title: 'اخذشدهٔ ذخیره' },
          { key: 'calc_taken', title: 'اخذشدهٔ محاسباتی' }, { key: 'stored_passed', title: 'قبول‌شدهٔ ذخیره' },
          { key: 'calc_passed', title: 'قبول‌شدهٔ محاسباتی' }, { key: 'stored_avg', title: 'معدل ذخیره' },
          { key: 'calc_avg', title: 'معدل محاسباتی' },
        ],
        baseFrom, conds, cols, sql`ORDER BY code`, f,
      );
      r.summary = `${r.total.toLocaleString('fa-IR')} پروندهٔ ناهمگام (فقط پیش‌نمایش — برای اعمال از recomputeStudentTotals استفاده کنید)`;
      return r;
    }

    // ── ارسال به پرتال: فارغ‌التحصیلان بدون ردیف alumni_profiles ──
    case 'portal-export': {
      const baseFrom = sql`FROM students s
        JOIN users u ON u.id = s."userId"
        LEFT JOIN majors m ON m.id = s."majorId"
        LEFT JOIN degree_level_configs d ON d.id = s."degreeLevelId"
        LEFT JOIN alumni_profiles ap ON ap."studentId" = s.id`;
      const conds = [...studentWhere(f), sql`s.status = 'GRADUATED'`, sql`ap.id IS NULL`];
      const cols = sql`s."studentCode" AS code, u."firstName" || ' ' || u."lastName" AS name, u."nationalCode" AS nc, m.name AS major, d.title AS degree, s."entryYear" AS y, s."graduateDate" AS gdate`;
      const r = await paged(
        [
          { key: 'code', title: 'شماره دانشجویی' }, { key: 'name', title: 'نام' },
          { key: 'nc', title: 'کد ملی' }, { key: 'major', title: 'رشته' },
          { key: 'degree', title: 'مقطع' }, { key: 'y', title: 'ورودی' }, { key: 'gdate', title: 'تاریخ فراغت', format: 'DATE' },
        ],
        baseFrom, conds, cols, sql`ORDER BY s."studentCode"`, f,
      );
      const done = await db.execute<{ n: string }>(
        sql`SELECT COUNT(*) AS n FROM alumni_profiles ap JOIN students s ON s.id = ap."studentId" WHERE s.status = 'GRADUATED'`,
      );
      r.summary = `${r.total.toLocaleString('fa-IR')} فارغ‌التحصیل آمادهٔ ارسال به پرتال — ${Number(done.rows[0]?.n ?? 0).toLocaleString('fa-IR')} نفر قبلاً ارسال شده‌اند`;
      return r;
    }

    default:
      return null;
  }
}

// ── جهش‌ها (فقط ADMIN) ─────────────────────────────────────────────────────

/** فارغ‌التحصیل‌کردن: status=GRADUATED + تاریخ فراغت */
export async function graduateStudents(idsInput: unknown, graduateDateInput?: unknown): Promise<MutationResult> {
  await requireRole(ADMIN_ROLE);
  const ids = asIds(idsInput);
  if (!ids.length) return { ok: false, error: 'شناسه‌ای انتخاب نشده است' };
  const rawGd = typeof graduateDateInput === 'string' ? graduateDateInput.trim() : '';
  if (rawGd && !/^\d{4}-\d{2}-\d{2}$/.test(rawGd)) return { ok: false, error: 'تاریخ فارغ‌التحصیلی باید به شکل YYYY-MM-DD باشد' };
  // مواد ۳۸ و ۵۰: تاریخ دانشآموختگی = تاریخ دفاع (پیشفرض قانونی). تاریخ دستی
  // فقط وقتی مقدم است که مدیر «مبنای دستی» را اورراید کرده باشد.
  let updated = 0;
  for (const id of ids) {
    const gd = await graduationDateFor(id, rawGd || null).catch(() => rawGd || null);
    const r = await db.execute<{ id: number }>(
      gd
        ? sql`UPDATE students SET status = 'GRADUATED', "graduateDate" = ${gd} WHERE id = ${id} RETURNING id`
        : sql`UPDATE students SET status = 'GRADUATED' WHERE id = ${id} RETURNING id`,
    );
    updated += r.rows.length;
  }
  return { ok: true, updated };
}

/** تغییر گروهی وضعیت */
export async function bulkSetStatus(idsInput: unknown, statusInput: unknown): Promise<MutationResult> {
  await requireRole(ADMIN_ROLE);
  const ids = asIds(idsInput);
  if (!ids.length) return { ok: false, error: 'شناسه‌ای انتخاب نشده است' };
  const st = typeof statusInput === 'string' ? statusInput : '';
  if (!Object.prototype.hasOwnProperty.call(STUDENT_STATUS_FA, st)) {
    return { ok: false, error: 'وضعیت نامعتبر است' };
  }
  const r = await db.execute<{ id: number }>(
    sql`UPDATE students SET status = ${st} WHERE id IN (${sql.join(ids, sql`, `)}) RETURNING id`,
  );
  return { ok: true, updated: r.rows.length };
}

/** تغییر گروهی آیین‌نامه */
export async function bulkSetRegulation(idsInput: unknown, regulationIdInput: unknown): Promise<MutationResult> {
  await requireRole(ADMIN_ROLE);
  const ids = asIds(idsInput);
  if (!ids.length) return { ok: false, error: 'شناسه‌ای انتخاب نشده است' };
  const regId = Number(regulationIdInput);
  if (!Number.isInteger(regId) || regId <= 0) return { ok: false, error: 'شناسهٔ آیین‌نامه نامعتبر است' };
  const ex = await db.execute<{ id: number }>(
    sql`SELECT id FROM educational_regulations WHERE id = ${regId} LIMIT 1`,
  );
  if (!ex.rows.length) return { ok: false, error: 'آیین‌نامه یافت نشد' };
  const r = await db.execute<{ id: number }>(
    sql`UPDATE students SET "regulationId" = ${regId} WHERE id IN (${sql.join(ids, sql`, `)}) RETURNING id`,
  );
  return { ok: true, updated: r.rows.length };
}

// فیلدهای مجاز ویرایش تکی پرونده (ستون‌های واقعی students)
const RECORD_ALLOWLIST = [
  'advisorCode', 'documentStatus', 'scholarshipType', 'militaryStatus', 'militaryExemptionNo',
  'homeTell', 'studentCardStatus', 'archiveNo', 'parvandehNo', 'dormName', 'dormRoom', 'hasDorm',
  'guardianJobTitle', 'guardianPhone', 'guardianAddress', 'guardianEmail',
  'diplomaType', 'diplomaPlace', 'diplomaYear', 'diplomaGrade',
  'pishdPlace', 'pishdYear', 'pishdGrade',
  'tuitionType', 'tuitionPayer', 'englishExamType', 'englishScore',
  'documentDeficiency', 'unitsRemaining', 'eqSemesters',
  'extraAllowedSemesters', 'extraAllowedProbations', 'currentTermNo',
] as const;

/** اصلاح تکی پروندهٔ دانشجو — فقط فیلدهای allowlist */
export async function updateStudentRecord(idInput: unknown, patchInput: unknown): Promise<MutationResult> {
  await requireRole(ADMIN_ROLE);
  const id = Number(idInput);
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: 'شناسهٔ دانشجو نامعتبر است' };
  if (!patchInput || typeof patchInput !== 'object' || Array.isArray(patchInput)) {
    return { ok: false, error: 'وصلهٔ ورودی نامعتبر است' };
  }
  const patch = patchInput as Record<string, unknown>;
  const sets: ReturnType<typeof sql>[] = [];
  for (const k of RECORD_ALLOWLIST) {
    const v = patch[k];
    if (v === undefined) continue;
    if (v === null) sets.push(sql`${sql.identifier(k)} = NULL`);
    else if (typeof v === 'string' || typeof v === 'number') sets.push(sql`${sql.identifier(k)} = ${v}`);
    else if (typeof v === 'boolean') sets.push(sql`${sql.identifier(k)} = ${v ? 1 : 0}`);
  }
  if (!sets.length) return { ok: false, error: 'هیچ فیلد مجازی برای به‌روزرسانی نیست' };
  const r = await db.execute<{ id: number }>(
    sql`UPDATE students SET ${sql.join(sets, sql`, `)} WHERE id = ${id} RETURNING id`,
  );
  if (!r.rows.length) return { ok: false, error: 'دانشجو یافت نشد' };
  return { ok: true, updated: 1 };
}

/** بازمحاسبهٔ totalTakenUnits/totalPassedUnits/totalAverage از enrollments */
export async function recomputeStudentTotals(idsInput: unknown): Promise<MutationResult> {
  await requireRole(ADMIN_ROLE);
  const ids = asIds(idsInput);
  if (!ids.length) return { ok: false, error: 'شناسه‌ای انتخاب نشده است' };
  // 🔒 معدل از **موتور رسمی** می‌آید (وزنی بر واحد + سیاست آیین‌نامه + حذف مردودی
  //    پس از قبولی). پیش‌تر میانگین سادهٔ نمره‌ها نوشته می‌شد و همین ستون
  //    `students.totalAverage` را خراب می‌کرد (و گزارش «نفرات برتر» از آن می‌خواند).
  let updated = 0;
  for (const id of ids) {
    const takenRes = await db.execute<{ taken_u: number }>(sql`
      SELECT COALESCE(SUM(c.units) FILTER (WHERE e.status <> 'DROPPED'), 0)::int AS taken_u
      FROM enrollments e
        LEFT JOIN course_offerings o ON o.id = e."offeringId"
        LEFT JOIN courses c ON c.id = o."courseId"
      WHERE e."studentId" = ${id}`);
    const taken = Number(takenRes.rows?.[0]?.taken_u ?? 0);
    const gpa = await calculateOfficialGpaBreakdown(id).catch(() => null);
    const upd = await db.execute<{ id: number }>(sql`
      UPDATE students
         SET "totalTakenUnits" = ${taken},
             "totalPassedUnits" = ${gpa?.passedUnits ?? 0},
             "totalAverage" = ${gpa && gpa.totalUnits > 0 ? gpa.gpa : null}
       WHERE id = ${id} RETURNING id`);
    updated += upd.rows?.length ?? 0;
  }
  return { ok: true, updated };
}

/** ارسال به پرتال: ساخت ردیف alumni_profiles برای فارغ‌التحصیلان بدون پروفایل */
export async function exportToAlumniPortal(idsInput: unknown): Promise<MutationResult> {
  await requireRole(ADMIN_ROLE);
  const ids = asIds(idsInput);
  if (!ids.length) return { ok: false, error: 'شناسه‌ای انتخاب نشده است' };
  const r = await db.execute<{ id: number }>(sql`
    INSERT INTO alumni_profiles ("studentId", "allowContact")
    SELECT s.id, 1 FROM students s
    WHERE s.id IN (${sql.join(ids, sql`, `)}) AND s.status = 'GRADUATED'
    ON CONFLICT DO NOTHING
    RETURNING id`);
  return { ok: true, updated: r.rows.length };
}
