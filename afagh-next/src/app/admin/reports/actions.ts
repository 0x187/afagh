'use server';

import { db } from '@/db';
import { sql } from 'drizzle-orm';
import { requireRole } from '@/lib/auth';
import { getCurrentUniversity, isRealUniversityId } from '@/lib/university-scope';
import { CREDIT_LEDGER_TYPES, DEBT_LEDGER_TYPES } from '@/lib/ledger-balance';
import { calculateOfficialGpaBreakdown } from '@/lib/regulations-engine';
import { formatReportCell } from '@/lib/report-format';
import { getReportPrintBrand } from '@/lib/report-print-brand';
import {
  NUM,
  PER,
  STU_COLS,
  STU_FROM,
  faStatus,
  joinAnd,
  paged,
  studentListReport,
  studentWhere,
} from './report-helpers';
import type { FilterOptions, ReportColumn, ReportFilters, ReportResult } from './report-helpers';
export type { FilterOptions, ReportColumn, ReportFilters, ReportResult } from './report-helpers';

// ── ماژول‌های گزارش (هر خانواده یک فایل r-*.ts؛ اولین غیرnull برنده است) ──
import { run as runClass } from './r-class';
import { run as runCouncilLetters } from './r-council-letters';
import { run as runEduProbation } from './r-edu-probation';
import { run as runEduRoster } from './r-edu-roster';
import { run as runEduSchedule } from './r-edu-schedule';
import { run as runExam } from './r-exam';
import { run as runFinance } from './r-finance';
import { run as runStaff } from './r-staff';
import { run as runProfClass } from './r-prof-class';
import { run as runStatusOps } from './r-status-ops';
import { run as runThesis } from './r-thesis';
import { run as runCollect } from './r-collect-external';

// نقش‌های هر دو مرکز گزارش (آموزشی + مالی). کارشناس مالی نباید برای باز کردن
// مرکز مالی به نقش آموزشی نیاز داشته باشد؛ گیت ریز (assertReportPermission)
// همچنان اجازهٔ اجرای هر گزارش را با reports:<kind> / مرکز می‌دهد.
const ROLES = ['ADMIN', 'EDU_EXPERT', 'ARCHIVE_EXPERT', 'MILITARY_OFFICER', 'FINANCE_EXPERT', 'FINANCE', 'CASHIER'] as never[];

// ── دسته‌بندی مرکز گزارش‌ها ──
// kindهای دستهٔ «مالی» — همان cat: 'finance' در کلاینت (ReportsClient).
// برای اعطای سطح مرکز (reports:finance) بدون نیاز به دادن reports:<kind> تکتک.
const FINANCE_KINDS = new Set([
  'tuition',
  'tuition-tariff',
  'tuition-statement',
  'finance-worklist',
  'payroll-overview',
  'bi-teaching-quality',
  'bi-facilities',
  // گزارش‌های پرداختی/مالی (r-finance) — هم‌ریخت با اسناد رسمی
  'total-payments',
  'student-payments',
  'term-payments',
  'accounting-voucher',
  'term-financial',
  'tuition-overview',
  'tuition-faculty-detail',
  'faculty-financial',
  'major-financial',
]);

/** نگاشت kind → مرکز: فقط «مالی» جدا می‌شود؛ مابقی آموزشی‌اند */
function reportCenter(kind: string): 'finance' | 'edu' {
  return FINANCE_KINDS.has(kind) ? 'finance' : 'edu';
}

export async function getFilterOptions({ universityId, signerForm = 'edu-report' }: { universityId?: number; signerForm?: string } = {}): Promise<FilterOptions> {
  await requireRole(ROLES);
  // 🔒 اگر دانشگاهِ فعال معتبر نباشد (۰ = DENY_UNI یا نامشخص) از «هیچ دانشگاهی»
  // استفاده می‌شود، نه «همهٔ دانشگاه‌ها». پیش‌تر شرط کاملاً حذف می‌شد و فهرست
  // ترم/دانشکده/گروه/رشته/ورودیِ همهٔ دانشگاه‌ها لو می‌رفت (fail-open).
  const uid = isRealUniversityId(universityId) ? universityId : -1;
  const terms = await db.execute<{ code: string; title: string | null }>(
    uid
      ? sql`SELECT DISTINCT "termCode" AS code, MAX(title) AS title FROM academic_terms WHERE "universityId" = ${uid} GROUP BY "termCode" ORDER BY "termCode" DESC`
      : sql`SELECT DISTINCT "termCode" AS code, MAX(title) AS title FROM academic_terms GROUP BY "termCode" ORDER BY "termCode" DESC`,
  );
  const degrees = await db.execute<{ id: number; title: string }>(
    sql`SELECT MIN(id) AS id, title FROM degree_level_configs GROUP BY title ORDER BY MIN(id)`,
  );
  const faculties = await db.execute<{ id: number; name: string }>(
    uid
      ? sql`SELECT id, name FROM faculties WHERE "universityId" = ${uid} OR "universityId" IS NULL ORDER BY id`
      : sql`SELECT id, name FROM faculties ORDER BY id`,
  );
  const departments = await db.execute<{ id: number; name: string; code: string | null }>(
    uid
      ? sql`SELECT id, name, "departmentCode" AS code FROM departments WHERE "universityId" = ${uid} OR "universityId" IS NULL ORDER BY name`
      : sql`SELECT id, name, "departmentCode" AS code FROM departments ORDER BY name`,
  );
  const majors = await db.execute<{ id: number; name: string; code: string | null }>(
    uid
      ? sql`SELECT id, name, "majorCode" AS code FROM majors WHERE "universityId" = ${uid} OR "universityId" IS NULL ORDER BY name`
      : sql`SELECT id, name, "majorCode" AS code FROM majors ORDER BY name`,
  );
  const years = await db.execute<{ y: number }>(
    sql`SELECT DISTINCT "entryYear" AS y FROM students ${uid ? sql`WHERE "universityId" = ${uid}` : sql``} ORDER BY 1 DESC`,
  );
  // ── هویت بصری سند چاپی (همان منبع واحدِ گزارشساز/گزارشهای ذخیرهشده) ──
  const brand = await getReportPrintBrand(signerForm, uid > 0 ? uid : undefined);

  return {
    terms: terms.rows,
    degrees: degrees.rows,
    faculties: faculties.rows,
    departments: departments.rows,
    majors: majors.rows,
    entryYears: years.rows.map(r => Number(r.y)),
    latestTerm: terms.rows[0]?.code ?? '',
    universities: (await db.execute<{ id: number; code: string; title: string; kind: string }>(
      sql`SELECT id, code, title, kind FROM universities WHERE "isActive" = 1 ORDER BY id`
    )).rows,
    universityTitle: brand.universityTitle,
    universityLogoUrl: brand.universityLogoUrl,
    signers: brand.signers,
  };
}

