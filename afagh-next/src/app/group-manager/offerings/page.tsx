import type { ReactNode } from 'react';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { db } from '@/db';
import { academic_terms, classrooms, course_offerings, courses, degree_level_configs, majors, offering_professors, schedules, staff, users } from '@/db/schema';
import { requireDepHead } from '@/lib/group-manager';
import { faIncludes } from '@/lib/persian-search';
import { targetingLabel } from '@/lib/offering-targeting';
import { getBool } from '@/lib/settings';
import { addScheduleAction, createOfferingAction, deactivateOfferingAction, deleteScheduleAction, updateOfferingAction } from './actions';

export const dynamic = 'force-dynamic';
const DAYS = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];
const hm = (t: string | null) => (t ? String(t).slice(0, 5) : '');

/**
 * سقف ارائه‌هایی که در یک نوبت به کلاینت می‌روند.
 *
 * چرا؟ هر کارتِ ارائه دو فرمِ ۱۲ستونی دارد (ویرایش + هدف‌گیری) و سه
 * `<select>` با فهرست‌های طولانی (استاد / مقطع / رشته). پیش‌تر *همهٔ* ارائه‌های
 * ترم گروه می‌آمد ⇒ ده‌ها کارت × ده‌ها `<option>` ⇒ payload چند صد کیلوبایتی
 * و صفحه‌ای که روی خطوط کم‌سرعت اصلاً بالا نمی‌آمد. حالا سرور فیلتر و سقف
 * می‌گذارد و برای بقیه جست‌وجو می‌کنیم.
 */
const OFFERING_CAP = 25;

/**
 * سلولِ برچسب‌دارِ گرید — یک برچسب کوچک بالای فیلد، خودِ فیلد تمام‌عرضِ خانه.
 *
 * چرا این‌طور بازنویسی شد: پیش‌تر فیلدها در یک `flex flex-wrap` بودند و
 * `.input` هم `w-full` دارد، پس هر فیلد تمام‌عرض می‌شد و `flex-wrap` آن‌ها را
 * یکی‌یکی در سطر جدا می‌ریخت (فرمِ ۹ فیلدی = ۹ سطر). عرضِ گرید جای عرضِ
 * ثابت را می‌گیرد و `min-w-0` جلوی سرریزِ متنِ گزینه‌های بلند را می‌گیرد.
 */
const F = ({ label, span, children }: { label: string; span: string; children: ReactNode }) => (
  <label className={`flex min-w-0 flex-col gap-0.5 text-3xs leading-4 text-slate-500 ${span}`}>
    <span className="truncate">{label}</span>
    {children}
  </label>
);

const INPUT = 'input !py-1 !px-2 text-xs';

