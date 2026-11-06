import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { majors, students, users } from '@/db/schema';
import { requireDepHead } from '@/lib/group-manager';
import { saveCompensatoryAction, bulkCompensatoryAction } from './actions';

export const dynamic = 'force-dynamic';

const RELATION_LABEL: Record<string, string> = {
  RELATED: 'مرتبط',
  PARTIAL: 'نیمه‌مرتبط',
  UNRELATED: 'نامرتبط',
};

export default async function CompensatoryStudentsPage({
  searchParams,
}: {
  // ⚠ در Next.js 15/16 `searchParams` یک Promise است — بدون await، پارامتر
  // «ورودی» نادیده گرفته می‌شد و صفحه همیشه روی پیش‌فرض می‌ماند.
  searchParams: Promise<{ year?: string }>;
}) {
  const { depts } = await requireDepHead();
  const sp = (await searchParams) ?? {};
  const deptIds = depts.map(d => d.id);
  const majorsInScope = deptIds.length
    ? await db.select({ id: majors.id, name: majors.name, departmentId: majors.departmentId })
        .from(majors).where(inArray(majors.departmentId, deptIds))
    : [];
  const majorIds = majorsInScope.map(m => m.id);

  const years = majorIds.length
    ? await db.selectDistinct({ y: students.entryYear })
        .from(students).where(inArray(students.majorId, majorIds))
        .orderBy(sql`${students.entryYear} desc`)
    : [];
  const yearList = years.map(r => r.y).filter((y): y is number => y != null);
  // پیش‌فرض = جدیدترین ورودیِ واقعی. `new Date().getFullYear()` غلط بود چون
  // `entryYear` شمسی است (۱۴۰۵)، نه میلادی.
  const selectedYear = sp.year ? Number(sp.year) : (yearList[0] ?? 0);

  const rows = (majorIds.length && selectedYear)
    ? await db.select({
        id: students.id,
        studentCode: students.studentCode,
        entryYear: students.entryYear,
        compensatoryUnits: students.compensatoryUnits,
        previousMajorCode: students.previousMajorCode,
        previousMajorTitle: students.previousMajorTitle,
        previousMajorRelation: students.previousMajorRelation,
        honorsOverride: students.honorsOverride,
        majorName: majors.name,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(students)
      .innerJoin(majors, eq(majors.id, students.majorId))
      .innerJoin(users, eq(users.id, students.userId))
      .where(and(inArray(students.majorId, majorIds), eq(students.entryYear, selectedYear)))
      .orderBy(users.lastName, users.firstName)
    : [];

  const unrelatedCount = rows.filter(r => r.previousMajorRelation === 'UNRELATED').length;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h1 className="text-lg font-black text-slate-900">دانشجویان جبرانی (ورودی جدید)</h1>
        <p className="mt-1 text-xs leading-6 text-slate-600">
          برای هر دانشجوی ورودی، رشتهٔ قبلی، نسبت آن با رشتهٔ جدید، واحد جبرانی و وضعیت ممتاز را تعیین کنید.
          دروس جبرانی باید در ترم ۱ (و در صورت ضرورت ترم ۲) قرار گیرند. «اعمال به همهٔ نامرتبط» واحد جبرانی
          را برای همهٔ دانشجویان نامرتبط این ورودی تنظیم می‌کند.
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <label className="text-xs font-bold text-slate-700 space-y-1">
          <span className="block">سال ورودی</span>
          <select name="year" defaultValue={selectedYear} className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs">
            {yearList.length === 0 && <option value={selectedYear}>{selectedYear}</option>}
            {yearList.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <button type="submit" className="rounded-lg bg-indigo-800 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-900">
          نمایش
        </button>
      </form>

      {rows.length > 0 && (
        <form action={bulkCompensatoryAction} className="flex flex-wrap items-end gap-3 rounded-2xl border border-amber-200 bg-amber-50/60 p-3 shadow-sm">
          <input type="hidden" name="year" value={selectedYear} />
          <input type="hidden" name="deptIds" value={deptIds.join(',')} />
          <label className="text-xs font-bold text-amber-900 space-y-1">
            <span className="block">اعمال به همهٔ نامرتبط ({unrelatedCount} نفر)</span>
            <input type="number" name="units" min={0} step={1} defaultValue={6} className="w-24 rounded-lg border border-amber-300 px-2 py-1.5 text-xs font-mono" />
          </label>
          <button type="submit" className="rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-800">
            اعمال به همهٔ نامرتبط
          </button>
        </form>
      )}

      <div className="space-y-3">
        {rows.map(r => (
          <form key={r.id} action={saveCompensatoryAction} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
            <input type="hidden" name="studentId" value={r.id} />
            <div className="sm:col-span-2">
              <div className="font-bold text-slate-900">{r.firstName} {r.lastName}</div>
              <div className="font-mono text-3xs text-slate-500" dir="ltr">{r.studentCode} — {r.majorName}</div>
            </div>
            <label className="text-2xs font-bold text-slate-700 space-y-1">
              <span className="block">کد رشتهٔ قبلی</span>
              <input type="text" name="previousMajorCode" defaultValue={r.previousMajorCode ?? ''} className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs font-mono" />
            </label>
            <label className="text-2xs font-bold text-slate-700 space-y-1">
              <span className="block">عنوان رشتهٔ قبلی</span>
              <input type="text" name="previousMajorTitle" defaultValue={r.previousMajorTitle ?? ''} className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs" />
            </label>
            <label className="text-2xs font-bold text-slate-700 space-y-1">
              <span className="block">نسبت</span>
              <select name="previousMajorRelation" defaultValue={r.previousMajorRelation ?? ''} className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs">
                <option value="">—</option>
                <option value="RELATED">مرتبط</option>
                <option value="PARTIAL">نیمه‌مرتبط</option>
                <option value="UNRELATED">نامرتبط</option>
              </select>
            </label>
            <label className="text-2xs font-bold text-slate-700 space-y-1">
              <span className="block">واحد جبرانی</span>
              <input type="number" name="compensatoryUnits" min={0} step={1} defaultValue={r.compensatoryUnits ?? 0} className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs font-mono" />
            </label>
            <label className="text-2xs font-bold text-slate-700 space-y-1">
              <span className="block">ممتاز</span>
              <select name="honorsOverride" defaultValue={r.honorsOverride == null ? '' : String(r.honorsOverride)} className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs">
                <option value="">خودکار</option>
                <option value="1">ممتاز</option>
                <option value="0">غیرممتاز</option>
              </select>
            </label>
            <div className="flex items-end">
              <button type="submit" className="rounded-lg bg-indigo-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-800">ذخیره</button>
            </div>
          </form>
        ))}
        {rows.length === 0 && (
          <div className="rounded-2xl border border-slate-200 bg-white p-4 text-center text-slate-500 text-xs">
            دانشجویی برای این ورودی در دامنهٔ شما یافت نشد.
          </div>
        )}
      </div>
    </div>
  );
}
