import Link from 'next/link';
import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { academic_terms, course_offerings, courses, departments, enrollments, tuition_term_tariff } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { getCurrentUniversity } from '@/lib/university-scope';
import { MALI_TYPE_LABELS, MALI_TYPE_NON_CHARGING, maliTypeLabel } from '@/lib/mali-types';
import MaliTypeSelect from './MaliTypeSelect';

export const dynamic = 'force-dynamic';

const ROLES = ['ADMIN', 'EDU_EXPERT', 'FINANCE_EXPERT', 'FINANCE'];
const PAGE_SIZE = 300;
const fa = (n: number | string | null | undefined) => Number(n ?? 0).toLocaleString('fa-IR');

/**
 * «نوع درس مالی دروس» — ابزار کارشناس آموزش و مدیر مالی.
 *
 * چرا این صفحه لازم شد: موتور شهریهٔ متغیر آفاق مبلغ هر درس را از
 * `courses."legacyMaliType"` می‌سازد و هر درسی که این فیلد را نداشته باشد
 * **صفر** حساب می‌شود (عیناً مثل سند رسمی سما). این فیلد تا امروز هیچ جای UI
 * نداشت؛ نتیجه‌اش این بود که چند درس تازه‌تعریف‌شده بی‌صدا شهریه‌شان صفر
 * می‌ماند. اینجا هم وضعیت فعلی دیده می‌شود و هم قابل اصلاح است.
 */
