// ══════════════════════════════════════════════════════════════════════
// هلپرها و تایپ‌های مشترک گزارش‌ها (بدون 'use server' — چون توابع/ثابت‌های
// غیرasync هم اکسپورت می‌کند؛ فایل‌های r-*.ts و actions.ts از اینجا می‌خوانند.
// ══════════════════════════════════════════════════════════════════════
import { db } from '@/db';
import { sql } from 'drizzle-orm';
import { STUDENT_STATUS_FA } from '@/lib/student-labels';
import { escapeLikeChars, toEnDigits } from '@/lib/persian-search';
import { isRealUniversityId } from '@/lib/university-scope';

export const PER = 50;

export type ReportFilters = {
  term?: string;
  degreeId?: number;
  facultyId?: number;
  majorId?: number;
  departmentId?: number;
  entryYear?: number;
  /** نیمسال ورود (۱ = اول، ۲ = دوم، ۳ = تابستان) */
  entryTerm?: number;
  /** بازهٔ سال ورود (فرم‌های «از ورودی … تا ورودی …») */
  entryYearFrom?: number;
  entryYearTo?: number;
  /** جنسیت (MALE/FEMALE) — روی users.gender */
  gender?: string;
  /** سهمیه (NORMAL/SHAHED/STAFF/TOP_TALENT) */
  quotaType?: string;
  /** دامنهٔ وضعیت دانشجو: ACTIVE | INACTIVE | ALL (پیش‌فرض ALL) */
  statusScope?: string;
  q?: string;
  nationalCode?: string;
  miss?: string;
  page?: number;
  universityId?: number;
  /** فیلترهای سفارشی ماژول‌ها (مثل gradeStatus/samaCode/onlyStale) */
  [key: string]: string | number | boolean | undefined;
};

export type ReportColumn = {
  key: string;
  title: string;
  /**
   * قالب نمایش/خروجی سلول — در `@/lib/report-format` تفسیر می‌شود تا هیچ تاریخ
   * میلادی یا مبلغ بدون جداکننده به کاربر نرسد.
   */
  format?: 'DATE' | 'DATETIME' | 'MONEY' | 'NUMBER';
};
export type ReportResult = {
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  total: number;
  page: number;
  per: number;
  totalPages: number;
  summary?: string;
};

export type FilterOptions = {
  terms: { code: string; title: string | null }[];
  degrees: { id: number; title: string }[];
  faculties: { id: number; name: string }[];
  departments: { id: number; name: string; code: string | null }[];
  majors: { id: number; name: string; code: string | null }[];
  entryYears: number[];
  latestTerm: string;
  universities: { id: number; code: string; title: string; kind: string }[];
};

export const NUM = sql`e."gradeValue"::text ~ '^[0-9]+(\\.[0-9]+)?$'`;

export function faStatus(s: unknown): string {
  const k = String(s ?? '');
  return STUDENT_STATUS_FA[k] ?? k;
}

/** هلپرهای مشترک گزارش‌ها — ماژول‌های r-*.ts از همین‌ها استفاده می‌کنند */
export function studentWhere(f: ReportFilters, alias = 's') {
  const a = sql.identifier(alias);
  const c = [];
  // تفکیک دانشگاه اجباری (fail-closed): بدون دانشگاهِ معتبر هیچ ردیفی برنگردان
  // ⚠ پیش‌تر وقتی runReport برای دانشگاه نامشخص مقدار -1 می‌گذاشت، شرط
  //   «= -1 OR IS NULL» می‌شد و ردیف‌های بدون دانشگاه به‌جای «هیچ»، همه برمی‌گشتند.
  if (isRealUniversityId(f.universityId)) c.push(sql`(${a}."universityId" = ${f.universityId} OR ${a}."universityId" IS NULL)`);
  else c.push(sql`1 = 0`);
  // مقطع: عنوان‌ها در کاتالوگ تکراری‌اند (SAMA/HAMAVA) — با عنوان تطبیق بده تا همهٔ شناسه‌های هم‌عنوان بیایند
  if (f.degreeId) c.push(sql`${a}."degreeLevelId" IN (SELECT id FROM degree_level_configs WHERE title = (SELECT title FROM degree_level_configs WHERE id = ${f.degreeId}))`);
  if (f.facultyId) c.push(sql`m."facultyId" = ${f.facultyId}`);
  if (f.departmentId) c.push(sql`m."departmentId" = ${f.departmentId}`);
  if (f.majorId) c.push(sql`${a}."majorId" = ${f.majorId}`);
  if (f.entryYear) c.push(sql`${a}."entryYear" = ${f.entryYear}`);
  if (f.entryYearFrom) c.push(sql`${a}."entryYear" >= ${Number(f.entryYearFrom)}`);
  if (f.entryYearTo) c.push(sql`${a}."entryYear" <= ${Number(f.entryYearTo)}`);
  if (f.entryTerm) c.push(sql`${a}."entryTerm" = ${Number(f.entryTerm)}`);
  if (f.gender === 'MALE' || f.gender === 'FEMALE') c.push(sql`u."gender" = ${f.gender}`);
  if (f.quotaType) c.push(sql`${a}."quotaType" = ${String(f.quotaType)}`);
  // دامنهٔ وضعیت: پیش‌فرض «همه» تا با فرم‌های قدیم (فعال/غیرفعال/همه) یکی باشد
  if (f.statusScope === 'ACTIVE') c.push(sql`${a}."status" = 'ACTIVE'`);
  else if (f.statusScope === 'INACTIVE') c.push(sql`${a}."status" <> 'ACTIVE'`);
  if (f.nationalCode) {
    // کدهای ذخیره‌شده انگلیسی‌اند؛ ارقام فارسی ورودی نرمال می‌شود تا کدهای SA/SS هم پیدا شوند.
    // فرار ٪ _ \ تا wildcard تزریقی معنا نگیرد (با ESCAPE '\').
    const like = `%${escapeLikeChars(toEnDigits(String(f.nationalCode)))}%`;
    c.push(sql`u."nationalCode" ILIKE ${like} ESCAPE '\\'`);
  }
  if (f.q) {
    const like = `%${escapeLikeChars(toEnDigits(String(f.q)))}%`;
    c.push(sql`(${a}."studentCode" ILIKE ${like} ESCAPE '\\' OR u."firstName" ILIKE ${like} ESCAPE '\\' OR u."lastName" ILIKE ${like} ESCAPE '\\' OR u."nationalCode" ILIKE ${like} ESCAPE '\\')`);
  }
  return c;
}