export async function assertReportPermission(kind: string): Promise<void> {
  const user = await requireRole(ROLES);
  if (user.roles.includes('ADMIN')) return;
  const { getUserPermissions } = await import('@/lib/permissions-enforcer');
  const perms = await getUserPermissions(user.id);
  const ok =
    perms.has(`reports:${kind}`) ||
    (reportCenter(kind) === 'finance' ? perms.has('reports:finance') : perms.has('reports:edu'));
  if (!ok) {
    throw new Error('دسترسی به این گزارش در ماتریس دسترسی‌ها داده نشده است.');
  }
}

/** گزارش‌هایی که کاربر جاری مجاز است (برای فیلتر کارت‌ها) — ADMIN یعنی همه */
export async function allowedReportKinds(kinds: string[]): Promise<string[] | null> {
  const user = await requireRole(ROLES);
  if (user.roles.includes('ADMIN')) return null;
  const { getUserPermissions } = await import('@/lib/permissions-enforcer');
  const perms = await getUserPermissions(user.id);
  const hasEdu = perms.has('reports:edu');
  const hasFinance = perms.has('reports:finance');
  return kinds.filter(k =>
    perms.has(`reports:${k}`) ||
    (reportCenter(k) === 'finance' ? hasFinance : hasEdu),
  );
}

/** فهرست ترمهای فیلتر «چند ترم» (ویرگول/فاصله جداکننده؛ تکرارها حذف شوند). */
function parseTermList(f: ReportFilters): string[] {
  const raw = typeof f.terms === 'string' ? f.terms : '';
  return Array.from(new Set(raw.split(/[,،\s]+/).map(s => s.trim()).filter(Boolean)));
}

/** سقف ردیفهای گردآوریشده برای هر ترم، تا اجرای چندترمهای بیتوقف نشود. */
const MULTI_TERM_CAP = 3000;

/**
 * نقطهٔ ورود گزارشها.
 *
 * حالت عادی (یک ترم / همهٔ ترمها با `term=''`) دقیقاً همان مسیر قدیمی است.
 * حالت «چند ترم» گزارش را برای تکتک ترمها اجرا میکند، ستون «ترم» به
 * نتیجه اضافه میکند و ردیفها را یکی کرده، دوباره صفحهبندی مینماید.
 * مزیت: هیچیک از ~۴۰ محل SQLـای `f.term` در ماژولهای r-*.ts نیاز به
 * تغییر ندارند (هر اجرا همچنان یک `term` تکی میگیرد).
 */
export async function runReport(kind: string, f: ReportFilters): Promise<ReportResult> {
  const terms = parseTermList(f);
  if (terms.length > 1) return runReportMultiTerm(kind, f, terms);
  return executeReport(kind, f);
}

async function runReportMultiTerm(
  kind: string,
  f: ReportFilters,
  terms: string[],
): Promise<ReportResult> {
  await requireRole(ROLES);
  await assertReportPermission(kind);
  const uni = await getCurrentUniversity().catch(() => null);
  if (!isRealUniversityId(uni?.id)) {
    return {
      columns: [], rows: [], total: 0, page: 1, per: PER, totalPages: 1,
      summary: 'دانشگاه فعال شما مشخص نیست؛ اجرای گزارش ممکن نیست.',
    };
  }
  const base: ReportFilters = { ...f, universityId: uni.id, terms: undefined };
  const merged: Record<string, unknown>[] = [];
  let columns: ReportColumn[] = [];
  for (const t of terms) {
    const first = await executeReport(kind, { ...base, term: t, page: 1 });
    if (!columns.length && first.columns.length) {
      columns = first.columns.some(c => c.key === '__term')
        ? first.columns
        : [{ key: '__term', title: 'ترم' }, ...first.columns];
    }
    const rows = [...first.rows];
    for (let p = 2; p <= first.totalPages && rows.length < MULTI_TERM_CAP; p++) {
      const r = await executeReport(kind, { ...base, term: t, page: p });
      rows.push(...r.rows);
    }
    for (const row of rows) merged.push({ ...row, __term: t });
  }
  const total = merged.length;
  const totalPages = Math.max(1, Math.ceil(total / PER));
  const page = Math.min(Math.max(1, Number(f.page) || 1), totalPages);
  return {
    columns: columns.length ? columns : [{ key: '__term', title: 'ترم' }],
    rows: merged.slice((page - 1) * PER, page * PER),
    total,
    page,
    per: PER,
    totalPages,
    summary: `${terms.length.toLocaleString('fa-IR')} ترم (${terms.join('، ')}) — ${total.toLocaleString('fa-IR')} ردیف`,
  };
}