export default async function OfferingsPage({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string; q?: string }> }) {
  const sp = await searchParams;
  const { staff: me, deptId } = await requireDepHead();
  const [term] = await db.select().from(academic_terms).where(eq(academic_terms.isCurrent, 1)).limit(1);
  // آیا چارت تحصیلی در انتخاب واحد الزامی است؟ (تنظیم پنل مدیر)
  // وقتی خاموش باشد، هدف‌گیریِ هر ارائه (رشته/ورودی) تنها راه کنترل دسترسی است
  // و بنابراین تعیین آن‌ها در زمان ارائه الزامی می‌گردد.
  const requireChart = await getBool('ENROLL_REQUIRE_CURRICULUM_CHART').catch(() => true);

  const deptCourses = await db.select().from(courses).where(eq(courses.departmentId, deptId)).orderBy(courses.code);
  const courseById = new Map(deptCourses.map(c => [c.id, c]));

  const allOffs = term && courseById.size > 0
    ? await db.select().from(course_offerings)
        .where(and(
          eq(course_offerings.termId, term.id),
          eq(course_offerings.isActive, 1),
          inArray(course_offerings.courseId, [...courseById.keys()]),
        ))
        .limit(500)
    : [];

  /**
   * جست‌وجوی سمتِ سرور روی کد/عنوان درس و شمارهٔ گروه.
   * فهرستِ گروه محدود است (فقط ارائه‌های همین گروه)، پس فیلتر کردنش در
   * حافظهٔ سرور ارزان است — و نتیجه فقط ۲۵ ردیف است که به کلاینت می‌رود.
   */
  const q = (sp.q ?? '').trim();
  const mine = q
    ? allOffs.filter(o => {
        const c = courseById.get(o.courseId);
        if (!c) return false;
        return faIncludes(`${c.code} ${c.title} ${o.groupNumber}`, q);
      })
    : allOffs;
  const totalOffs = mine.length;
  const shown = mine.slice(0, OFFERING_CAP);
  const offIds = shown.map(o => o.id);

  const profs = await db.select({ id: staff.id, name: users.firstName, family: users.lastName, rank: staff.academicRank })
    .from(staff).innerJoin(users, eq(users.id, staff.userId)).where(eq(staff.departmentId, deptId));
  const profName = new Map(profs.map(p => [p.id, p.name + ' ' + p.family]));

  const scheds = offIds.length
    ? await db.select({ id: schedules.id, offeringId: schedules.offeringId, day: schedules.dayOfWeek, st: schedules.startTime, en: schedules.endTime, roomId: schedules.roomId, room: classrooms.name })
        .from(schedules).leftJoin(classrooms, eq(classrooms.id, schedules.roomId))
        .where(and(inArray(schedules.offeringId, offIds), eq(schedules.scheduleType, 'CLASS')))
    : [];

  // سالن‌های قابل انتخاب: همین دانشگاه یا سالن‌های عام/سیستمی (universityId NULL)
  // ⚠ این فهرست *یک‌بار* در صفحه رندر می‌شود (فرمِ مشترکِ «افزودن جلسه»)، نه
  // یک‌بار به‌ازای هر ارائه — پیش‌تر همین فهرست در هر کارت تکرار می‌شد.
  const rooms = me.universityId == null
    ? await db.select().from(classrooms).where(isNull(classrooms.universityId)).orderBy(classrooms.name)
    : await db.select().from(classrooms)
        .where(or(eq(classrooms.universityId, me.universityId), isNull(classrooms.universityId)))
        .orderBy(classrooms.name);
  const degrees = await db.select().from(degree_level_configs);

  /**
   * رشته‌های قابل هدف‌گیری: فقط رشته‌های همین دانشگاه.
   * پیش‌تر `db.select().from(majors)` *بدونِ هیچ فیلتری* بود ⇒ همهٔ رشته‌های
   * کشور در `<select>`ِ هر ارائه تکرار می‌شد (صدها `<option>` در هر ردیف!).
   * رشته‌هایی که ارائه‌های بارگذاری‌شده به آن‌ها هدف زده‌اند جداگانه خوانده
   * می‌شوند تا نامشان در نمایش گم نشود.
   */
  const majorSelectRows = me.universityId == null
    ? await db.select({ id: majors.id, name: majors.name }).from(majors).orderBy(majors.name)
    : await db.select({ id: majors.id, name: majors.name }).from(majors)
        .where(or(eq(majors.universityId, me.universityId), isNull(majors.universityId)))
        .orderBy(majors.name);

  const targetMajorIds = [...new Set(shown.map(o => o.targetMajorId).filter((x): x is number => x != null))];
  const extraMajors = targetMajorIds.length
    ? await db.select({ id: majors.id, name: majors.name }).from(majors).where(inArray(majors.id, targetMajorIds))
    : [];
  const majorNameById = new Map<number, string>();
  for (const m of majorSelectRows) majorNameById.set(m.id, m.name);
  for (const m of extraMajors) majorNameById.set(m.id, m.name);

  const degTitle = (id: number) => degrees.find(d => d.id === id)?.title ?? String(id);
  const majorTitle = (id: number) => majorNameById.get(id) ?? String(id);
  void offering_professors;

  /**
   * چهار سلولِ «هدف‌گیری» — مجموعاً ۹ ستون از ۱۲ ستونِ گرید.
   * سه ستونِ باقی‌مانده برای دکمهٔ اقدام است، پس هر دو فرم (ایجاد/ویرایش)
   * دقیقاً دو ردیفِ ۱۲ستونی می‌شوند.
   */
  const TargetCells = (o: typeof mine[number] | null) => (
    <>
      <F label="مقطع مجاز" span="md:col-span-2">
        <select name="deg" defaultValue={o?.targetDegreeLevelId ?? ''} className={INPUT}>
          <option value="">همه</option>
          {degrees.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
        </select>
      </F>
      <F label={`رشتهٔ مجاز${requireChart ? '' : ' (الزامی)'}`} span="md:col-span-3">
        <select name="major" defaultValue={o?.targetMajorId ?? ''} className={INPUT} required={!requireChart}>
          <option value="">{requireChart ? 'همه' : '— انتخاب —'}</option>
          {majorSelectRows.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </F>
      <F label="ورودی مجاز از" span="md:col-span-2">
        <input name="ys" type="number" placeholder="مثلاً 1403" defaultValue={o?.entryYearStart ?? ''} className={INPUT} dir="ltr" required={!requireChart} />
      </F>
      <F label="تا" span="md:col-span-2">
        <input name="ye" type="number" placeholder="مثلاً 1405" defaultValue={o?.entryYearEnd ?? ''} className={INPUT} dir="ltr" />
      </F>
    </>
  );

  const ProfessorSelect = (o: typeof mine[number] | null) => (
    <select name="professorId" defaultValue={o?.professorId ?? ''} className={INPUT}>
      <option value="">— بدون استاد —</option>
      {profs.map(p => <option key={p.id} value={p.id}>{p.name} {p.family}</option>)}
    </select>
  );

  return (
    <div className="space-y-4">
      {sp.msg && <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">✓ {sp.msg}</p>}
      {sp.err && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800">⛔ {sp.err}</p>}
      {!requireChart && (
        <div className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs text-rose-800">
          ⚠️ چارت تحصیلی در انتخاب واحد الزامی <b>نیست</b>؛ بنابراین هدف‌گیریِ هر ارائه (رشته مجاز + بازهٔ ورودی) تعیین‌کنندهٔ این است که کدام دانشجو آن را می‌بیند. تعیین «رشتهٔ مجاز» و «ورودی مجاز از» هنگام ایجاد/ویرایش ارائه <b>الزامی</b> است.
        </div>
      )}

      <div className="card space-y-2 !p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-bold">ارائهٔ جدید</h2>
          <p className="text-2xs text-slate-500">ترم جاری: {term?.title ?? '—'}</p>
        </div>
        {!requireChart && (
          <p className="text-2xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-2 py-1">
            چون چارت تحصیلی در انتخاب واحد الزامی نیست، تعیین «رشتهٔ مجاز» و «ورودی مجاز از» برای هر ارائه الزامی است.
          </p>
        )}
        {/*
          چیدمان صریح: ۱۲ ستون، دو ردیفِ کامل (۴+۳+۱+۲+۲ و ۲+۳+۲+۲+۳).
          پیش‌تر `flex flex-wrap` بود و چون `.input` عرضِ ۱۰۰٪ داشت، هر ۹ فیلد
          در سطر جدا می‌افتاد و فرم ده سطر بلند می‌شد.
        */}
        <form action={createOfferingAction} className="grid grid-cols-2 items-end gap-2 md:grid-cols-12">
          <input type="hidden" name="termId" value={term?.id ?? 0} />
          <F label="درس" span="col-span-2 md:col-span-4">
            <select name="courseId" required className={INPUT}>
              <option value="">— درس را انتخاب کنید —</option>
              {deptCourses.map(c => <option key={c.id} value={c.id}>{c.title} ({c.code})</option>)}
            </select>
          </F>
          <F label="استاد" span="col-span-2 md:col-span-3">{ProfessorSelect(null)}</F>
          <F label="گروه" span="md:col-span-1">
            <input name="group" type="number" min={1} defaultValue={1} className={`${INPUT} text-center`} dir="ltr" />
          </F>
          <F label="ظرفیت" span="md:col-span-2">
            <input name="cap" type="number" min={1} required className={INPUT} dir="ltr" />
          </F>
          <F label="لیست انتظار" span="md:col-span-2">
            <input name="waitCap" type="number" min={0} defaultValue={0} className={INPUT} dir="ltr" />
          </F>
          {TargetCells(null)}
          <button className="btn-primary col-span-2 !py-1.5 text-xs md:col-span-3">ایجاد ارائه</button>
        </form>
      </div>

      {/* ── افزودن جلسه: یک فرمِ مشترک به‌جای یک فرم در هر کارت ──
          پیش‌تر هر کارتِ ارائه فرمِ «افزودن جلسه» خودش را داشت و آن فرم
          `<select>`ِ کاملِ سالن‌ها (≈۱۴۰ گزینه) را هم حمل می‌کرد ⇒ فهرستِ
          سالن‌ها به تعدادِ ارائه‌ها تکرار می‌شد. حالا یک فرمِ مشترک هست و
          فهرستِ سالن‌ها فقط یک‌بار در صفحه می‌آید. */}
      {shown.length > 0 && (
        <div className="card space-y-2 !p-3">
          <h2 className="text-sm font-bold">افزودن جلسهٔ برنامهٔ هفتگی</h2>
          <p className="text-2xs text-slate-500">ارائه را انتخاب کنید و جلسه را ثبت کنید. تداخلِ ساعت/کلاس/استاد خودکار بررسی می‌شود.</p>
          <form action={addScheduleAction} className="grid grid-cols-2 items-end gap-2 md:grid-cols-12">
            <input type="hidden" name="termId" value={term?.id ?? 0} />
            <F label="ارائه" span="col-span-2 md:col-span-3">
              <select name="offeringId" required className={INPUT}>
                <option value="">— ارائه را انتخاب کنید —</option>
                {shown.map(o => {
                  const c = courseById.get(o.courseId);
                  return (
                    <option key={o.id} value={o.id}>
                      {c ? `${c.title} (${c.code})` : `#${o.id}`} — گروه {o.groupNumber}
                    </option>
                  );
                })}
              </select>
            </F>
            <F label="روز" span="col-span-1 md:col-span-1">
              <select name="day" className={INPUT} aria-label="روز">{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select>
            </F>
            <F label="ساعت شروع" span="col-span-1 md:col-span-1">
              <input name="start" type="time" required className={INPUT} dir="ltr" aria-label="ساعت شروع" />
            </F>
            <F label="ساعت پایان" span="col-span-1 md:col-span-1">
              <input name="end" type="time" required className={INPUT} dir="ltr" aria-label="ساعت پایان" />
            </F>
            <F label="کلاس" span="col-span-2 md:col-span-3">
              <select name="roomId" className={INPUT} aria-label="کلاس">
                <option value="">— کلاس —</option>
                {rooms.map(r => <option key={r.id} value={r.id}>{r.name} ({r.capacity})</option>)}
              </select>
            </F>
            <button className="btn-primary col-span-2 !py-1.5 text-xs md:col-span-3">افزودن جلسه</button>
          </form>
        </div>
      )}

      {/* ── جست‌وجوی سمتِ سرور + سقف ردیف ── */}
      <div className="card !p-3">
        <form method="GET" className="flex flex-wrap items-end gap-2">
          <label className="min-w-52 flex-1 text-xs text-slate-500">
            جست‌وجوی ارائه (کد یا عنوان درس، یا شمارهٔ گروه)
            <input name="q" defaultValue={q} placeholder="مثلاً 5122305 یا ریاضی یا 2" className="input mt-1" />
          </label>
          <button type="submit" className="btn-primary">جست‌وجو</button>
          {q && <a href="/group-manager/offerings" className="btn-ghost">پاک‌کردن جست‌وجو</a>}
          <span className="text-2xs text-slate-500">
            {shown.length.toLocaleString('fa-IR')} از {totalOffs.toLocaleString('fa-IR')} ارائه
          </span>
        </form>
        {shown.length < totalOffs && (
          <p className="mt-2 text-2xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
            فقط {shown.length.toLocaleString('fa-IR')} ارائهٔ نخست نمایش داده می‌شود — برای دیدن بقیه جست‌وجو کنید.
          </p>
        )}
      </div>

      <div className="space-y-2">
        {shown.map(o => {
          const c = courseById.get(o.courseId)!;
          const sch = scheds.filter(s => s.offeringId === o.id);
          return (
            <div key={o.id} className="card space-y-2 !p-3">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <p className="text-sm font-bold">
                  {c.title} <span className="font-mono text-2xs text-slate-400" dir="ltr">{c.code}</span>
                  <span className="ms-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-3xs font-normal text-slate-600">گروه {o.groupNumber}</span>
                </p>
                <p className="text-2xs text-slate-500">
                  ثبت‌نام: <b className={o.enrolledCount >= o.capacity ? 'text-rose-600' : 'text-slate-700'}>{o.enrolledCount}/{o.capacity}</b>
                  {' · '}استاد: {o.professorId ? profName.get(o.professorId) ?? '—' : '—'}
                  {' · '}هدف: {targetingLabel(o, degTitle, majorTitle)}
                </p>
              </div>

              {/* دو ردیفِ ۱۲ستونی: ۲+۲+۲+۶ و ۲+۳+۲+۲+۳ */}
              <form action={updateOfferingAction} className="grid grid-cols-2 items-end gap-2 md:grid-cols-12">
                <input type="hidden" name="id" value={o.id} />
                <F label="گروه" span="md:col-span-2">
                  <input name="group" type="number" min={1} defaultValue={o.groupNumber} className={`${INPUT} text-center`} dir="ltr" />
                </F>
                <F label="ظرفیت" span="md:col-span-2">
                  <input name="cap" type="number" min={1} defaultValue={o.capacity} className={INPUT} dir="ltr" />
                </F>
                <F label="لیست انتظار" span="md:col-span-2">
                  <input name="waitCap" type="number" min={0} defaultValue={o.waitlistCapacity ?? 0} className={INPUT} dir="ltr" />
                </F>
                <F label="استاد" span="col-span-2 md:col-span-6">{ProfessorSelect(o)}</F>
                {TargetCells(o)}
                <button className="btn-ghost col-span-2 !py-1.5 text-xs md:col-span-3">ذخیره</button>
              </form>

              <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2 text-2xs">
                <span className="text-slate-500">برنامهٔ هفتگی:</span>
                {sch.length === 0 && <span className="text-slate-400">— ثبت نشده —</span>}
                {sch.map(s => (
                  <form key={s.id} action={deleteScheduleAction} className="flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-0.5">
                    <input type="hidden" name="id" value={s.id} />
                    <span className="whitespace-nowrap">{DAYS[s.day ?? 0]} {hm(s.st)}–{hm(s.en)}{s.room ? ' · ' + s.room : ''}</span>
                    <button className="text-red-500 hover:underline" aria-label="حذف این جلسه">×</button>
                  </form>
                ))}
                <form action={deactivateOfferingAction} className="ms-auto">
                  <input type="hidden" name="id" value={o.id} />
                  <button className="text-red-600 text-2xs hover:underline">{o.enrolledCount > 0 ? 'غیرفعال‌سازی' : 'حذف ارائه'}</button>
                </form>
              </div>
            </div>
          );
        })}
        {shown.length === 0 && (
          <p className="card text-center text-sm text-slate-400">
            {q ? 'ارائه‌ای با این عبارت پیدا نشد.' : 'ارائه‌ای برای ترم جاری در گروه شما نیست.'}
          </p>
        )}
      </div>
    </div>
  );
}
