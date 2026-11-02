import { and, eq, inArray } from 'drizzle-orm';
import Link from 'next/link';
import { db } from '@/db';
import { academic_terms, classrooms, course_offerings, courses, faculties, schedules, staff, users } from '@/db/schema';
import { requireDepHead } from '@/lib/group-manager';

export const dynamic = 'force-dynamic';
const DAYS = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];
const hm = (t: string | null) => (t ? String(t).slice(0, 5) : '');

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
export default async function ClassroomsPage() {
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

  const rooms = roomIds.length
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

  // برنامهٔ هفتگیِ ترم جاری برای همین کلاس‌ها
  const schedRows = roomIds.length && term
    ? await db.select({
        roomId: schedules.roomId,
        day: schedules.dayOfWeek,
        st: schedules.startTime,
        en: schedules.endTime,
        courseTitle: courses.title,
        courseCode: courses.code,
        groupNumber: course_offerings.groupNumber,
        profFirst: users.firstName,
        profLast: users.lastName,
      })
        .from(schedules)
        .innerJoin(course_offerings, eq(course_offerings.id, schedules.offeringId))
        .innerJoin(courses, eq(courses.id, course_offerings.courseId))
        .leftJoin(staff, eq(staff.id, course_offerings.professorId))
        .leftJoin(users, eq(users.id, staff.userId))
        .where(and(
          eq(schedules.scheduleType, 'CLASS'),
          eq(course_offerings.termId, term.id),
          inArray(schedules.roomId, roomIds),
        ))
        .orderBy(schedules.dayOfWeek, schedules.startTime)
    : [];

  const byRoom = new Map<number, typeof schedRows>();
  for (const s of schedRows) {
    if (s.roomId == null) continue;
    const list = byRoom.get(s.roomId) ?? [];
    list.push(s);
    byRoom.set(s.roomId, list);
  }
  const totalSessions = schedRows.length;

  return (
    <div className="space-y-3">
      <div className="card !p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-sm font-bold">کلاس‌های گروه {dept.name}</h1>
          <p className="text-[11px] text-slate-500">
            ترم جاری: {term?.title ?? '—'} · {rooms.length} کلاس · {totalSessions} جلسه در هفته
          </p>
        </div>
        <p className="mt-1 text-[11px] leading-5 text-slate-500">
          تعریف و ویرایش کلاس‌ها با مدیر سامانه است. این صفحه فقط کلاس‌هایی را نشان می‌دهد که به این گروه
          تخصیص یافته‌اند، همراه با برنامهٔ هفتگیِ نوشته‌شده در آن‌ها. برای افزودن/تغییر جلسه به کارتابل{' '}
          <Link href="/group-manager/offerings" className="font-bold text-teal-700 hover:underline">ارائه‌ها</Link>{' '}
          (بخش «برنامهٔ هفتگی» هر ارائه) بروید.
        </p>
      </div>

      <div className="card !p-3">
        {rooms.length === 0 ? (
          <p className="py-6 text-center text-xs text-slate-400">
            هنوز هیچ کلاسی به این گروه تخصیص نیافته است. پس از ثبت برنامهٔ هفتگیِ ارائه‌های گروه، کلاس‌ها اینجا نمایش داده می‌شوند.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead>
                <tr className="text-[11px] text-slate-500">
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
                        {r.isActive === 0 && <span className="ms-1 rounded-md bg-rose-100 px-1 py-0.5 text-[10px] font-normal text-rose-700">غیرفعال</span>}
                        {r.floor && <span className="ms-1 text-[10px] font-normal text-slate-400">طبقه {r.floor}</span>}
                      </td>
                      <td className="p-2 font-mono text-slate-500" dir="ltr">{r.code ?? '—'}</td>
                      <td className="p-2 text-slate-600">{r.capacity}</td>
                      <td className="p-2 text-slate-600">{r.roomType ?? '—'}</td>
                      <td className="p-2 text-slate-600">{r.facultyName ?? '—'}</td>
                      <td className="p-2">
                        {list.length === 0 ? (
                          <span className="text-[11px] text-slate-400">برنامه‌ای ثبت نشده</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {list.map((s, i) => (
                              <span key={i} className="rounded-lg bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-700">
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