async function executeReport(kind: string, f: ReportFilters): Promise<ReportResult> {
  await requireRole(ROLES);
  await assertReportPermission(kind);
  // تفکیک دانشگاه سمت سرورمشتق می‌شود؛ ورودی کلاینت نادیده گرفته می‌شود
  const uni = await getCurrentUniversity().catch(() => null);
  // 🔒 fail-closed واقعی: بدون دانشگاهِ معتبر هیچ گزارشی اجرا نمی‌شود.
  //    پیش‌تر مقدار جانشین ۱- بود و چون truthy است، شرط‌های درون گزارش‌ها
  //    «= -1 OR universityId IS NULL» می‌ساختند ⇒ رکوردهای بدون دانشگاه
  //    (به‌جای «هیچ») برمی‌گشتند.
  if (!isRealUniversityId(uni?.id)) {
    return {
      columns: [], rows: [], total: 0, page: 1, per: 50, totalPages: 1,
      summary: 'دانشگاه فعال شما مشخص نیست؛ اجرای گزارش ممکن نیست.',
    };
  }
  f = { ...f, universityId: uni.id };
  const term = f.term || '';

  try {
  switch (kind) {
    // ── دانشجویان فعال هر ترم ──
    case 'active-term': {
      const effectiveTerm = term || (await db.execute<{ code: string }>(sql`SELECT "termCode" AS code FROM academic_terms ORDER BY "termCode" DESC LIMIT 1`)).rows[0]?.code || '';
      const conds = [sql`t."termCode" = ${effectiveTerm}`, ...studentWhere(f)];
      const from = sql`FROM enrollments e JOIN course_offerings o ON o.id = e."offeringId" JOIN academic_terms t ON t.id = o."termId" JOIN students s ON s.id = e."studentId" JOIN users u ON u.id = s."userId" LEFT JOIN majors m ON m.id = s."majorId" LEFT JOIN degree_level_configs d ON d.id = s."degreeLevelId"`;
      const cols = sql`s."studentCode" AS code, u."firstName" || ' ' || u."lastName" AS name, m.name AS major, d.title AS degree, COUNT(e.id)::int AS units, ROUND(AVG(CASE WHEN e."gradeStatus" = 'FINALIZED' AND ${NUM} THEN e."gradeValue"::numeric END), 2) AS avg`;
      const r = await paged(
        [
          { key: 'code', title: 'شماره دانشجویی' }, { key: 'name', title: 'نام' },
          { key: 'major', title: 'رشته' }, { key: 'degree', title: 'مقطع' },
          { key: 'units', title: 'تعداد درس' }, { key: 'avg', title: 'میانگین' },
        ],
        from, conds, cols, sql`ORDER BY code`, f,
        sql`s."studentCode", u."firstName", u."lastName", m.name, d.title`,
      );
      r.summary = `${r.total.toLocaleString('fa-IR')} دانشجو در ترم ${effectiveTerm}`;
      return r;
    }

    // ── خلاصه وضعیت تحصیلی ──
    case 'status-summary': {
      // 🔒 همهٔ فیلترهای دانشجویی (مقطع/دانشکده/گروه/رشته/ورودی/نیمسال ورود/جنسیت/سهمیه/کدملی)
      const where = joinAnd(studentWhere(f));
      const data = await db.execute<Record<string, unknown>>(sql`
        SELECT s.status AS st, d.title AS degree, COUNT(*)::int AS n
        ${STU_FROM}
        ${where}
        GROUP BY s.status, d.title ORDER BY 1, 2`);
      const rows = data.rows.map(x => ({ st: faStatus(x.st), degree: x.degree, n: x.n }));
      const total = rows.reduce((a, x) => a + Number(x.n), 0);
      return {
        columns: [{ key: 'st', title: 'وضعیت' }, { key: 'degree', title: 'مقطع' }, { key: 'n', title: 'تعداد' }],
        rows, total, page: 1, per: total || 1, totalPages: 1,
        summary: `جمع کل: ${total.toLocaleString('fa-IR')} پرونده`,
      };
    }

    // ── به تفکیک دانشکده ──
    case 'by-faculty': {
      const where = joinAnd(studentWhere(f));
      const data = await db.execute<Record<string, unknown>>(sql`
        SELECT COALESCE(fc.name, '— بدون دانشکده —') AS faculty, s.status AS st, COUNT(*)::int AS n
        ${STU_FROM}
        ${where}
        GROUP BY fc.name, s.status ORDER BY 1, 2`);
      const acc = new Map<string, Record<string, unknown>>();
      for (const r of data.rows) {
        const k = String(r.faculty);
        if (!acc.has(k)) acc.set(k, { faculty: k, total: 0 });
        const o = acc.get(k)!;
        o[String(r.st)] = r.n;
        o.total = Number(o.total) + Number(r.n);
      }
      const statuses = [...new Set(data.rows.map(r => String(r.st)))];
      const rows = [...acc.values()].map(o => {
        const out: Record<string, unknown> = { faculty: o.faculty, total: o.total };
        for (const s of statuses) out[s] = Number(o[s] ?? 0) ? `${Number(o[s]).toLocaleString('fa-IR')} ${faStatus(s)}` : '—';
        return out;
      });
      const cols: ReportColumn[] = [{ key: 'faculty', title: 'دانشکده' }, { key: 'total', title: 'جمع' },
        ...statuses.map(s => ({ key: s, title: faStatus(s) }))];
      return { columns: cols, rows, total: rows.length, page: 1, per: rows.length || 1, totalPages: 1 };
    }

    // ── به تفکیک رشته ──
    case 'by-major': {
      const conds = studentWhere(f);
      const where = joinAnd(conds);
      const data = await db.execute<Record<string, unknown>>(sql`
        SELECT m."majorCode" AS code, m.name AS major, d.title AS degree, COALESCE(fc.name, '—') AS faculty,
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE s.status = 'ACTIVE')::int AS a,
          COUNT(*) FILTER (WHERE s.status = 'GRADUATED')::int AS g,
          COUNT(*) FILTER (WHERE s.status = 'WITHDRAWN')::int AS w,
          COUNT(*) FILTER (WHERE s.status = 'NO_SHOW')::int AS n
        ${STU_FROM} ${where}
        GROUP BY m."majorCode", m.name, d.title, fc.name ORDER BY total DESC`);
      return {
        columns: [
          { key: 'code', title: 'کد' }, { key: 'major', title: 'رشته' },
          { key: 'degree', title: 'مقطع' }, { key: 'faculty', title: 'دانشکده' },
          { key: 'total', title: 'جمع' }, { key: 'a', title: 'فعال' },
          { key: 'g', title: 'فارغ‌التحصیل' }, { key: 'w', title: 'انصراف' }, { key: 'n', title: 'عدم مراجعه' },
        ],
        rows: data.rows, total: data.rows.length, page: 1, per: data.rows.length || 1, totalPages: 1,
      };
    }

    // ── وضعیت نمرات ترم ──
    case 'grade-status': {
      const conds = [sql`t."termCode" = ${term}`, ...studentWhere(f)];
      const data = await db.execute<Record<string, unknown>>(sql`
        SELECT e."gradeStatus" AS st, COUNT(*)::int AS n,
          ROUND(AVG(CASE WHEN ${NUM} THEN e."gradeValue"::numeric END), 2) AS avg
        FROM enrollments e
          JOIN course_offerings o ON o.id = e."offeringId"
          JOIN academic_terms t ON t.id = o."termId"
          JOIN students s ON s.id = e."studentId"
          JOIN users u ON u.id = s."userId"
          LEFT JOIN majors m ON m.id = s."majorId"
        WHERE ${sql.join(conds, sql` AND `)}
        GROUP BY 1 ORDER BY 2 DESC`);
      const total = data.rows.reduce((a, x) => a + Number(x.n), 0);
      return {
        columns: [{ key: 'st', title: 'وضعیت نمره' }, { key: 'n', title: 'تعداد' }, { key: 'avg', title: 'میانگین نمرات' }],
        rows: data.rows, total, page: 1, per: data.rows.length || 1, totalPages: 1,
        summary: `${total.toLocaleString('fa-IR')} رکورد نمره در ترم ${term}`,
      };
    }

    // ── مشروطی‌های ترم — مرز از آیین‌نامهٔ همان مقطع و از موتور رسمی ──
    // 🔒 پیش‌تر «AVG < 12» هاردکد بود (ارشد ۱۴ و دکتری ۱۶ دارند) و «تعداد درس»
    //    (نه واحد) معیار قرار می‌گرفت؛ تابستان و معادل‌سازی هم استثنا نمی‌شد.
    //    اکنون از calculateOfficialGpaBreakdown می‌آید: همان مرز مشروطیِ مقطع،
    //    واحد مؤثر، و همان ردیف‌هایی که در کارنامهٔ رسمی مشروط شمرده می‌شوند.
    case 'probation': {
      const isSummerOrEquiv = (code: string | null) => {
        const c = String(code ?? '');
        return /3$/.test(c) || /5$/.test(c) || c.toUpperCase().includes('EQ');
      };
      const CAP = 600;
      const pop = await db.execute<{
        id: number; code: string; name: string; major: string | null;
        degree: string | null; y: number | null; st: string | null;
      }>(sql`
        SELECT s.id AS id, s."studentCode" AS code, u."firstName" || ' ' || u."lastName" AS name,
               m.name AS major, d.title AS degree, s."entryYear" AS y, s.status AS st
        ${STU_FROM}
        WHERE ${sql.join(studentWhere(f), sql` AND `)}
        ORDER BY s."studentCode"
        LIMIT ${CAP}
      `);
      const out: Record<string, unknown>[] = [];
      for (const row of pop.rows ?? []) {
        const b = await calculateOfficialGpaBreakdown(row.id).catch(() => null);
        if (!b) continue;
        const probTerms = b.terms.filter(t =>
          t.isProbation
          && !isSummerOrEquiv(t.termCode)
          && (!term || String(t.termCode ?? '') === term));
        if (!probTerms.length) continue;
        const last = probTerms[probTerms.length - 1];
        out.push({
          code: row.code, name: row.name, major: row.major ?? '—', degree: row.degree ?? '—',
          y: row.y ?? '—', probTerms: probTerms.length,
          lastTerm: last.termTitle, lastGpa: last.gpa, threshold: b.probationThreshold,
          units: last.units, st: faStatus(row.st),
        });
      }
      out.sort((a, b2) => Number(b2.probTerms) - Number(a.probTerms));
      const page = Math.max(1, Number(f.page) || 1);
      const rows = out.slice((page - 1) * PER, page * PER);
      return {
        columns: [
          { key: 'code', title: 'شماره دانشجویی' }, { key: 'name', title: 'نام' },
          { key: 'major', title: 'رشته' }, { key: 'degree', title: 'مقطع' },
          { key: 'y', title: 'سال ورود' }, { key: 'probTerms', title: 'تعداد ترم مشروطی' },
          { key: 'lastTerm', title: 'آخرین ترم مشروط' }, { key: 'lastGpa', title: 'معدل آن ترم' },
          { key: 'threshold', title: 'مرز مشروطی مقطع' }, { key: 'units', title: 'واحد مؤثر' },
          { key: 'st', title: 'وضعیت' },
        ],
        rows, total: out.length, page, per: PER,
        totalPages: Math.max(1, Math.ceil(out.length / PER)),
        summary: `${out.length.toLocaleString('fa-IR')} دانشجوی مشروط بر پایهٔ مرز آیین‌نامهٔ مقطع (تابستان/معادل‌سازی شمرده نشد)`
          + ((pop.rows?.length ?? 0) >= CAP ? ` · توجه: سقف ${CAP} نفر برای سرعت؛ رشته/مقطع/سال و نیمسال ورود را فیلتر کنید.` : ''),
      };
    }

    // ── نمرات برتر هر رشته ──
    case 'top': {
      const from = sql`FROM enrollments e JOIN students s ON s.id = e."studentId" JOIN users u ON u.id = s."userId" LEFT JOIN majors m ON m.id = s."majorId" LEFT JOIN degree_level_configs d ON d.id = s."degreeLevelId"`;
      const conds = [sql`e."gradeStatus" = 'FINALIZED'`, sql`${NUM}`, ...studentWhere(f)];
      const cols = sql`s."studentCode" AS code, u."firstName" || ' ' || u."lastName" AS name, m.name AS major, d.title AS degree, s."entryYear" AS y, COUNT(*)::int AS units, ROUND(AVG(e."gradeValue"::numeric), 2) AS avg`;
      return paged(
        [
          { key: 'code', title: 'شماره دانشجویی' }, { key: 'name', title: 'نام' },
          { key: 'major', title: 'رشته' }, { key: 'degree', title: 'مقطع' },
          { key: 'y', title: 'ورودی' }, { key: 'units', title: 'درس' }, { key: 'avg', title: 'میانگین کل' },
        ],
        from, conds, cols, sql`ORDER BY avg DESC`, f,
        sql`s."studentCode", u."firstName", u."lastName", m.name, d.title, s."entryYear"`,
        sql`COUNT(*) >= 10 AND AVG(e."gradeValue"::numeric) >= 17`,
      );
    }

    // ── پرونده‌های ناقص (تکمیلی) ──
    case 'incomplete': {
      const miss = f.miss || 'national';
      const extra =
        miss === 'mobile' ? sql`u.mobile IS NULL OR u.mobile = '' OR u.mobile = '—'` :
        miss === 'major' ? sql`s."majorId" IS NULL` :
        sql`u."nationalCode" IS NULL OR u."nationalCode" !~ '^[0-9]{10}$'`;
      return studentListReport(
        [
          { key: 'code', title: 'شماره دانشجویی' }, { key: 'name', title: 'نام' },
          { key: 'nc', title: 'کد ملی' }, { key: 'major', title: 'رشته' },
          { key: 'degree', title: 'مقطع' }, { key: 'y', title: 'ورودی' }, { key: 'st', title: 'وضعیت' },
        ],
        [extra], f,
      );
    }

    // ── دروس بار سوم (مردودی دو بار قبلی) ──
    // «بار سوم» یعنی ثبت‌نام جاری (هنوز نمره‌نخورده) در ترمی که فیلتر ترم انتخاب
    // کرده، به‌علاوهٔ حداقل دو مردودی نهایی از **کل سابقه** (نه فقط همان ترم)؛
    // شمارش سابقه در LATERAL انجام می‌شود تا فیلتر ترم فقط «اخذِ جاری» را محدود کند.
    case 'third-attempt': {
      const from = sql`FROM enrollments ce
        JOIN course_offerings o ON o.id = ce."offeringId"
        JOIN courses c ON c.id = o."courseId"
        JOIN academic_terms t ON t.id = o."termId"
        JOIN students s ON s.id = ce."studentId"
        JOIN users u ON u.id = s."userId"
        LEFT JOIN majors m ON m.id = s."majorId"
        LEFT JOIN degree_level_configs d ON d.id = s."degreeLevelId"
        JOIN LATERAL (
          SELECT COUNT(*) FILTER (WHERE e."status" <> 'DROPPED')::int AS total_attempts,
            COUNT(*) FILTER (WHERE e."gradeStatus" = 'FINALIZED' AND ${NUM} AND e."gradeValue"::numeric < 10)::int AS failed_count,
            (ARRAY_AGG(e."gradeValue" ORDER BY t2."sortOrder" DESC NULLS LAST, t2."termCode" DESC, o2.id DESC)
              FILTER (WHERE e."gradeStatus" = 'FINALIZED' AND ${NUM}))[1] AS last_grade
          FROM enrollments e
            JOIN course_offerings o2 ON o2.id = e."offeringId"
            JOIN academic_terms t2 ON t2.id = o2."termId"
          WHERE e."studentId" = ce."studentId" AND o2."courseId" = o."courseId"
        ) h ON h.failed_count >= 2`;
      const cols = sql`s."studentCode" AS code, u."firstName" || ' ' || u."lastName" AS name,
        m.name AS major, d.title AS degree, s."entryYear" AS y,
        c.code AS course_code, c.title AS course_title,
        h.total_attempts, h.failed_count, t."termCode" AS current_term, h.last_grade`;
      const r = await paged(
        [
          { key: 'code', title: 'شماره دانشجویی' }, { key: 'name', title: 'نام' },
          { key: 'major', title: 'رشته' }, { key: 'degree', title: 'مقطع' },
          { key: 'y', title: 'ورودی' }, { key: 'course_code', title: 'کد درس' },
          { key: 'course_title', title: 'نام درس' }, { key: 'total_attempts', title: 'تکل تلاش' },
          { key: 'failed_count', title: 'تکرار مردودی' }, { key: 'current_term', title: 'ترم جاری' },
          { key: 'last_grade', title: 'آخرین نمره' },
        ],
        from,
        [
          sql`s.status = 'ACTIVE'`,
          sql`ce."status" IN ('REGISTERED', 'PENDING_COUNCIL', 'WAITLISTED')`,
          ...(term ? [sql`t."termCode" = ${term}`] : []),
          ...studentWhere(f),
        ],
        cols,
        sql`ORDER BY failed_count DESC, last_grade ASC NULLS LAST`,
        f,
        sql`s."studentCode", u."firstName", u."lastName", m.name, d.title, s."entryYear", c.code, c.title, t."termCode", h.total_attempts, h.failed_count, h.last_grade`,
      );
      r.summary = `${r.total.toLocaleString('fa-IR')} درس بار سوم (مردودی از کل سابقه) — ${term ? `اخذ در ترم ${term}` : 'اخذ در همه ترم‌ها'}`;
      return r;
    }

    // ── دانش‌آموختگان / ورودی‌ها / عدم مراجعه / انتقالی / میهمان ──
    case 'graduates':
      return studentListReport(
        [
          { key: 'code', title: 'شماره دانشجویی' }, { key: 'name', title: 'نام' },
          { key: 'nc', title: 'کد ملی' }, { key: 'major', title: 'رشته' },
          { key: 'degree', title: 'مقطع' }, { key: 'y', title: 'ورودی' },
        ],
        [sql`s.status = 'GRADUATED'`], f,
      );
    case 'entries': {
      const years = await db.execute<{ y: number }>(sql`SELECT DISTINCT "entryYear" AS y FROM students WHERE ("universityId" = ${f.universityId} OR "universityId" IS NULL) ORDER BY 1 DESC LIMIT 1`);
      const y = f.entryYear || Number(years.rows[0]?.y ?? 0);
      const r = await studentListReport(
        [
          { key: 'code', title: 'شماره دانشجویی' }, { key: 'name', title: 'نام' },
          { key: 'major', title: 'رشته' }, { key: 'degree', title: 'مقطع' }, { key: 'st', title: 'وضعیت' },
        ],
        [sql`s."entryYear" = ${y}`], f,
      );
      r.summary = `ورودی ${y} — ${r.total.toLocaleString('fa-IR')} نفر`;
      return r;
    }
    case 'noshow':
      return studentListReport(
        [
          { key: 'code', title: 'شماره دانشجویی' }, { key: 'name', title: 'نام' },
          { key: 'nc', title: 'کد ملی' }, { key: 'major', title: 'رشته' },
          { key: 'degree', title: 'مقطع' }, { key: 'y', title: 'ورودی' },
        ],
        [sql`s.status = 'NO_SHOW'`], f,
      );
    case 'transfers': {
      // Get transfer/guest students with the term they attended as guest/transfer
      const data = await db.execute<Record<string, unknown>>(sql`
        SELECT s."studentCode" AS code, u."firstName" || ' ' || u."lastName" AS name,
          u."nationalCode" AS nc, m.name AS major, d.title AS degree, s."entryYear" AS y,
          s.status AS st,
          sts."termCode" AS guest_transfer_term,
          sts."statusTitle" AS guest_transfer_status
        FROM students s JOIN users u ON u.id = s."userId"
          LEFT JOIN majors m ON m.id = s."majorId"
          LEFT JOIN degree_level_configs d ON d.id = s."degreeLevelId"
          LEFT JOIN student_term_states sts ON sts."studentId" = s.id
            AND (sts."normalizedStatusTitle" ILIKE '%میهمان%' OR sts."normalizedStatusTitle" ILIKE '%انتقال%' OR sts."statusTitle" ILIKE '%میهمان%' OR sts."statusTitle" ILIKE '%انتقال%')
        WHERE s.status IN ('TRANSFERRED', 'GUEST') AND ${sql.join(studentWhere(f), sql` AND `)}
        ORDER BY s."studentCode"`);
      const total = data.rows.length;
      return {
        columns: [
          { key: 'code', title: 'شماره دانشجویی' }, { key: 'name', title: 'نام' },
          { key: 'nc', title: 'کد ملی' }, { key: 'major', title: 'رشته' },
          { key: 'degree', title: 'مقطع' }, { key: 'y', title: 'ورودی' },
          { key: 'st', title: 'وضعیت کلی' }, { key: 'guest_transfer_term', title: 'ترم میهمانی/انتقال' },
          { key: 'guest_transfer_status', title: 'وضعیت ترم' },
        ],
        rows: data.rows.map(x => ({ ...x, st: faStatus(x.st) })),
        total, page: 1, per: total || 1, totalPages: 1,
        summary: `${total.toLocaleString('fa-IR')} دانشجو میهمان/انتقالی`,
      };
    }

    // ── گزارش شهریه / تراکنش‌های مالی ترم ──
    // 🔒 واژگان کانونی دفتر کل (ledger-balance.ts): این گزارش پیش‌تر روی نوع
    //    تراکنشِ **ناموجود** 'DEBIT' ساخته شده بود (در CHECK دیتابیس نیست) ⇒
    //    ستون بستانکار همیشه ۰ و «مانده» بی‌معنا/معکوس می‌شد.
    case 'tuition': {
      const termCond = term ? sql`AND t."termCode" = ${term}` : sql``;
      const studentConds = sql.join(studentWhere(f), sql` AND `);
      const debtIn = sql`sl."transactionType" IN (${sql.join(DEBT_LEDGER_TYPES.map(t => sql`${t}`), sql`, `)})`;
      const creditIn = sql`sl."transactionType" IN (${sql.join(CREDIT_LEDGER_TYPES.map(t => sql`${t}`), sql`, `)})`;
      const data = await db.execute<Record<string, unknown>>(sql`
        SELECT s."studentCode" AS code, u."firstName" || ' ' || u."lastName" AS name,
          m.name AS major, d.title AS degree,
          COALESCE(SUM(CASE WHEN ${debtIn} THEN sl.amount ELSE 0 END), 0)::int AS debt,
          COALESCE(SUM(CASE WHEN ${creditIn} THEN sl.amount ELSE 0 END), 0)::int AS credit,
          (COALESCE(SUM(CASE WHEN ${debtIn} THEN sl.amount ELSE 0 END), 0)
            - COALESCE(SUM(CASE WHEN ${creditIn} THEN sl.amount ELSE 0 END), 0))::int AS balance,
          COUNT(sl.id)::int AS txCount
        FROM students s JOIN users u ON u.id = s."userId"
          LEFT JOIN majors m ON m.id = s."majorId"
          LEFT JOIN degree_level_configs d ON d.id = s."degreeLevelId"
          LEFT JOIN student_ledger sl ON sl."studentId" = s.id
          LEFT JOIN academic_terms t ON t.id = sl."termId"
        WHERE s.status = 'ACTIVE' AND ${studentConds} ${termCond}
        GROUP BY s."studentCode", u."firstName", u."lastName", m.name, d.title
        ORDER BY balance DESC`);
      const total = data.rows.length;
      const totalDebt = data.rows.reduce((a, x) => a + Number(x.debt), 0);
      const totalCredit = data.rows.reduce((a, x) => a + Number(x.credit), 0);
      return {
        columns: [
          { key: 'code', title: 'شماره دانشجویی' }, { key: 'name', title: 'نام' },
          { key: 'major', title: 'رشته' }, { key: 'degree', title: 'مقطع' },
          { key: 'debt', title: 'بدهی (ریال)' }, { key: 'credit', title: 'اعتبار (ریال)' },
          { key: 'balance', title: 'مانده (ریال)' }, { key: 'txCount', title: 'تراکنش' },
        ],
        rows: data.rows, total, page: 1, per: total || 1, totalPages: 1,
        summary: `جمع بدهی: ${totalDebt.toLocaleString('fa-IR')} ریال — جمع اعتبار: ${totalCredit.toLocaleString('fa-IR')} ریال (بر پایهٔ واژگان کانونی دفتر کل)`,
      };
    }

    // ── گزارش پاسخ‌های طرح پایش ──
    case 'payesh': {
      const uniCond = f.universityId ? sql`AND o."universityId" = ${f.universityId}` : sql``;
      const termCond = term ? sql`AND t."termCode" = ${term}` : sql``;
      const data = await db.execute<Record<string, unknown>>(sql`
        SELECT f.id AS fid, f.title AS form_title,
          q.id AS qid, q.text AS question,
          COUNT(r.id)::int AS responses,
          CASE WHEN q.type = 'SCALE' THEN ROUND(AVG(CASE WHEN qo.value IS NOT NULL THEN qo.value END), 1)::text ELSE NULL END AS avg_score
        FROM evaluation_periods p
          JOIN evaluation_forms f ON f."periodId" = p.id
          JOIN evaluation_questions q ON q."formId" = f.id
          LEFT JOIN question_options qo ON qo."questionId" = q.id
          LEFT JOIN evaluation_responses r ON r."questionId" = q.id AND r."selectedOptionId" = qo.id
          LEFT JOIN course_offerings o ON o.id = r."offeringId"
          LEFT JOIN academic_terms t ON t.id = o."termId"
        WHERE 1=1 ${termCond} ${uniCond}
        GROUP BY f.id, f.title, q.id, q.text, q.type
        ORDER BY f.id, q.id`);
      const total = data.rows.length;
      return {
        columns: [
          { key: 'form_title', title: 'فرم' }, { key: 'question', title: 'سؤال' },
          { key: 'responses', title: 'پاسخ‌ها' }, { key: 'avg_score', title: 'میانگین نمره' },
        ],
        rows: data.rows, total, page: 1, per: total || 1, totalPages: 1,
        summary: `${total.toLocaleString('fa-IR')} سؤال پایش`,
      };
    }

    // ── دانشجویان واجد شرایط آزمون جامع ──
    case 'jame': {
      const data = await db.execute<Record<string, unknown>>(sql`
        SELECT s."studentCode" AS code, u."firstName" || ' ' || u."lastName" AS name,
          m.name AS major, d.title AS degree, s."entryYear" AS y,
          COUNT(DISTINCT e."offeringId")::int AS courses_passed,
          ROUND(AVG(CASE WHEN e."gradeStatus" = 'FINALIZED' AND e."gradeValue"::text ~ '^[0-9]+(\\.[0-9]+)?$' THEN e."gradeValue"::numeric END), 2) AS avg
        FROM students s JOIN users u ON u.id = s."userId"
          LEFT JOIN majors m ON m.id = s."majorId"
          LEFT JOIN degree_level_configs d ON d.id = s."degreeLevelId"
          LEFT JOIN enrollments e ON e."studentId" = s.id AND e."gradeStatus" = 'FINALIZED' AND e."gradeValue"::text ~ '^[0-9]+(\\.[0-9]+)?$' AND e."gradeValue"::numeric >= 12
        WHERE s.status = 'ACTIVE' AND ${sql.join(studentWhere(f), sql` AND `)}
        GROUP BY s."studentCode", u."firstName", u."lastName", m.name, d.title, s."entryYear"
        HAVING COUNT(DISTINCT e."offeringId") >= 10
        ORDER BY avg DESC`);
      const total = data.rows.length;
      return {
        columns: [
          { key: 'code', title: 'شماره دانشجویی' }, { key: 'name', title: 'نام' },
          { key: 'major', title: 'رشته' }, { key: 'degree', title: 'مقطع' },
          { key: 'y', title: 'ورودی' }, { key: 'courses_passed', title: 'درس قبول' },
          { key: 'avg', title: 'میانگین' },
        ],
        rows: data.rows, total, page: 1, per: total || 1, totalPages: 1,
        summary: `${total.toLocaleString('fa-IR')} دانشجو واجد شرایط جامع`,
      };
    }

    // ── مدارک دانشجو ──
    case 'docs': {
      const data = await db.execute<Record<string, unknown>>(sql`
        SELECT s."studentCode" AS code, u."firstName" || ' ' || u."lastName" AS name,
          m.name AS major, d.title AS degree, s.status AS st,
          COUNT(sd.id)::int AS doc_count,
          COUNT(DISTINCT sd."categoryId")::int AS cat_count
        FROM students s JOIN users u ON u.id = s."userId"
          LEFT JOIN majors m ON m.id = s."majorId"
          LEFT JOIN degree_level_configs d ON d.id = s."degreeLevelId"
          LEFT JOIN student_documents sd ON sd."personUserId" = u.id
        WHERE s.status = 'ACTIVE' AND ${sql.join(studentWhere(f), sql` AND `)}
        GROUP BY s."studentCode", u."firstName", u."lastName", m.name, d.title, s.status
        ORDER BY doc_count ASC`);
      const total = data.rows.length;
      const noDoc = data.rows.filter(r => Number(r.doc_count) === 0).length;
      return {
        columns: [
          { key: 'code', title: 'شماره دانشجویی' }, { key: 'name', title: 'نام' },
          { key: 'major', title: 'رشته' }, { key: 'degree', title: 'مقطع' },
          { key: 'doc_count', title: 'تعداد مدرک' }, { key: 'cat_count', title: 'دسته مدرک' },
        ],
        rows: data.rows, total, page: 1, per: total || 1, totalPages: 1,
        summary: `${total.toLocaleString('fa-IR')} پرونده فعال — ${noDoc.toLocaleString('fa-IR')} بدون مدرک`,
      };
    }

    default: {
      // واگذاری به ماژول‌های خانواده‌ها (r-*.ts) — اولین پاسخی که null نیست
      const delegated =
        (await runClass(kind, f)) ??
        (await runCouncilLetters(kind, f)) ??
        (await runEduProbation(kind, f)) ??
        (await runEduRoster(kind, f)) ??
        (await runEduSchedule(kind, f)) ??
        (await runExam(kind, f)) ??
        (await runFinance(kind, f)) ??
        (await runStaff(kind, f)) ??
        (await runProfClass(kind, f)) ??
        (await runStatusOps(kind, f)) ??
        (await runThesis(kind, f)) ??
        (await runCollect(kind, f));
      if (delegated) return delegated;
      return { columns: [], rows: [], total: 0, page: 1, per: PER, totalPages: 1 };
    }
  }
  } catch (e: unknown) {
    // لاگ تشخیصی سمت سرور — استک کامل برای ریشه‌یابی خطاهای نامرئی کلاینت
    console.error(`[runReport:${kind}]`, e instanceof Error ? e.message : String(e));
    throw e;
  }
}