export function joinAnd(conds: ReturnType<typeof sql>[]) {
  if (!conds.length) return sql``;
  return sql`WHERE ${sql.join(conds, sql` AND `)}`;
}

export async function paged(
  columns: ReportColumn[],
  baseFrom: ReturnType<typeof sql>,
  whereConds: ReturnType<typeof sql>[],
  selectCols: ReturnType<typeof sql>,
  orderBy: ReturnType<typeof sql>,
  f: ReportFilters,
  groupBy?: ReturnType<typeof sql>,
  having?: ReturnType<typeof sql>,
): Promise<ReportResult> {
  const page = Math.max(1, f.page || 1);
  const where = joinAnd(whereConds);
  const grp = groupBy ? sql`GROUP BY ${groupBy}` : sql``;
  const hav = having ? sql`HAVING ${having}` : sql``;
  const cnt = await db.execute<{ n: string }>(
    sql`SELECT COUNT(*)::int AS n FROM (SELECT 1 ${baseFrom} ${where} ${grp} ${hav}) t`,
  );
  const total = Number(cnt.rows[0]?.n ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / PER));
  const safe = Math.min(page, totalPages);
  const data = await db.execute<Record<string, unknown>>(
    sql`SELECT ${selectCols} ${baseFrom} ${where} ${grp} ${hav} ${orderBy} LIMIT ${PER} OFFSET ${(safe - 1) * PER}`,
  );
  return { columns, rows: data.rows, total, page: safe, per: PER, totalPages };
}

export const STU_FROM = sql`FROM students s JOIN users u ON u.id = s."userId" LEFT JOIN majors m ON m.id = s."majorId" LEFT JOIN degree_level_configs d ON d.id = s."degreeLevelId" LEFT JOIN faculties fc ON fc.id = m."facultyId"`;
export const STU_COLS = sql`s."studentCode" AS code, u."firstName" || ' ' || u."lastName" AS name, u."nationalCode" AS nc, m.name AS major, d.title AS degree, s."entryYear" AS y, s.status AS st`;

export async function studentListReport(
  columns: ReportColumn[],
  extraConds: ReturnType<typeof sql>[],
  f: ReportFilters,
  orderDefault: ReturnType<typeof sql> = sql`ORDER BY s."studentCode"`,
): Promise<ReportResult> {
  const r = await paged(columns, STU_FROM, [...studentWhere(f), ...extraConds], STU_COLS, orderDefault, f);
  r.rows = r.rows.map(x => ({ ...x, st: faStatus(x.st) }));
  return r;
}

/** همهٔ kindهای گزارش (قدیم + موج ۲ + جمع‌آوری‌شده) — برای فیلتر مجازها در UI */
export const ALL_REPORT_KINDS: string[] = [
  'active-term', 'status-summary', 'by-faculty', 'by-major', 'grade-status', 'probation',
  'top', 'incomplete', 'graduates', 'entries', 'noshow', 'transfers', 'tuition',
  'payesh', 'jame', 'docs', 'third-attempt',
  'probation-violations', 'probation-chains', 'unit-cap-violations', 'repeated-courses',
  'student-weekly-conflicts', 'student-exam-conflicts', 'prereq-violations', 'course-grade-status',
  'enrollment-pick', 'offered-course-roster', 'top-students', 'no-photo', 'graduates-info',
  'status-report', 'major-change-report', 'status-change-report', 'gpa-refresh-preview',
  'profile-refresh', 'portal-export', 'exam-session-sheet', 'seat-numbers', 'final-exam-schedule',
  'grade-entry-report', 'grade-deadline', 'empty-rooms', 'weekly-timetable', 'room-conflicts',
  'low-enrollment', 'makeup-courses', 'staff-list', 'staff-courses', 'staff-timetable',
  'attendance-list', 'tuition-tariff', 'tuition-statement', 'pending-requests', 'defenses',
  'proposals', 'council-edu', 'letter-templates', 'transcript-card', 'exam-entry-card',
  'student-card', 'study-cert', 'edu-confirm', 'grad-cert', 'military-defer',
  'finance-worklist', 'payroll-overview', 'bi-teaching-quality', 'bi-facilities',
  'graduation-dossiers', 'grade-audit-log',
  // تشکیل کلاس استادان (r-prof-class)
  'prof-formation-summary', 'prof-formation-detail', 'prof-formation-none', 'prof-sessions-unformed',
  // گزارش‌های پرداختی/مالی هم‌ریخت با اسناد سما (r-finance)
  'total-payments', 'student-payments', 'term-payments', 'accounting-voucher', 'term-financial',
];

/** گیت ماتریس دسترسی برای هر گزارش: ADMIN آزاد، بقیه نیازمند reports:<kind> */