export default async function CourseFinancePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; only?: string }>;
}) {
  await requireRole(ROLES);

  const uni = await getCurrentUniversity().catch(() => null);
  if (!uni || !(uni.id > 0)) {
    return <div className="p-6 text-sm text-rose-700">دانشگاه فعال مشخص نیست.</div>;
  }

  const sp = await searchParams;
  const q = String(sp?.q ?? '').trim();
  // پیش‌فرض روی «فقط تعیین‌نشده‌ها» است: این صفحه یک صفِ کار است، نه فهرست کامل.
  const onlyMissing = sp?.only !== 'all';

  // ── ترم جاری (برای سنجش اثر واقعی روی شهریه) ──
  const [term] = await db
    .select({ id: academic_terms.id, termCode: academic_terms.termCode, title: academic_terms.title })
    .from(academic_terms)
    .where(and(eq(academic_terms.universityId, uni.id), eq(academic_terms.isCurrent, 1)))
    .orderBy(desc(academic_terms.termCode))
    .limit(1);

  // ── سال تعرفهٔ جاری: ۴ رقم اول کد ترم ──
  const termYear = term ? Number(String(term.termCode).slice(0, 4)) : 0;

  // انواعی که در تعرفهٔ همین سال نرخ دارند (نرخ‌دار) — بقیه «بی‌نرخ»اند.
  const rateRows = termYear
    ? await db
        .select({
          maliType: tuition_term_tariff.maliType,
          minTh: sql<string>`min(${tuition_term_tariff.thPrice})`,
          maxTh: sql<string>`max(${tuition_term_tariff.thPrice})`,
        })
        .from(tuition_term_tariff)
        .where(and(
          eq(tuition_term_tariff.universityId, uni.id),
          eq(tuition_term_tariff.termYear, termYear),
        ))
        .groupBy(tuition_term_tariff.maliType)
    : [];
  const pricedTypes = new Set(rateRows.map((r) => Number(r.maliType)));
  const rateByType = new Map(rateRows.map((r) => [Number(r.maliType), r]));

  // ── شمارنده‌ها ──
  const [totals] = await db
    .select({
      all: count(),
      missing: sql<number>`count(*) filter (where ${courses.legacyMaliType} is null)`,
    })
    .from(courses)
    .where(eq(courses.universityId, uni.id));

  // ثبت‌نام‌های ترم جاری که روی دروسِ بی‌نوع نشسته‌اند — عددی که واقعاً پول است
  const [impact] = term
    ? await db
        .select({ n: count() })
        .from(enrollments)
        .innerJoin(course_offerings, eq(course_offerings.id, enrollments.offeringId))
        .innerJoin(courses, eq(courses.id, course_offerings.courseId))
        .where(and(
          eq(course_offerings.termId, term.id),
          isNull(courses.legacyMaliType),
          isNull(enrollments.sourceUniversityId),
        ))
    : [{ n: 0 }];

  // ── فهرست ──
  const conds = [eq(courses.universityId, uni.id)];
  if (onlyMissing) conds.push(isNull(courses.legacyMaliType));
  if (q) {
    const like = `%${q}%`;
    // کد درس عددی است؛ جست‌وجوی حرفی فقط روی عنوان معنا دارد
    const cond = /^\d+$/.test(q)
      ? or(ilike(courses.code, like), ilike(courses.title, like))
      : ilike(courses.title, like);
    if (cond) conds.push(cond);
  }

  const rows = await db
    .select({
      id: courses.id,
      code: courses.code,
      title: courses.title,
      units: courses.units,
      theo: courses.theoreticalUnits,
      prac: courses.practicalUnits,
      maliType: courses.legacyMaliType,
      courseType: courses.courseType,
      deptTitle: departments.name,
    })
    .from(courses)
    .leftJoin(departments, eq(departments.id, courses.departmentId))
    .where(and(...conds))
    .orderBy(asc(courses.code))
    .limit(PAGE_SIZE);

  // ثبت‌نام هر درس در ترم جاری (فقط برای ردیف‌های همین صفحه)
  const ids = rows.map((r) => r.id);
  const perCourse = new Map<number, number>();
  if (term && ids.length) {
    const regs = await db
      .select({ courseId: course_offerings.courseId, n: count() })
      .from(enrollments)
      .innerJoin(course_offerings, eq(course_offerings.id, enrollments.offeringId))
      .where(and(
        eq(course_offerings.termId, term.id),
        inArray(course_offerings.courseId, ids),
      ))
      .groupBy(course_offerings.courseId);
    for (const r of regs) perCourse.set(Number(r.courseId), Number(r.n));
  }

  const missingTotal = Number(totals?.missing ?? 0);
  const allTotal = Number(totals?.all ?? 0);

  return (
    <div className="space-y-4">
      <div className="card">
        <h1 className="text-lg font-extrabold">نوع درس مالی دروس</h1>
        <p className="mt-1 text-xs leading-6 text-slate-600">
          شهریهٔ متغیر هر درس در آفاق از همین فیلد ساخته می‌شود
          (<span dir="ltr" className="font-mono">واحد نظری × نرخ نظری + واحد عملی × نرخ عملی</span>).
          درسی که «نوع درس مالی» نداشته باشد <b className="text-rose-700">صفر</b> حساب می‌شود —
          دقیقاً همان رفتاری که سند رسمی سما دارد. پس هر ردیف تعیین‌نشده یعنی یک درس
          که بی‌صدا از صورت‌حساب دانشجو جا می‌ماند.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-4">
          <Stat label="کل دروس دانشگاه" value={fa(allTotal)} />
          <Stat label="بدون نوع مالی" value={fa(missingTotal)} tone={missingTotal ? 'rose' : 'ok'} />
          <Stat
            label={term ? `ثبت‌نام متأثر در ${term.termCode}` : 'ترم جاری'}
            value={fa(Number(impact?.n ?? 0))}
            tone={Number(impact?.n ?? 0) ? 'rose' : 'ok'}
          />
          <Stat label="سال تعرفه" value={termYear ? fa(termYear) : '—'} />
        </div>
      </div>

      <div className="card">
        <form className="flex flex-wrap items-end gap-2" action="/admin/course-finance">
          <label className="text-xs text-slate-500">
            جست‌وجو (کد یا عنوان)
            <input name="q" defaultValue={q} className="input mt-1 w-56" placeholder="مثلاً ۵۱۱۲۷ یا یادگیری" />
          </label>
          <label className="flex items-center gap-2 pb-2 text-xs text-slate-600">
            <input type="checkbox" name="only" value="all" defaultChecked={!onlyMissing} className="size-4" />
            نمایش همهٔ دروس (نه فقط تعیین‌نشده‌ها)
          </label>
          <button className="btn-primary !py-1.5">اعمال</button>
          {q && <Link href="/admin/course-finance" className="btn-ghost !py-1.5">پاک‌کردن</Link>}
        </form>
      </div>

      <div className="card">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold">
            {onlyMissing ? 'دروس تعیین‌نشده' : 'همهٔ دروس'} — {fa(rows.length)} ردیف
          </h2>
          {rows.length >= PAGE_SIZE && (
            <span className="text-2xs text-amber-700">
              فقط {fa(PAGE_SIZE)} ردیف اول نمایش داده شده؛ برای دیدن بقیه جست‌وجو کنید.
            </span>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead>
              <tr className="text-slate-500">
                <th className="p-2">کد</th>
                <th className="p-2">عنوان</th>
                <th className="p-2">گروه</th>
                <th className="p-2">واحد (ن/ع)</th>
                <th className="p-2">نوع درس مالی</th>
                <th className="p-2">نرخ واحد (نظری)</th>
                <th className="p-2">{term ? `ثبت‌نام ${term.termCode}` : 'ثبت‌نام'}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const mt = r.maliType == null ? null : Number(r.maliType);
                const rate = mt == null ? null : rateByType.get(mt);
                const defined = mt != null && pricedTypes.has(mt);
                const charging = defined && !MALI_TYPE_NON_CHARGING.has(mt);
                const regs = perCourse.get(Number(r.id)) ?? 0;
                return (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="p-2 font-mono" dir="ltr">{r.code}</td>
                    <td className="p-2">{r.title}</td>
                    <td className="p-2 text-slate-500">{r.deptTitle ?? '—'}</td>
                    <td className="p-2 font-mono text-slate-600" dir="ltr">
                      {Number(r.theo ?? 0)} / {Number(r.prac ?? 0)}
                    </td>
                    <td className="p-2">
                      <MaliTypeSelect courseId={Number(r.id)} value={mt} charging={charging} />
                    </td>
                    <td className="p-2">
                      {mt == null ? (
                        <span className="text-rose-700">—</span>
                      ) : !defined ? (
                        <span className="text-amber-700">در تعرفهٔ {fa(termYear)} نیست</span>
                      ) : (
                        <span className="font-mono text-slate-700" dir="ltr">
                          {fa(Number(rate?.minTh ?? 0))}
                          {Number(rate?.minTh) !== Number(rate?.maxTh) ? ' … ' + fa(Number(rate?.maxTh ?? 0)) : ''}
                        </span>
                      )}
                    </td>
                    <td className="p-2">
                      {regs > 0 ? (
                        <span className="rounded-md bg-rose-100 px-1.5 py-0.5 font-bold text-rose-800">{fa(regs)}</span>
                      ) : (
                        <span className="text-slate-400">۰</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-4 text-center text-slate-400">
                    {onlyMissing ? 'هیچ درس تعیین‌نشده‌ای نمانده است. 🎉' : 'درسی یافت نشد.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2 className="mb-2 font-bold">راهنمای انواع (نرخ‌های {termYear ? fa(termYear) : 'سال جاری'})</h2>
        <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(MALI_TYPE_LABELS).map(([k, label]) => {
            const n = Number(k);
            const rate = rateByType.get(n);
            const nonCharging = MALI_TYPE_NON_CHARGING.has(n);
            return (
              <div key={k} className="flex items-center justify-between rounded-lg border border-slate-200 px-2 py-1 text-2xs">
                <span>
                  <b className="font-mono">{k}</b> — {label}
                </span>
                <span className={nonCharging ? 'text-amber-700' : 'font-mono text-slate-600'} dir="ltr">
                  {rate ? fa(Number(rate.minTh)) + ' … ' + fa(Number(rate.maxTh)) : 'بی‌نرخ'}
                </span>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-2xs text-slate-500">
          انواع «بی‌نرخ» (۰، ۵، ۹، ۱۲، ۱۳، ۱۵) در سند رسمی سما هم نرخ ندارند؛ انتخابشان برای
          درس عادی به‌معنای صفر شدن شهریه است. فقط اگر مطمئنید درس نباید شهریه بگیرد از آن‌ها استفاده کنید.
        </p>
      </div>

      <p className="text-2xs text-slate-500">
        آخرین به‌روزرسانی فهرست انواع درس مالی از سما (LT7) در{' '}
        <span dir="ltr" className="font-mono">courses_bak_mali_20261023</span> پشتیبان‌گیری شده است.
        نمونهٔ برچسب فعلی برای کد ۳: <b>{maliTypeLabel(3)}</b>.
      </p>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'rose' | 'ok' }) {
  const cls =
    tone === 'rose'
      ? 'border-rose-200 bg-rose-50 text-rose-800'
      : tone === 'ok'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
        : 'border-slate-200 bg-slate-50 text-slate-800';
  return (
    <div className={`rounded-xl border px-3 py-2 ${cls}`}>
      <p className="text-3xs opacity-80">{label}</p>
      <p className="font-mono text-base font-bold" dir="ltr">{value}</p>
    </div>
  );
}