/** خروجی CSV — ورق‌زدن همه صفحات تا سقف ۵۰۰۰ ردیف */
export async function exportReport(kind: string, f: ReportFilters): Promise<{ header: string[]; lines: string[][] }> {
  await requireRole(ROLES);
  await assertReportPermission(kind);
  const uni = await getCurrentUniversity().catch(() => null);
  // 🔒 همان گارد fail-closed مسیر جدول؛ وگرنه خروجی CSV می‌توانست دادهٔ
  //    همهٔ دانشگاه‌ها را برگرداند (در مسیر خروجی مقدار جانشین falsy می‌شد و
  //    شرط‌های دانشگاه کلاً حذف می‌شدند).
  if (!isRealUniversityId(uni?.id)) return { header: [], lines: [] };
  f = { ...f, universityId: uni.id };
  const first = await runReport(kind, { ...f, page: 1 });
  const all = [...first.rows];
  for (let p = 2; p <= first.totalPages && all.length < 5000; p++) {
    const r = await runReport(kind, { ...f, page: p });
    all.push(...r.rows);
  }
  // گارد تزریق فرمول سمت سرور (مصرف‌کنندهٔ دیگری لازم نیست دوباره پیاده کند)
  const esc = (v: string) => (/^[=+\-@|\t\r]/.test(v.trimStart()) ? `'${v}` : v);
  return {
    header: first.columns.map(c => esc(c.title)),
    lines: all.slice(0, 5000).map(row => first.columns.map(c => esc(formatReportCell(row[c.key], c.format)))),
  };
}
