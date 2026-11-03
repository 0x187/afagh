import { and, eq, inArray } from 'drizzle-orm';
import {
  course_offerings,
  courses,
  enrollments,
  staff,
  users,
  virtual_classrooms,
} from '@/db/schema';
import { db } from '@/db';
import { getStudentByUser, requireRole } from '@/lib/auth';
import { getTermScope } from '@/lib/term-scope';
import {
  buildProfNameMap,
  distinctIds,
  resolveDashboardTerm,
} from '@/lib/student-dashboard-helpers';
import { isDemoStudentUser } from '@/lib/demo-accounts';
import MessengerOnboardBanner from '@/components/MessengerOnboardBanner';
import Link from 'next/link';
import { DemoDashboard } from './demo-sections';

export const dynamic = 'force-dynamic';

export default async function StudentDashboardPage() {
  const user = await requireRole(['STUDENT']);
  const me = await getStudentByUser(user.id);
  if (!me) return <p className="card p-6 text-center text-slate-500">پروندهٔ دانشجویی یافت نشد.</p>;

  const [termScope, demo] = await Promise.all([
    getTermScope(me.universityId),
    isDemoStudentUser(user.id),
  ]);
  const { filteredTerm, term } = resolveDashboardTerm(termScope);

  if (demo) {
    return <DemoDashboard name={user.name} filteredTermTitle={filteredTerm?.title ?? null} />;
  }

  const [
    currentEnrollments,
  ] = await Promise.all([
    term
      ? db
        .select({
          enrollmentId: enrollments.id,
          offeringId: enrollments.offeringId,
          code: courses.code,
          title: courses.title,
          units: courses.units,
          courseType: courses.courseType,
          group: course_offerings.groupNumber,
          professorId: course_offerings.professorId,
          emergencyWithdrawal: enrollments.emergencyWithdrawal,
          status: enrollments.status,
        })
        .from(enrollments)
        .innerJoin(course_offerings, eq(course_offerings.id, enrollments.offeringId))
        .innerJoin(courses, eq(courses.id, course_offerings.courseId))
        .where(
          and(
            eq(enrollments.studentId, me.id),
            eq(course_offerings.termId, term.id),
            inArray(enrollments.status, ['REGISTERED', 'FINALIZED', 'WAITLISTED', 'PENDING_COUNCIL', 'DROPPED'])
          )
        )
      : Promise.resolve([]),
  ]);

  const professorIds = distinctIds(currentEnrollments.map(c => c.professorId));

  const [profUsers, liveVirtualClasses] = await Promise.all([
    professorIds.length > 0
      ? db
        .select({
          staffId: staff.id,
          firstName: users.firstName,
          lastName: users.lastName,
        })
        .from(staff)
        .innerJoin(users, eq(users.id, staff.userId))
        .where(inArray(staff.id, professorIds))
      : Promise.resolve([]),
    term && currentEnrollments.length > 0
      ? db
        .select({
          id: virtual_classrooms.id,
          courseTitle: courses.title,
          meetingId: virtual_classrooms.bbbMeetingId,
          isRunning: virtual_classrooms.isRunning,
          currentAttendanceCount: virtual_classrooms.currentAttendanceCount,
          professorId: course_offerings.professorId,
        })
        .from(virtual_classrooms)
        .innerJoin(course_offerings, eq(course_offerings.id, virtual_classrooms.courseOfferingId))
        .innerJoin(courses, eq(courses.id, course_offerings.courseId))
        .where(
          and(
            eq(course_offerings.termId, term.id),
            inArray(course_offerings.id, currentEnrollments.map(c => c.offeringId))
          )
        )
      : Promise.resolve([]),
  ]);

  const profMap = buildProfNameMap(profUsers);

  return (
    <div className="space-y-6 animate-in fade-in">
      {/* ========================================================================= */}
      {/* 3. QUICK ACTION SERVICE PORTAL (میز دسترسی سریع به امکانات) */}
      {/* ========================================================================= */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-black text-slate-900 text-sm sm:text-base flex items-center gap-2">
            <span>⚡ دسترسی سریع به درگاه‌ها و خدمات آموزشی</span>
          </h2>
          <span className="text-xs text-slate-500 font-bold">سامانه یکپارچه آفاق</span>
        </div>

        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-2.5 sm:gap-4">
          <Link
            href="/student/enroll"
            className="card p-4 bg-white hover:bg-emerald-50/50 border border-slate-200 hover:border-emerald-300 rounded-2xl shadow-xs transition-all group flex flex-col justify-between"
          >
            <div className="flex items-start justify-between">
              <div className="w-10 h-10 rounded-2xl bg-emerald-100 text-emerald-800 flex items-center justify-center text-xl group-hover:scale-110 transition-transform">
                🛒
              </div>
            </div>
            <div className="mt-3">
              <h3 className="font-black text-slate-900 text-2xs sm:text-sm leading-tight group-hover:text-emerald-900 transition">
                انتخاب واحد
              </h3>
              <p className="hidden sm:block text-2xs text-slate-500 mt-0.5 line-clamp-1">
                کنترل هم‌نیازی، پیش‌نیازی و تداخل
              </p>
            </div>
          </Link>

          <Link
            href="/student/exam-card"
            className="card p-4 bg-white hover:bg-teal-50/50 border border-slate-200 hover:border-teal-300 rounded-2xl shadow-xs transition-all group flex flex-col justify-between"
          >
            <div className="flex items-start justify-between">
              <div className="w-10 h-10 rounded-2xl bg-teal-100 text-teal-800 flex items-center justify-center text-xl group-hover:scale-110 transition-transform">
                📇
              </div>
            </div>
            <div className="mt-3">
              <h3 className="font-black text-slate-900 text-2xs sm:text-sm leading-tight group-hover:text-teal-900 transition">
                کارت آزمون
              </h3>
              <p className="hidden sm:block text-2xs text-slate-500 mt-0.5 line-clamp-1">
                ارزشیابی استاد و چاپ برگه A4
              </p>
            </div>
          </Link>

          <Link
            href="/student/enroll-confirm"
            className="card p-4 bg-white hover:bg-lime-50/50 border border-slate-200 hover:border-lime-300 rounded-2xl shadow-xs transition-all group flex flex-col justify-between"
          >
            <div className="flex items-start justify-between">
              <div className="w-10 h-10 rounded-2xl bg-lime-100 text-lime-800 flex items-center justify-center text-xl group-hover:scale-110 transition-transform">
                🖨️
              </div>
            </div>
            <div className="mt-3">
              <h3 className="font-black text-slate-900 text-2xs sm:text-sm leading-tight group-hover:text-lime-900 transition">
                تأییدیه
              </h3>
              <p className="hidden sm:block text-2xs text-slate-500 mt-0.5 line-clamp-1">
                چاپ برگه با QR استعلام اصالت
              </p>
            </div>
          </Link>

          <Link
            href="/student/transcript"
            className="card p-4 bg-white hover:bg-indigo-50/50 border border-slate-200 hover:border-indigo-300 rounded-2xl shadow-xs transition-all group flex flex-col justify-between"
          >
            <div className="flex items-start justify-between">
              <div className="w-10 h-10 rounded-2xl bg-indigo-100 text-indigo-800 flex items-center justify-center text-xl group-hover:scale-110 transition-transform">
                📜
              </div>
              <span className="hidden sm:inline-flex text-3xs bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded-full font-bold">
                رسمی
              </span>
            </div>
            <div className="mt-3">
              <h3 className="font-black text-slate-900 text-2xs sm:text-sm leading-tight group-hover:text-indigo-900 transition">
                کارنامه
              </h3>
              <p className="hidden sm:block text-2xs text-slate-500 mt-0.5 line-clamp-1">
                محاسبه آیین‌نامه‌ای و حذف مردودی
              </p>
            </div>
          </Link>

          <Link
            href="/student/virtual-classes"
            className="card p-4 bg-white hover:bg-sky-50/50 border border-slate-200 hover:border-sky-300 rounded-2xl shadow-xs transition-all group flex flex-col justify-between"
          >
            <div className="flex items-start justify-between">
              <div className="w-10 h-10 rounded-2xl bg-sky-100 text-sky-800 flex items-center justify-center text-xl group-hover:scale-110 transition-transform">
                💻
              </div>
              <span className="hidden sm:inline-flex text-3xs bg-sky-100 text-sky-800 px-2 py-0.5 rounded-full font-bold animate-pulse">
                BBB زنده
              </span>
            </div>
            <div className="mt-3">
              <h3 className="font-black text-slate-900 text-2xs sm:text-sm leading-tight group-hover:text-sky-900 transition">
                کلاس آنلاین
              </h3>
              <p className="hidden sm:block text-2xs text-slate-500 mt-0.5 line-clamp-1">
                ورود مستقیم به جلسات مجازی LMS
              </p>
            </div>
          </Link>

          <Link
            href="/student/schedule"
            className="card p-4 bg-white hover:bg-amber-50/50 border border-slate-200 hover:border-amber-300 rounded-2xl shadow-xs transition-all group flex flex-col justify-between"
          >
            <div className="flex items-start justify-between">
              <div className="w-10 h-10 rounded-2xl bg-amber-100 text-amber-800 flex items-center justify-center text-xl group-hover:scale-110 transition-transform">
                📅
              </div>
              <span className="hidden sm:inline-flex text-3xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full font-bold">
                تقویم شمسی
              </span>
            </div>
            <div className="mt-3">
              <h3 className="font-black text-slate-900 text-2xs sm:text-sm leading-tight group-hover:text-amber-900 transition">
                برنامه و آزمون
              </h3>
              <p className="hidden sm:block text-2xs text-slate-500 mt-0.5 line-clamp-1">
                شماره کلاس، ساختمان و ساعت آزمون
              </p>
            </div>
          </Link>

          <Link
            href="/student/requests"
            className="card p-4 bg-white hover:bg-purple-50/50 border border-slate-200 hover:border-purple-300 rounded-2xl shadow-xs transition-all group flex flex-col justify-between"
          >
            <div className="flex items-start justify-between">
              <div className="w-10 h-10 rounded-2xl bg-purple-100 text-purple-800 flex items-center justify-center text-xl group-hover:scale-110 transition-transform">
                📋
              </div>
              <span className="hidden sm:inline-flex text-3xs bg-purple-100 text-purple-800 px-2 py-0.5 rounded-full font-bold">
                سجاد BPM
              </span>
            </div>
            <div className="mt-3">
              <h3 className="font-black text-slate-900 text-2xs sm:text-sm leading-tight group-hover:text-purple-900 transition">
                میز خدمات
              </h3>
              <p className="hidden sm:block text-2xs text-slate-500 mt-0.5 line-clamp-1">
                درخواست مرخصی، حذف ترم و کمیسیون
              </p>
            </div>
          </Link>

          <Link
            href="/student/chart"
            className="card p-4 bg-white hover:bg-rose-50/50 border border-slate-200 hover:border-rose-300 rounded-2xl shadow-xs transition-all group flex flex-col justify-between"
          >
            <div className="flex items-start justify-between">
              <div className="w-10 h-10 rounded-2xl bg-rose-100 text-rose-800 flex items-center justify-center text-xl group-hover:scale-110 transition-transform">
                🗺️
              </div>
              <span className="hidden sm:inline-flex text-3xs bg-rose-100 text-rose-800 px-2 py-0.5 rounded-full font-bold">
                سرفصل‌ها
              </span>
            </div>
            <div className="mt-3">
              <h3 className="font-black text-slate-900 text-2xs sm:text-sm leading-tight group-hover:text-rose-900 transition">
                چارت درسی
              </h3>
              <p className="hidden sm:block text-2xs text-slate-500 mt-0.5 line-clamp-1">
                دروس پایه، اصلی، تخصصی و عمومی
              </p>
            </div>
          </Link>

          <Link
            href="/student/documents"
            className="card p-4 bg-white hover:bg-slate-50 border border-slate-200 hover:border-slate-400 rounded-2xl shadow-xs transition-all group flex flex-col justify-between"
          >
            <div className="flex items-start justify-between">
              <div className="w-10 h-10 rounded-2xl bg-slate-100 text-slate-800 flex items-center justify-center text-xl group-hover:scale-110 transition-transform">
                📁
              </div>
              <span className="hidden sm:inline-flex text-3xs bg-slate-100 text-slate-800 px-2 py-0.5 rounded-full font-bold">
                بایگانی
              </span>
            </div>
            <div className="mt-3">
              <h3 className="font-black text-slate-900 text-2xs sm:text-sm leading-tight group-hover:text-slate-900 transition">
                مدارک
              </h3>
              <p className="hidden sm:block text-2xs text-slate-500 mt-0.5 line-clamp-1">
                مدرک دیپلم، کارت ملی و تعهدنامه
              </p>
            </div>
          </Link>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 4. TODAY'S LIVE VIRTUAL CLASSES — کارت آزمون حذف شد: صفحهٔ اختصاصی */}
      {/* /student/exam-card از «دسترسی سریع» در دسترس است و تکرارش اینجا شلوغی بود. */}
      {/* ========================================================================= */}
      <div className="grid grid-cols-1 gap-5">
        {/* Virtual Classes Widget */}
        <div className="card bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-3.5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <span className="text-xl">💻</span>
              <div>
                <h3 className="font-black text-slate-900 text-sm">
                  کلاس‌های آنلاین و جلسات وبینار LMS (امروز)
                </h3>
                <p className="text-2xs text-slate-500">
                  اتصال مستقیم به سرور BigBlueButton دانشگاه با پروتکل امن SSO
                </p>
              </div>
            </div>
            <Link
              href="/student/virtual-classes"
              className="text-xs font-bold text-sky-700 hover:text-sky-900 bg-sky-50 px-2.5 py-1 rounded-lg"
            >
              همه جلسات ←
            </Link>
          </div>

          <div className="space-y-2.5">
            {liveVirtualClasses.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-3">
                جلسهٔ کلاس مجازی برای دروس {filteredTerm ? 'نیمسال انتخابی' : 'ترم جاری'} شما ثبت نشده است.
              </p>
            ) : (
              liveVirtualClasses.map((vc) => (
                <div
                  key={vc.id}
                  className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 ${
                    vc.isRunning
                      ? 'bg-gradient-to-r from-sky-50 to-indigo-50/50 border-sky-200'
                      : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${vc.isRunning ? 'bg-emerald-500 animate-ping' : 'bg-amber-400'}`}></span>
                      <strong className="text-xs font-black text-slate-900">{vc.courseTitle}</strong>
                      {vc.isRunning && (
                        <span className="hidden sm:inline-flex text-3xs bg-emerald-100 text-emerald-800 font-bold px-1.5 py-0.5 rounded">
                          در حال برگزاری
                        </span>
                      )}
                    </div>
                    <p className="text-2xs text-slate-600">
                      استاد: {vc.professorId ? profMap.get(vc.professorId) || 'نامشخص' : 'نامشخص'} · اتاق مجازی: {vc.meetingId}
                      {vc.isRunning && (vc.currentAttendanceCount ?? 0) > 0
                        ? ` · ${Number(vc.currentAttendanceCount).toLocaleString('fa-IR')} شرکت‌کننده فعال`
                        : ''}
                    </p>
                  </div>
                  <Link
                    href="/student/virtual-classes"
                    className="px-3.5 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-black text-xs shadow-xs transition active:scale-95 whitespace-nowrap"
                  >
                    ورود به کلاس
                  </Link>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          بخش «دروس ثبت‌نام‌شدهٔ نیمسال + حذف اضطراری» به صفحهٔ انتخاب واحد
          (/student/enroll) منتقل شد تا صفحهٔ اول دانشجو شلوغ نشود.
          ───────────────────────────────────────────────────────────── */}

      {/* بنر اتصال پیام‌رسان — عمداً انتهای صفحه: پیش‌تر بالای داشبورد بود و
          محتوای اصلی را پایین می‌راند؛ حالا بدون اشغال فضای بالای صفحه است. */}
      <MessengerOnboardBanner />
    </div>
  );
}
