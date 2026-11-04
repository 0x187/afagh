import { and, count, eq, inArray } from 'drizzle-orm';
import Link from 'next/link';
import { db } from '@/db';
import { academic_terms, classrooms, course_offerings, courses, faculties, schedules, staff, users } from '@/db/schema';
import { requireDepHead } from '@/lib/group-manager';
import { faIncludes } from '@/lib/persian-search';

export const dynamic = 'force-dynamic';
const DAYS = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];
const hm = (t: string | null) => (t ? String(t).slice(0, 5) : '');

/**
 * سقف کلاس‌ها و جلسات هفتگی که در یک نوبت به کلاینت میروند.
 *
 * این صفحه فقطخواندنی است، ولی پیشتر *همه* جلسات هفتگی ترم جاری (برای تمام
 * کلاسهای گروه) خوانده و بهصورت چیپ در هر ردیف رندر میشد ⇒ در ترمهای شلوغ
 * صدها ردیف × چندین چیپ، payload و کار رندر را سنگین میکرد. حالا سرور جستجو
 * (نام/کد کلاس) + سقف میگذارد و بقیه با جستجو پیدا میشوند.
 */
const ROOM_CAP = 100;
const SESSION_CAP = 300;

/**
 * کلاس‌های گروه — **فقط خواندنی**.
 *
 * پیش‌تر این صفحه فرم «تعریف کلاس جدید» و دکمه‌های ویرایش/حذف داشت و همهٔ
 * کلاس‌های دانشگاه را نشان می‌داد. تعریف کلاس کارِ مدیر سامانه است؛ مدیر گروه
 * فقط باید کلاس‌های تخصیص‌یافته به گروه خودش و برنامه‌ای که در آن‌ها نوشته شده
 * را ببیند.
 *
 * دامنهٔ «تخصیص‌یافته به گروه» دو منبع دارد (اتحادشان):
 *   ۱) `classrooms."departmentId"` — تخصیص صریح (مهاجرت ۰۱۱۴).
 *   ۲) کلاس‌هایی که در برنامهٔ هفتگیِ ارائه‌های همین گروه (ترم جاری) استفاده
 *      شده‌اند. این مبنا لازم است چون در دادهٔ فعلی **هر ۱۳۸ کلاس** مقدار
 *      departmentId = NULL دارند و فیلترِ تنها-صریح، صفحه را برای همه خالی
 *      می‌کرد. کامنت خود ستون هم همین را می‌گوید: «NULL = تخصیص صریح نشده؛
 *      مسئولیت از سانس‌های اتاق استنتاج می‌شود».
 *
 * ثبت برنامه هم از کارتابل «ارائه‌ها» انجام می‌شود (برنامهٔ هفتگی هر ارائه)،
 * نه از اینجا — پس این صفحه لینک راهنما می‌دهد و تغییری ثبت نمی‌کند.
 */
