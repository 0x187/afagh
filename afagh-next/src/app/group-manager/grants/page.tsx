import { and, count, eq, inArray } from 'drizzle-orm';
import Link from 'next/link';
import { db } from '@/db';
import { academic_terms, courses, majors, students, users } from '@/db/schema';
import { requireDepHead } from '@/lib/group-manager';
import { resolveStudentCurriculumScope } from '@/lib/enroll-curriculum-scope';
import { termOrdinalForEntry } from '@/lib/term-scope';
import { grantCourseAction, revokeGrantAction } from './actions';

export const dynamic = 'force-dynamic';

const faNum = (n: number | null | undefined) =>
  n == null ? '—' : String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

const SEM_LABEL: Record<number, string> = { 9: 'تابستان' };

export default async function GrantsPage({
  searchParams,
}: {
  /**
   * ⚠ در Next.js 15/16 `searchParams` یک **Promise** است. پیش‌تر اینجا به‌صورت
   * آبجکت خام تایپ و خوانده می‌شد؛ نتیجه این بود که `sp.major`/`sp.year`/`sp.student`
   * همیشه undefined می‌ماندند و پارامترهای فرمِ «نمایش دانشجویان» (که با GET
   * ارسال می‌شوند) **بی‌صدا نادیده گرفته می‌شدند** — صفحه با رشته/ورودیِ پیش‌فرض
   * رندر می‌شد و فهرست دانشجویان خالی می‌ماند. (باگ گزارش‌شدهٔ کاربر)
   */
  searchParams: Promise<{ major?: string; year?: string; student?: string; msg?: string; err?: string }>;
}) {
  const { depts } = await requireDepHead();
  const deptIds = depts.map(d => d.id);
  const sp = (await searchParams) ?? {};

  const majorsInScope = deptIds.length
    ? await db.select({ id: majors.id, name: majors.name, departmentId: majors.departmentId })
        .from(majors).where(inArray(majors.departmentId, deptIds)).orderBy(majors.name)
    : [];

  /*
    ترکیبِ (رشته، ورودی) که واقعاً دانشجو دارد — به‌جای پیش‌فرضِ «اولین رشته +
    جدیدترین ورودی». پیش‌تر پیش‌فرض روی رشته‌ای می‌افتاد که هیچ دانشجویی نداشت
    (مثلاً «زیست شناسی سلولی و مولکولی») و صفحه همیشه با «دانشجویی یافت نشد»
    باز می‌شد، حتی وقتی داده وجود داشت.
  */
  const pairs = majorsInScope.length
    ? await db.select({ majorId: students.majorId, year: students.entryYear, n: count() })
        .from(students)
        .where(inArray(students.majorId, majorsInScope.map(m => m.id)))
        .groupBy(students.majorId, students.entryYear)
    : [];

  const yearsFor = (mid: number) =>
    pairs.filter(p => p.majorId === mid && p.year != null).map(p => p.year!).sort((a, b) => b - a);

  const firstMajorWithStudents = majorsInScope.find(m => pairs.some(p => p.majorId === m.id)) ?? majorsInScope[0];

  const majorId = sp.major ? Number(sp.major) : (firstMajorWithStudents?.id ?? 0);

  const yearOptions = yearsFor(majorId);
  const year = sp.year ? Number(sp.year) : (yearOptions[0] ?? 0);
  // ورودیِ درخواستیِ لینک‌های قدیمی باید در لیست دیده شود، حتی اگر دانشجو نداشته باشد
  if (year && !yearOptions.includes(year)) yearOptions.unshift(year);

  const studentRows = (majorId && year)
    ? await db.select({
        id: students.id,
        studentCode: students.studentCode,
        entryYear: students.entryYear,
        entryTerm: students.entryTerm,
        majorName: majors.name,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(students)
      .innerJoin(majors, eq(majors.id, students.majorId))
      .innerJoin(users, eq(users.id, students.userId))
      .where(and(eq(students.majorId, majorId), eq(students.entryYear, year)))
      .orderBy(users.lastName, users.firstName)
    : [];

  // ── جزئیات دانشجوی انتخاب‌شده ──
  const selectedStudentId = sp.student ? Number(sp.student) : 0;
  const selected = selectedStudentId
    ? (studentRows.find(s => s.id === selectedStudentId)
       ?? (await db.select({
            id: students.id, studentCode: students.studentCode, entryYear: students.entryYear,
            entryTerm: students.entryTerm, majorName: majors.name,
            firstName: users.firstName, lastName: users.lastName,
          })
          .from(students)
          .innerJoin(majors, eq(majors.id, students.majorId))
          .innerJoin(users, eq(users.id, students.userId))
          .where(eq(students.id, selectedStudentId)).limit(1))[0] ?? null)
    : null;

  // شمارهٔ ترم جاریِ دانشجو (برای تشخیص درس ترم بالاتر)
  let termOrdinal: number | null = null;
  if (selected) {
    const [term] = await db.select().from(academic_terms).where(eq(academic_terms.isCurrent, 1)).limit(1);
    if (term) {
      termOrdinal = termOrdinalForEntry({
        entryYear: selected.entryYear,
        entryTerm: selected.entryTerm,
        terms: [],
        targetTermCode: term.termCode,
      });
    }
  }

  // چارت دانشجو + تخصیص‌های موجود
  const scope = selected ? await resolveStudentCurriculumScope(selected.id) : null;
  const chartCourses = scope?.resolved
    ? await db.select({ id: courses.id, code: courses.code, title: courses.title, units: courses.units })
        .from(courses).where(inArray(courses.id, [...scope.courseIds]))
    : [];

  const chartRows = chartCourses
    .map(c => ({
      ...c,
      rec: scope!.recommendedByCourse.get(c.id) ?? null,
      granted: scope!.grantedCourseIds.has(c.id),
    }))
    .sort((a, b) => (a.rec ?? 99) - (b.rec ?? 99) || a.title.localeCompare(b.title, 'fa'));

  const higherCount = chartRows.filter(r => r.rec != null && termOrdinal != null && r.rec > termOrdinal).length;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h1 className="text-lg font-black text-slate-900">تخصیص درس ترم بالاتر</h1>
        <p className="mt-1 text-xs leading-6 text-slate-600">
          در انتخاب واحد، دانشجو درسِ ترم جاری و ترم‌های <b>پایین‌ترِ</b> خودش را می‌بیند.
          درسِ ترم‌های <b>بالاتر</b> فقط وقتی نمایان می‌شود که شما آن را برای او تخصیص دهید
          (مثلاً دانشجوی ترم ۵ که برای جبرانی باید درس ترم ۶ را بگیرد). تخصیص فقط برای
          دروس <b>داخل چارتِ همان دانشجو</b> ممکن است.
        </p>
      </div>

      {sp.msg && <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">✓ {sp.msg}</p>}
      {sp.err && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800">⛔ {sp.err}</p>}

      {/* گام ۱: انتخاب رشته و ورودی */}
      <form method="get" className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <label className="space-y-1 text-xs font-bold text-slate-700">
          <span className="block">رشته</span>
          <select name="major" defaultValue={majorId} className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs">
            {majorsInScope.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-xs font-bold text-slate-700">
          <span className="block">ورودی</span>
          <select name="year" defaultValue={year} className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs">
            {yearOptions.map(y => <option key={y} value={y}>{faNum(y)}</option>)}
          </select>
        </label>
        <button type="submit" className="rounded-lg bg-teal-800 px-3 py-1.5 text-xs font-bold text-white hover:bg-teal-900">
          نمایش دانشجویان
        </button>
      </form>

      {/* گام ۲: فهرست دانشجویان */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-bold text-slate-800">
          دانشجویان ({faNum(studentRows.length)})
        </h2>
        {studentRows.length === 0 ? (
          <p className="text-xs text-slate-500">دانشجویی با این رشته/ورودی یافت نشد.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-right text-slate-500">
                  <th className="p-2">نام</th>
                  <th className="p-2">شمارهٔ دانشجویی</th>
                  <th className="p-2">ورودی</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {studentRows.map(s => (
                  <tr key={s.id} className={`border-b last:border-0 ${s.id === selectedStudentId ? 'bg-teal-50' : ''}`}>
                    <td className="p-2 font-bold text-slate-800">{s.firstName} {s.lastName}</td>
                    <td className="p-2 dir-ltr text-right font-mono text-slate-600">{s.studentCode}</td>
                    <td className="p-2 text-slate-600">{faNum(s.entryYear)}{s.entryTerm === 2 ? '/۲' : ''}</td>
                    <td className="p-2">
                      <Link prefetch={false}
                        href={`/group-manager/grants?major=${majorId}&year=${year}&student=${s.id}`}
                        className="rounded-lg bg-slate-100 px-2 py-1 font-bold text-slate-700 hover:bg-slate-200"
                      >
                        تخصیص درس
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* گام ۳: چارت دانشجوی انتخاب‌شده + دکمه‌های تخصیص */}
      {selected && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-bold text-slate-800">
            چارت {selected.firstName} {selected.lastName} — {selected.majorName}
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            شمارهٔ دانشجویی: <span className="font-mono">{selected.studentCode}</span>
            {' · '}ترم جاری: <b>{faNum(termOrdinal)}</b>
            {scope?.resolved && <> · نسخهٔ چارت: <b>{scope.versionCode ?? '—'}</b></>}
          </p>

          {!scope?.resolved ? (
            <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
              ⚠️ برای این دانشجو چارت منتشرشده‌ای حل نشده است — تخصیص فقط برای دروس داخل چارت معنا دارد.
              ابتدا چارت این رشته را در بخش برنامهٔ درسی منتشر کنید.
            </p>
          ) : (
            <>
              <p className="mt-2 text-xs text-slate-500">
                {faNum(chartRows.length)} درس در چارت · {faNum(higherCount)} درس ترم بالاتر (قابل تخصیص)
              </p>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-right text-slate-500">
                      <th className="p-2">کد</th>
                      <th className="p-2">درس</th>
                      <th className="p-2">واحد</th>
                      <th className="p-2">ترم چارت</th>
                      <th className="p-2">وضعیت</th>
                      <th className="p-2">عملیات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chartRows.map(c => {
                      const isHigher = c.rec != null && termOrdinal != null && c.rec > termOrdinal;
                      return (
                        <tr key={c.id} className="border-b last:border-0 align-top">
                          <td className="p-2 font-mono text-slate-500">{c.code}</td>
                          <td className="p-2 font-bold text-slate-800">{c.title}</td>
                          <td className="p-2 text-slate-600">{faNum(Number(c.units ?? 0))}</td>
                          <td className="p-2 text-slate-600">{SEM_LABEL[c.rec ?? 0] ?? faNum(c.rec)}</td>
                          <td className="p-2">
                            {c.granted ? (
                              <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-bold text-emerald-700">تخصیص‌شده</span>
                            ) : isHigher ? (
                              <span className="rounded-full bg-amber-100 px-2 py-0.5 font-bold text-amber-700">ترم بالاتر — مخفی</span>
                            ) : (
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 font-bold text-slate-600">قابل اخذ</span>
                            )}
                          </td>
                          <td className="p-2">
                            {c.granted ? (
                              <form action={revokeGrantAction} className="inline">
                                <input type="hidden" name="studentId" value={selected.id} />
                                <input type="hidden" name="courseId" value={c.id} />
                                <button className="rounded-lg bg-red-50 px-2 py-1 font-bold text-red-700 hover:bg-red-100">
                                  لغو تخصیص
                                </button>
                              </form>
                            ) : isHigher ? (
                              <form action={grantCourseAction} className="flex items-center gap-1">
                                <input type="hidden" name="studentId" value={selected.id} />
                                <input type="hidden" name="courseId" value={c.id} />
                                <input
                                  name="reason" placeholder="دلیل (اختیاری)"
                                  className="w-28 rounded-lg border border-slate-300 px-1.5 py-1 text-2xs"
                                />
                                <button className="rounded-lg bg-teal-700 px-2 py-1 font-bold text-white hover:bg-teal-800">
                                  تخصیص
                                </button>
                              </form>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
