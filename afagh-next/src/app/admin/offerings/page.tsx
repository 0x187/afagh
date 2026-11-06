import { and, count, eq, or } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { academic_terms, course_offerings, courses, degree_level_configs, majors } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { windowStatus } from '@/lib/enrollment-window';
import { faSearchConds } from '@/lib/fa-list-query';
import { targetingLabel } from '@/lib/offering-targeting';
import OfferingsClient from './OfferingsClient';

export const dynamic = 'force-dynamic';

/**
 * سقف ردیف‌های جدولِ هدف‌گیری. پیش‌تر *همهٔ* ارائه‌های فعالِ ترم (کل دانشگاه)
 * به کلاینت می‌رفت؛ هر ردیف ۴ فرم/فیلد دارد ⇒ payload سنگین. حالا سرور
 * فیلتر + سقف می‌گذارد و کاربر برای بقیه جست‌وجو می‌کند.
 */
const LIST_CAP = 100;

async function saveWindowAction(formData: FormData) {
  'use server';
  const u = await requireRole(['ADMIN']);
  void u;
  const termId = Number(formData.get('termId'));
  const open = formData.get('isOpen') === 'on' || formData.get('isOpen') === 'true';
  const start = String(formData.get('start') || '');
  const end = String(formData.get('end') || '');
  const { getCurrentUniversity } = await import('@/lib/university-scope');
  const uni = await getCurrentUniversity().catch(() => null);
  if (uni) {
    const [t] = await db.select({ universityId: academic_terms.universityId })
      .from(academic_terms).where(eq(academic_terms.id, termId)).limit(1);
    if (!t) return;
    if (t.universityId !== null && t.universityId !== uni.id) return;
  }
  await db.update(academic_terms).set({
    isEnrollmentOpen: open ? 1 : 0,
    enrollmentStartDate: start ? new Date(start) : null,
    enrollmentEndDate: end ? new Date(end) : null,
  }).where(eq(academic_terms.id, termId));
  revalidatePath('/admin/offerings');
  revalidatePath('/student/enroll');
}

async function saveTargetingAction(formData: FormData) {
  'use server';
  await requireRole(['ADMIN']);
  const id = Number(formData.get('offeringId'));
  const deg = formData.get('degree') ? Number(formData.get('degree')) : null;
  const major = formData.get('major') ? Number(formData.get('major')) : null;
  const ys = formData.get('ys') ? Number(formData.get('ys')) : null;
  const ye = formData.get('ye') ? Number(formData.get('ye')) : null;
  // H3: بازهٔ وارونهٔ سال ورودی خطای پیکربندی است — چنین ارائه‌ای برای همهٔ دانشجویان نامرئی می‌شود
  const { validateEntryYearRange } = await import('@/lib/offering-scheduling');
  const eyErr = validateEntryYearRange(ys, ye);
  if (eyErr) return;
  const { getCurrentUniversity } = await import('@/lib/university-scope');
  const uni = await getCurrentUniversity().catch(() => null);
  if (uni) {
    const [o] = await db.select({ universityId: course_offerings.universityId })
      .from(course_offerings).where(eq(course_offerings.id, id)).limit(1);
    if (!o) return;
    if (o.universityId !== null && o.universityId !== uni.id) return;
  }
  await db.update(course_offerings).set({
    targetDegreeLevelId: deg, targetMajorId: major, entryYearStart: ys, entryYearEnd: ye,
  }).where(eq(course_offerings.id, id));
  revalidatePath('/admin/offerings');
  revalidatePath('/student/enroll');
}

const OFFERING_TYPE_OPTIONS = ['NORMAL', 'SUMMER', 'DIRECTED_READING'] as const;

async function saveOfferingTypeAction(formData: FormData) {
  'use server';
  await requireRole(['ADMIN']);
  const id = Number(formData.get('offeringId'));
  const type = String(formData.get('otype') || 'NORMAL').trim().toUpperCase();
  if (!id || !(OFFERING_TYPE_OPTIONS as readonly string[]).includes(type)) return;
  const { getCurrentUniversity } = await import('@/lib/university-scope');
  const uni = await getCurrentUniversity().catch(() => null);
  if (uni) {
    const [o] = await db.select({ universityId: course_offerings.universityId })
      .from(course_offerings).where(eq(course_offerings.id, id)).limit(1);
    if (!o) return;
    if (o.universityId !== null && o.universityId !== uni.id) return;
  }
  await db.update(course_offerings).set({ offeringType: type }).where(eq(course_offerings.id, id));
  revalidatePath('/admin/offerings');
}

const toLocalInput = (d: Date | null) =>
  d ? new Date(d).toLocaleString('sv-SE', { hour12: false }).slice(0, 16) : '';