export default async function ClassroomsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const sp = await searchParams;
  const q = (sp.q ?? '').trim();
  const { deptId, dept } = await requireDepHead();
  const [term] = await db.select().from(academic_terms).where(eq(academic_terms.isCurrent, 1)).limit(1);

  const roomIdSet = new Set<number>();

  // ۱) تخصیص صریح به همین گروه
  for (const r of await db.select({ id: classrooms.id }).from(classrooms).where(eq(classrooms.departmentId, deptId))) {
    roomIdSet.add(r.id);
  }

  // ۲) کلاس‌هایی که در برنامهٔ ارائه‌های همین گروه (ترم جاری) استفاده شده‌اند
  if (term) {
    const used = await db.selectDistinct({ roomId: schedules.roomId })
      .from(schedules)
      .innerJoin(course_offerings, eq(course_offerings.id, schedules.offeringId))
      .innerJoin(courses, eq(courses.id, course_offerings.courseId))
      .where(and(
        eq(schedules.scheduleType, 'CLASS'),
        eq(course_offerings.termId, term.id),
        eq(courses.departmentId, deptId),
      ));
    for (const r of used) if (r.roomId != null) roomIdSet.add(r.roomId);
  }

  const roomIds = [...roomIdSet];

  const allRooms = roomIds.length
    ? await db.select({
        id: classrooms.id,
        name: classrooms.name,
        code: classrooms.code,
        capacity: classrooms.capacity,
        roomType: classrooms.roomType,
        isExamHall: classrooms.isExamHall,
        examCapacity: classrooms.examCapacity,
        floor: classrooms.floor,
        isActive: classrooms.isActive,
        facultyName: faculties.name,
      })
        .from(classrooms)
        .leftJoin(faculties, eq(faculties.id, classrooms.facultyId))
        .where(inArray(classrooms.id, roomIds))
        .orderBy(classrooms.name)
    : [];

  // جستجوی سمتِ سرور (نام یا کد کلاس) — چون فهرست کلاس‌های گروه محدود است،
  // فیلتر در حافظهٔ سرور ارزان و بیخطر است. بقیه با جستجو پیدا میشوند.
  const matchedRooms = q
    ? allRooms.filter(r => faIncludes(`${r.name} ${r.code ?? ''}`, q))
    : allRooms;
  const totalRooms = matchedRooms.length;
  const rooms = matchedRooms.slice(0, ROOM_CAP);
  const shownRoomIds = rooms.map(r => r.id);

  // برنامهٔ هفتگیِ ترم جاری — فقط برای کلاس‌های نمایشدادهشده، با سقف جلسه.
  const schedWhere = and(
    eq(schedules.scheduleType, 'CLASS'),
    eq(course_offerings.termId, term?.id ?? -1),
    inArray(schedules.roomId, shownRoomIds),
  );
  const schedSelect = {
    roomId: schedules.roomId,
    day: schedules.dayOfWeek,
    st: schedules.startTime,
    en: schedules.endTime,
    courseTitle: courses.title,
    courseCode: courses.code,
    groupNumber: course_offerings.groupNumber,
    profFirst: users.firstName,
    profLast: users.lastName,
  };
  const [schedRows, sessionCountRow] = shownRoomIds.length && term
    ? await Promise.all([
        db.select(schedSelect)
          .from(schedules)
          .innerJoin(course_offerings, eq(course_offerings.id, schedules.offeringId))
          .innerJoin(courses, eq(courses.id, course_offerings.courseId))
          .leftJoin(staff, eq(staff.id, course_offerings.professorId))
          .leftJoin(users, eq(users.id, staff.userId))
          .where(schedWhere)
          .orderBy(schedules.dayOfWeek, schedules.startTime)
          .limit(SESSION_CAP),
        db.select({ n: count() })
          .from(schedules)
          .innerJoin(course_offerings, eq(course_offerings.id, schedules.offeringId))
          .where(schedWhere),
      ])
    : [[], [{ n: 0 }]];
  const totalSessions = Number(sessionCountRow[0]?.n ?? 0);

  const byRoom = new Map<number, typeof schedRows>();
  for (const s of schedRows) {
    if (s.roomId == null) continue;
    const list = byRoom.get(s.roomId) ?? [];
    list.push(s);
    byRoom.set(s.roomId, list);
  }

  return (
    <div className="space-y-3">
      <div className="card !p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-sm font-bold">کلاس‌های گروه {dept.name}</h1>
          <p className="text-2xs text-slate-500">
            ترم جاری: {term?.title ?? '—'} · {rooms.length.toLocaleString('fa-IR')} کلاس · {totalSessions.toLocaleString('fa-IR')} جلسه در هفته
          </p>
        </div>
        {/* ── جستجوی سمتِ سرور + سقف ردیف ── */}
        <form method="GET" className="mt-2 flex flex-wrap items-end gap-2">
          <label className="min-w-52 flex-1 text-2xs text-slate-500">
            جستجوی کلاس (نام یا کد)
            <input name="q" defaultValue={q} placeholder="مثلاً ۲۰۷ یا انسانی" className="input mt-1" />
          </label>
          <button type="submit" className="btn-primary">جستجو</button>
          {q && <a href="/group-manager/classrooms" className="btn-ghost">پاککردن جستجو</a>}
        </form>
        {(rooms.length < totalRooms || schedRows.length < totalSessions) && (
          <p className="mt-2 text-2xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
            نمایش {rooms.length.toLocaleString('fa-IR')} از {totalRooms.toLocaleString('fa-IR')} کلاس
            {schedRows.length < totalSessions && ` و ${schedRows.length.toLocaleString('fa-IR')} از ${totalSessions.toLocaleString('fa-IR')} جلسه`}
            {' '}— برای دیدن بقیه جستجو کنید.
          </p>
        )}
        <p className="mt-1 text-2xs leading-5 text-slate-500">
          تعریف و ویرایش کلاس‌ها با مدیر سامانه است. این صفحه فقط کلاس‌هایی را نشان می‌دهد که به این گروه
          تخصیص یافته‌اند، همراه با برنامهٔ هفتگیِ نوشته‌شده در آن‌ها. برای افزودن/تغییر جلسه به کارتابل{' '}
          <Link prefetch={false} href="/group-manager/offerings" className="font-bold text-teal-700 hover:underline">ارائه‌ها</Link>{' '}
          (بخش «برنامهٔ هفتگی» هر ارائه) بروید.
        </p>
      </div>

      <div className="card !p-3">
        {rooms.length === 0 ? (
          <p className="py-6 text-center text-xs text-slate-400">
            {q
              ? 'کلاسی با این عبارت پیدا نشد.'
              : 'هنوز هیچ کلاسی به این گروه تخصیص نیافته است. پس از ثبت برنامهٔ هفتگیِ ارائه‌های گروه، کلاس‌ها اینجا نمایش داده می‌شوند.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead>
                <tr className="text-2xs text-slate-500">
                  <th className="p-2 font-normal">نام کلاس</th>
                  <th className="p-2 font-normal">کد</th>
                  <th className="p-2 font-normal">ظرفیت</th>
                  <th className="p-2 font-normal">نوع</th>
                  <th className="p-2 font-normal">دانشکده</th>
                  <th className="p-2 font-normal">برنامهٔ هفتگی</th>
                </tr>
              </thead>
              <tbody>
                {rooms.map(r => {
                  const list = byRoom.get(r.id) ?? [];
                  return (
                    <tr key={r.id} className="border-t border-slate-100 align-top">
                      <td className="p-2 font-bold text-slate-800">
                        {r.name}
                        {r.isActive === 0 && <span className="ms-1 rounded-md bg-rose-100 px-1 py-0.5 text-3xs font-normal text-rose-700">غیرفعال</span>}
                        {r.floor && <span className="ms-1 text-3xs font-normal text-slate-400">طبقه {r.floor}</span>}
                      </td>
                      <td className="p-2 font-mono text-slate-500" dir="ltr">{r.code ?? '—'}</td>
                      <td className="p-2 text-slate-600">{r.capacity}</td>
                      <td className="p-2 text-slate-600">{r.roomType ?? '—'}</td>
                      <td className="p-2 text-slate-600">{r.facultyName ?? '—'}</td>
                      <td className="p-2">
                        {list.length === 0 ? (
                          <span className="text-2xs text-slate-400">برنامه‌ای ثبت نشده</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {list.map((s, i) => (
                              <span key={i} className="rounded-lg bg-slate-100 px-1.5 py-0.5 text-3xs text-slate-700">
                                <b className="font-bold">{DAYS[s.day ?? 0]}</b> {hm(s.st)}–{hm(s.en)}
                                {' · '}{s.courseTitle}
                                <span className="font-mono text-slate-400" dir="ltr"> ({s.courseCode})</span>
                                {' · '}گروه {s.groupNumber}
                                {s.profFirst || s.profLast ? ` · ${s.profFirst ?? ''} ${s.profLast ?? ''}`.trimEnd() : ''}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
