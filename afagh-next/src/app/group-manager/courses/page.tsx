import { and, count, eq, or } from 'drizzle-orm';
import { db } from '@/db';
import { courses, departments } from '@/db/schema';
import { requireDepHead } from '@/lib/group-manager';
import { faSearchConds } from '@/lib/fa-list-query';
import { MALI_TYPE_OPTIONS, maliTypeLabel } from '@/lib/mali-types';
import { createCourseAction, deleteCourseAction, updateCourseAction } from './actions';
import PanelHero from '@/components/PanelHero';

export const dynamic = 'force-dynamic';

const TYPE_OPTS = ['عمومی', 'پایه', 'اصلی', 'تخصصی', 'اختیاری', 'جبرانی', 'کارورزی', 'پروژه', 'پایان‌نامه', 'کارگاهی'];

/**
 * سقف ردیف‌های جدول. پیش‌تر کل دروسِ گروه (هر چند تا که بود) در RSC به
 * کلاینت می‌رفت و هر ردیف ۹ ورودیِ قابل‌ویرایش داشت ⇒ صفحه روی خطوط
 * کم‌سرعت سنگین می‌شد. حالا سرور فیلتر + سقف می‌گذارد و کاربر برای بقیه
 * جست‌وجو می‌کند.
 */
const LIST_CAP = 100;