export default async function OfferingsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireRole(['ADMIN']);
  const { getCurrentUniversity } = await import('@/lib/university-scope');
  const sp = await searchParams;
  const q = (sp.q ?? '').trim();

  // ── فاز ۱: مقاطع مرجع ملی‌اند و به دانشگاه وابسته نیستند، پس موازی می‌آیند ──
  // قبلاً شش کوئری پشتِ سرِ هم اجرا می‌شدند و تأخیرشان جمع می‌شد.
  const [uni, degrees] = await Promise.all([
    getCurrentUniversity().catch(() => null),
    db.select().from(degree_level_configs),
  ]);

  // ── فاز ۲: ترم جاری و رشته‌ها فقط به `uni` نیاز دارند ──
  const [[term], majorRows] = await Promise.all([
    db.select().from(academic_terms)
      .where(and(eq(academic_terms.isCurrent, 1), uni ? eq(academic_terms.universityId, uni.id) : undefined))
      .limit(1),
    // رشته‌ها per-uni هستند
    db.select().from(majors).where(uni ? eq(majors.universityId, uni.id) : undefined),
  ]);

  const win = windowStatus(term);

  // ── فاز ۳: ارائه‌های ترم (وابسته به `term`) ──
  // جست‌وجوی سمتِ سرور روی کد/عنوان درس + سقف ردیف.
  const searchConds = faSearchConds(q, [courses.code, courses.title]);
  const offWhere = and(
    eq(course_offerings.termId, term?.id ?? -1),
    eq(course_offerings.isActive, 1),
    searchConds.length ? or(...searchConds) : undefined,
  );
  const offSelect = {
    id: course_offerings.id, code: courses.code, title: courses.title, group: course_offerings.groupNumber,
    cap: course_offerings.capacity, enr: course_offerings.enrolledCount, deg: course_offerings.targetDegreeLevelId,
    major: course_offerings.targetMajorId, ys: course_offerings.entryYearStart, ye: course_offerings.entryYearEnd,
    typ: course_offerings.offeringType,
  };
  const [offs, totalRow] = term
    ? await Promise.all([
        db
          .select(offSelect)
          .from(course_offerings).innerJoin(courses, eq(courses.id, course_offerings.courseId))
          .where(offWhere)
          .orderBy(courses.code)
          .limit(LIST_CAP),
        db.select({ n: count() })
          .from(course_offerings).innerJoin(courses, eq(courses.id, course_offerings.courseId))
          .where(offWhere),
      ])
    : [[], [{ n: 0 }]];
  const totalOffs = Number(totalRow[0]?.n ?? 0);

  const degTitle = (id: number) => degrees.find(d => d.id === id)?.title ?? String(id);
  const majorTitle = (id: number) => majorRows.find(m => m.id === id)?.name ?? String(id);

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <h2 className="font-bold">زمان‌بندی انتخاب واحد — {term?.title ?? 'بدون ترم'}</h2>
        <p className={'badge ' + (win.open ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-700')}>{win.label}</p>
        <form action={saveWindowAction} className="grid items-end gap-3 md:grid-cols-4">
          <input type="hidden" name="termId" value={term?.id ?? 0} />
          <label className="text-xs text-slate-500">پنجره باز باشد
            <input type="checkbox" name="isOpen" defaultChecked={!!term?.isEnrollmentOpen} className="ms-2 size-4 align-middle" />
          </label>
          <label className="text-xs text-slate-500">شروع
            <input type="datetime-local" name="start" defaultValue={toLocalInput(win.start)} className="input mt-1" dir="ltr" />
          </label>
          <label className="text-xs text-slate-500">پایان
            <input type="datetime-local" name="end" defaultValue={toLocalInput(win.end)} className="input mt-1" dir="ltr" />
          </label>
          <button className="btn-primary">ذخیرهٔ بازه</button>
        </form>
        <p className="text-2xs text-slate-400">باز بودن = پرچم باز + بودن زمان فعلی در بازهٔ شروع/پایان. خالی گذاشتن تاریخ = بدون محدودیت زمانی آن سمت.</p>
      </div>

      <div className="card">
        <h2 className="mb-2 font-bold">هدف‌گیری ارائه‌ها (مقطع / رشته / ورودی)</h2>
        <p className="mb-3 text-xs text-slate-500">خالی = بدون محدودیت. مثال: مقطع «کارشناسی ارشد» فقط برای ارشدی‌ها دیده می‌شود؛ بازهٔ ورودی ۱۴۰۰ تا ∞ یعنی ورودی‌های قدیمی‌تر آن را نمی‌بینند.</p>
        {/* ── جست‌وجوی سمتِ سرور + سقف ردیف ── */}
        <form method="GET" className="mb-3 flex flex-wrap items-end gap-2">
          <label className="min-w-52 flex-1 text-xs text-slate-500">
            جست‌وجوی ارائه (کد یا عنوان درس)
            <input name="q" defaultValue={q} placeholder="مثلاً 5122305 یا یادگیری ماشین" className="input mt-1" />
          </label>
          <button type="submit" className="btn-primary">جست‌وجو</button>
          {q && <a href="/admin/offerings" className="btn-ghost">پاک‌کردن جست‌وجو</a>}
          <span className="text-2xs text-slate-500">
            {offs.length.toLocaleString('fa-IR')} از {totalOffs.toLocaleString('fa-IR')} ارائه
          </span>
        </form>
        {offs.length < totalOffs && (
          <p className="mb-2 text-2xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
            فقط {offs.length.toLocaleString('fa-IR')} ارائهٔ نخست نمایش داده می‌شود — برای دیدن بقیه جست‌وجو کنید.
          </p>
        )}
        <OfferingsClient
          saveTargeting={saveTargetingAction}
          saveType={saveOfferingTypeAction}
          rows={offs.map(o => ({ ...o, label: targetingLabel({ targetDegreeLevelId: o.deg, targetMajorId: o.major, entryYearStart: o.ys, entryYearEnd: o.ye }, degTitle, majorTitle) }))}
          degrees={degrees.map(d => ({ id: d.id, title: d.title }))}
          majors={majorRows.map(m => ({ id: m.id, name: m.name }))}
        />
      </div>
    </div>
  );
}