export default async function CoursesPage({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string; q?: string }> }) {
  const sp = await searchParams;
  const { staff: me, deptId } = await requireDepHead();
  const [dept] = await db.select().from(departments).where(eq(departments.id, deptId)).limit(1);

  // ── جست‌وجوی سمتِ سرور (کد یا عنوان درس) + سقف ردیف ──
  const q = (sp.q ?? '').trim();
  const searchConds = faSearchConds(q, [courses.code, courses.title]);
  const where = and(
    eq(courses.departmentId, deptId),
    searchConds.length ? or(...searchConds) : undefined,
  );

  const [rows, totalRow] = await Promise.all([
    db.select().from(courses).where(where).orderBy(courses.code).limit(LIST_CAP),
    db.select({ n: count() }).from(courses).where(where),
  ]);
  const total = Number(totalRow[0]?.n ?? 0);

  return (
    <div className="space-y-4">
      {/* ── ویترینِ صفحهٔ اولِ کارتابل مدیر گروه ──
          `/group-manager` به همین صفحه هدایت می‌شود، پس این نخستین چیزی است که
          مدیر گروه می‌بیند؛ پیش‌تر صفحه مستقیم با فرمِ «تعریف درس جدید» شروع
          می‌شد و هیچ سربرگ/زمینه‌ای نداشت. */}
      <PanelHero
        tone="teal"
        icon="🗂️"
        eyebrow="کارتابل مدیر گروه"
        title={`دروس گروه ${dept?.name ?? ''}`.trim()}
        subtitle="تعریف و ویرایش دروسِ گروه؛ ارائه‌های ترم، برنامه‌ریزی درسی و معادل‌سازی از نوارِ بالا در دسترس است."
        stats={[{ label: 'درس ثبت‌شده', value: total.toLocaleString('fa-IR') }]}
      />

      {sp.msg && <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">✓ {sp.msg}</p>}
      {sp.err && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800">⛔ {sp.err}</p>}

      <div className="card space-y-3">
        <h2 className="font-bold">تعریف درس جدید — گروه {dept?.name ?? deptId}</h2>
        {/*
          ⚠ چیدمان صریح (نه `grid-cols-7` با ۹ فرزند): پیش‌تر ۹ فیلد در ۷ ستون
          می‌ریختند و دو ردیفِ آخر (نمره‌دهی/معدل/دکمه) به‌هم‌ریخته می‌شدند.
          دو ردیفِ ۶ستونیِ عمدی: ۱+۲+۱+۱+۱ و ۲+۲+۱+۱ = ۶.
        */}
        <form action={createCourseAction} className="grid items-end gap-3 grid-cols-2 md:grid-cols-6">
          <label className="text-xs text-slate-500">کد<input name="code" required className="input mt-1" dir="ltr" placeholder="مثلاً 5122305" /></label>
          <label className="text-xs text-slate-500 md:col-span-2">عنوان<input name="title" required className="input mt-1" placeholder="مثلاً یادگیری ماشین" /></label>
          <label className="text-xs text-slate-500">تئوری<input name="theo" type="number" min={0} step="0.25" defaultValue={3} className="input mt-1" dir="ltr" /></label>
          <label className="text-xs text-slate-500">عملی<input name="prac" type="number" min={0} step="0.25" defaultValue={0} className="input mt-1" dir="ltr" /></label>
          <label className="text-xs text-slate-500">نوع
            <select name="type" className="input mt-1">{TYPE_OPTS.map(t => <option key={t}>{t}</option>)}</select>
          </label>
          <label className="text-xs text-slate-500 md:col-span-2">نوع درس مالی
            <select name="maliType" required defaultValue="" className="input mt-1">
              <option value="" disabled>— انتخاب —</option>
              {MALI_TYPE_OPTIONS.map(o => (
                <option key={o.value} value={String(o.value)}>{o.value} — {o.label}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-500 md:col-span-2">نمره‌دهی
            <select name="grading" className="input mt-1"><option value="NUMERIC">عددی</option><option value="PASS_FAIL">قبول/رد</option></select>
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-500 md:col-span-1">موثر بر معدل<input type="checkbox" name="gpa" defaultChecked className="size-4" /></label>
          <button className="btn-primary md:col-span-1">افزودن درس</button>
        </form>
      </div>

      <div className="card">
        {/* ── جست‌وجوی سمتِ سرور ──
            فرم GET است تا آدرس صفحه (و در نتیجه «بازگشت» و «تازه‌سازی») جست‌وجو را
            از دست ندهد. بدون این جست‌وجو، ردیف‌های بعد از سقف اصلاً قابل دسترسی
            نبودند. */}
        <form method="GET" className="mb-3 flex flex-wrap items-end gap-2">
          <label className="min-w-52 flex-1 text-xs text-slate-500">
            جست‌وجوی درس (کد یا عنوان)
            <input name="q" defaultValue={q} placeholder="مثلاً 5122305 یا یادگیری ماشین" className="input mt-1" />
          </label>
          <button type="submit" className="btn-primary">جست‌وجو</button>
          {q && (
            <a href="/group-manager/courses" className="btn-ghost">پاک‌کردن جست‌وجو</a>
          )}
        </form>

        <h2 className="mb-2 font-bold">دروس گروه ({total.toLocaleString('fa-IR')})</h2>
        {rows.length < total && (
          <p className="mb-2 text-2xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
            نمایش {rows.length.toLocaleString('fa-IR')} از {total.toLocaleString('fa-IR')} درس — برای دیدن بقیه جست‌وجو کنید.
          </p>
        )}
        <div className="overflow-x-auto">
          {/*
            ⚠ ساختار ردیف‌ها اصلاح شد. پیش‌تر کل فرم ویرایش در یک
            `<td colSpan={8}>` بود و دو `<td>` دیگر هم بعدش می‌آمد ⇒ هر ردیف
            ۱۰ ستون در برابر ۹ ستونِ سرصفحه. نتیجه: `flex-wrap` داخل آن خانهٔ
            پهن، فیلدها را روی چند خط می‌ریخت و برچسب‌ها/ورودی‌ها از ستون‌های
            سرصفحه جدا می‌افتادند («پنل تعریف درس به‌هم‌ریخته»).
            حالا هر ردیف دقیقاً ۹ خانه دارد و هر ورودی در خانهٔ ستونِ خودش است.
            چون یک `<form>` نمی‌تواند چند `<td>` را در بر بگیرد، فیلدها با
            ویژگی HTML5 `form={...}` به فرمِ همان ردیف وصل می‌شوند (ارسال
            FormData همان است، بدون جاوااسکریپت هم کار می‌کند).
          */}
          <table className="w-full text-right text-xs rt">
            <thead>
              <tr className="text-slate-500">
                <th className="p-2">کد</th><th className="p-2">عنوان</th><th className="p-2">تئوری</th>
                <th className="p-2">عملی</th><th className="p-2">نوع</th><th className="p-2">نمره‌دهی</th>
                <th className="p-2">معدل</th><th className="p-2">نوع مالی</th><th className="p-2">اقدام</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(c => {
                const formId = `course-update-${c.id}`;
                return (
                  <tr key={c.id} className="border-t border-slate-100 align-middle">
                    <td className="p-1">
                      <input form={formId} name="code" defaultValue={c.code} className="input !py-1 !px-2 w-24" dir="ltr" aria-label="کد درس" />
                    </td>
                    <td className="p-1">
                      <input form={formId} name="title" defaultValue={c.title} className="input !py-1 !px-2 w-full min-w-40" aria-label="عنوان درس" />
                    </td>
                    <td className="p-1">
                      <input form={formId} name="theo" type="number" min={0} step="0.25" defaultValue={Number(c.theoreticalUnits ?? 0)} className="input !py-1 !px-2 w-16" dir="ltr" aria-label="واحد تئوری" />
                    </td>
                    <td className="p-1">
                      <input form={formId} name="prac" type="number" min={0} step="0.25" defaultValue={Number(c.practicalUnits ?? 0)} className="input !py-1 !px-2 w-16" dir="ltr" aria-label="واحد عملی" />
                    </td>
                    <td className="p-1">
                      <select form={formId} name="type" defaultValue={TYPE_OPTS.includes(c.courseType ?? '') ? c.courseType as string : 'تخصصی'} className="input !py-1 !px-2" aria-label="نوع درس">
                        {(TYPE_OPTS.includes(c.courseType ?? '') ? TYPE_OPTS : [c.courseType as string, ...TYPE_OPTS]).map(t => <option key={t}>{t}</option>)}
                      </select>
                    </td>
                    <td className="p-1">
                      <select form={formId} name="grading" defaultValue={c.gradingType ?? 'NUMERIC'} className="input !py-1 !px-2" aria-label="نوع نمره‌دهی">
                        <option value="NUMERIC">عددی</option>
                        <option value="PASS_FAIL">قبول/رد</option>
                        {c.gradingType && !['NUMERIC', 'PASS_FAIL'].includes(c.gradingType) && <option value={c.gradingType}>{c.gradingType}</option>}
                      </select>
                    </td>
                    <td className="p-1">
                      <label className="flex items-center justify-center gap-1 text-slate-500">
                        <input form={formId} type="checkbox" name="gpa" defaultChecked={!!c.affectsGpa} className="size-4" aria-label="موثر بر معدل" />
                      </label>
                    </td>
                    <td className="p-1">
                      <span
                        title="تغییر این مقدار با کارشناس آموزش / مدیر مالی است"
                        className={`inline-block rounded-md px-1.5 py-0.5 text-2xs ${c.legacyMaliType == null ? 'bg-rose-100 text-rose-800 font-bold' : 'bg-slate-100 text-slate-700'}`}
                      >
                        {c.legacyMaliType == null ? 'تعیین‌نشده' : `${c.legacyMaliType} — ${maliTypeLabel(c.legacyMaliType)}`}
                      </span>
                    </td>
                    <td className="p-1">
                      {/* دو فرمِ خواهر (نه تودرتو): ذخیرهٔ ویرایش و حذف */}
                      <div className="flex items-center gap-2 whitespace-nowrap">
                        <form id={formId} action={updateCourseAction}>
                          <input type="hidden" name="id" value={c.id} />
                          <button className="btn-ghost !py-1 !px-2">ذخیره</button>
                        </form>
                        <form action={deleteCourseAction}>
                          <input type="hidden" name="id" value={c.id} />
                          <button className="text-red-600 hover:underline">حذف</button>
                        </form>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="p-3 text-center text-slate-400">
                    {q ? 'درسی با این عبارت پیدا نشد.' : 'درسی تعریف نشده است.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
