import Link from 'next/link';
import {
  DEMO_CHART,
  DEMO_CURRICULUM_TOTAL_UNITS_TEXT,
  DEMO_DASHBOARD,
  DEMO_DASHBOARD_LIVE_CLASSES,
  DEMO_EXAM,
  DEMO_FINANCE,
  DEMO_STUDENT,
  demoTermFilterNotice,
} from '@/lib/demo-student-data';

const fa = (n: number | string) => Number(n || 0).toLocaleString('fa-IR');

const DEMO_QUICK_ACTIONS = [
  { href: '/student/enroll', icon: '🛒', badge: 'صفحه Redis', title: 'انتخاب واحد هوشمند', subtitle: 'کنترل هم‌نیازی، پیش‌نیازی و تداخل' },
  { href: '/student/exam-card', icon: '📇', badge: 'QR Code', title: 'کارت آزمون و صندلی', subtitle: 'ارزشیابی استاد و چاپ برگه A4' },
  { href: '/student/transcript', icon: '📜', badge: 'رسمی', title: 'کارنامه کل تحصیلی', subtitle: 'محاسبه آیین‌نامه‌ای و حذف مردودی' },
  { href: '/student/virtual-classes', icon: '💻', badge: 'BBB زنده', title: 'کلاس آنلاین و وبینار', subtitle: 'ورود مستقیم به جلسات مجازی LMS' },
  { href: '/student/schedule', icon: '📅', badge: 'تقویم شمسی', title: 'برنامه هفتگی و امتحانات', subtitle: 'شماره کلاس، ساختمان و ساعت آزمون' },
  { href: '/student/requests', icon: '📋', badge: 'سجاد BPM', title: 'میز خدمات و کمیسیون', subtitle: 'درخواست مرخصی، حذف ترم و کمیسیون' },
  { href: '/student/chart', icon: '🗺️', badge: 'سرفصل‌ها', title: 'چارت درسی مصوب', subtitle: 'دروس پایه، اصلی، تخصصی و عمومی' },
  { href: '/student/documents', icon: '📁', badge: 'بایگانی', title: 'مدارک و بایگانی پرونده', subtitle: 'مدرک دیپلم، کارت ملی و تعهدنامه' },
];

function TermNotice({ title }: { title: string }) {
  return (
    <p className="card p-4 text-center text-xs text-slate-600">{demoTermFilterNotice(title)}</p>
  );
}

export function DemoDashboard({
  name,
  filteredTermTitle,
}: {
  name: string;
  filteredTermTitle: string | null;
}) {
  const termTitle = filteredTermTitle ? null : DEMO_STUDENT.termTitle;

  return (
    <div className="space-y-6 animate-in fade-in">
      {filteredTermTitle ? (
        <>
          <TermNotice title={filteredTermTitle} />
        </>
      ) : (
        <>
          <div className="card bg-gradient-to-r from-emerald-900 via-teal-900 to-slate-900 text-white p-6 sm:p-7 rounded-3xl shadow-xl border border-emerald-700/40 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
            <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div className="flex items-center gap-4 sm:gap-5">
                <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-600 text-slate-950 flex items-center justify-center font-black text-3xl shadow-lg border-2 border-white/20">
                  {(name || DEMO_STUDENT.fullName).slice(0, 1) || 'د'}
                </div>
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-xl sm:text-2xl font-black tracking-tight">{name || DEMO_STUDENT.fullName}</h1>
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-emerald-400 text-slate-950 shadow-xs">
                      {DEMO_STUDENT.statusFa}
                    </span>
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-white/15 text-emerald-100 border border-white/20">
                      ترم تحصیلی
                    </span>
                  </div>
                  <p className="text-xs sm:text-sm text-emerald-200 font-medium">
                    {DEMO_STUDENT.majorName} · {DEMO_STUDENT.degreeTitle} · ورودی سال {DEMO_STUDENT.entryYearFa}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-emerald-300/90 pt-1 font-mono">
                    <span>
                      شماره دانشجویی:{' '}
                      <strong className="text-white font-bold font-mono" dir="ltr">
                        {DEMO_STUDENT.studentCode}
                      </strong>
                    </span>
                    <span>
                      کد ملی:{' '}
                      <strong className="text-white font-bold font-mono" dir="ltr">
                        {DEMO_STUDENT.nationalCode}
                      </strong>
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap md:flex-col items-start md:items-end gap-2 text-xs">
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/20 border border-emerald-400/30 text-emerald-200 font-bold">
                  <span>💳 وضعیت مالی:</span>
                  <span className="text-white font-black">{DEMO_DASHBOARD.financialStatusText}</span>
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-teal-500/20 border border-teal-400/30 text-teal-200 font-bold">
                  <span>🪪 نظام وظیفه (سخا):</span>
                  <span className="text-white font-black">{DEMO_STUDENT.militaryStatus}</span>
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-500/20 border border-indigo-400/30 text-indigo-200 font-bold">
                  <span>🏛️ ترم جاری:</span>
                  <span className="text-white font-black">{termTitle ?? '—'}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 sm:gap-4">
            <div className="card p-4 sm:p-5 bg-white border border-slate-200 rounded-2xl shadow-xs hover:shadow-md transition flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-slate-500">معدل کل تحصیلی (GPA)</span>
                <span className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-700 flex items-center justify-center text-sm font-black">
                  📊
                </span>
              </div>
              <div className="my-2">
                <div className="text-2xl sm:text-3xl font-black text-slate-900 font-mono">
                  {DEMO_DASHBOARD.gpaText}
                </div>
                <p className="text-2xs text-emerald-600 font-bold mt-0.5 flex items-center gap-1">
                  <span>✓</span>
                  <span>{DEMO_DASHBOARD.gpaNote}</span>
                </p>
              </div>
              <Link
                href="/student/transcript"
                className="text-2xs font-bold text-indigo-700 hover:text-indigo-900 flex items-center gap-1 pt-2 border-t border-slate-100"
              >
                <span>مشاهده جزئیات کارنامه</span>
                <span>←</span>
              </Link>
            </div>

            <div className="card p-4 sm:p-5 bg-white border border-slate-200 rounded-2xl shadow-xs hover:shadow-md transition flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-slate-500">واحدهای گذرانده کل</span>
                <span className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center text-sm font-black">
                  📚
                </span>
              </div>
              <div className="my-2">
                <div className="text-2xl sm:text-3xl font-black text-slate-900 font-mono">
                  {DEMO_DASHBOARD.passedUnitsText}{' '}
                  <span className="text-sm font-bold text-slate-400">/ {DEMO_DASHBOARD.requiredUnitsText}</span>
                </div>
                <p className="text-2xs text-slate-500 font-bold mt-0.5">{DEMO_DASHBOARD.chartProgressText}</p>
              </div>
              <Link
                href="/student/chart"
                className="text-2xs font-bold text-emerald-700 hover:text-emerald-900 flex items-center gap-1 pt-2 border-t border-slate-100"
              >
                <span>مشاهده چارت و سرفصل‌ها</span>
                <span>←</span>
              </Link>
            </div>

            <div className="card p-4 sm:p-5 bg-white border border-slate-200 rounded-2xl shadow-xs hover:shadow-md transition flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-slate-500">واحدهای ترم جاری</span>
                <span className="w-8 h-8 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center text-sm font-black">
                  🛒
                </span>
              </div>
              <div className="my-2">
                <div className="text-2xl sm:text-3xl font-black text-slate-900 font-mono">
                  {fa(DEMO_DASHBOARD.currentTermUnits)}{' '}
                  <span className="text-sm font-bold text-slate-400">واحد</span>
                </div>
                <p className="text-2xs text-emerald-700 font-bold mt-0.5">
                  {DEMO_DASHBOARD.currentTermCourseCountText} عنوان درسی ثبت قطعی
                </p>
              </div>
              <Link
                href="/student/schedule"
                className="text-2xs font-bold text-amber-700 hover:text-amber-900 flex items-center gap-1 pt-2 border-t border-slate-100"
              >
                <span>برنامه هفتگی و ساعات کلاس</span>
                <span>←</span>
              </Link>
            </div>

            <div className="card p-4 sm:p-5 bg-white border border-slate-200 rounded-2xl shadow-xs hover:shadow-md transition flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-slate-500">کارت آزمون و شماره صندلی</span>
                <span className="w-8 h-8 rounded-xl bg-rose-50 text-rose-700 flex items-center justify-center text-sm font-black">
                  📇
                </span>
              </div>
              <div className="my-2">
                <div className="text-base sm:text-lg font-black text-emerald-800 flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                  <span>{DEMO_EXAM.statusText}</span>
                </div>
                <p className="text-2xs text-slate-500 font-bold mt-0.5">{DEMO_DASHBOARD.examCardSeatNoteText}</p>
              </div>
              <Link
                href="/student/exam-card"
                className="text-2xs font-bold text-rose-700 hover:text-rose-900 flex items-center gap-1 pt-2 border-t border-slate-100"
              >
                <span>دریافت و چاپ کارت امتحان</span>
                <span>←</span>
              </Link>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-black text-slate-900 text-sm sm:text-base flex items-center gap-2">
                <span>⚡ دسترسی سریع به درگاه‌ها و خدمات آموزشی</span>
              </h2>
              <span className="text-xs text-slate-500 font-bold">سامانه یکپارچه آفاق</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
              {DEMO_QUICK_ACTIONS.map(a => (
                <Link
                  key={a.href}
                  href={a.href}
                  className="card p-4 bg-white hover:bg-emerald-50/50 border border-slate-200 hover:border-emerald-300 rounded-2xl shadow-xs transition-all group flex flex-col justify-between"
                >
                  <div className="flex items-start justify-between">
                    <div className="w-11 h-11 rounded-2xl bg-emerald-100 text-emerald-800 flex items-center justify-center text-xl group-hover:scale-110 transition-transform">
                      {a.icon}
                    </div>
                    <span className="text-3xs bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full font-bold">
                      {a.badge}
                    </span>
                  </div>
                  <div className="mt-3">
                    <h3 className="font-black text-slate-900 text-xs sm:text-sm">{a.title}</h3>
                    <p className="text-2xs text-slate-500 mt-0.5 line-clamp-1">{a.subtitle}</p>
                  </div>
                </Link>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5">
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
                {DEMO_DASHBOARD_LIVE_CLASSES.map(vc => (
                  <div
                    key={vc.meetingId}
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
                        <span
                          className={`text-3xs font-bold px-1.5 py-0.5 rounded ${
                            vc.isRunning ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'
                          }`}
                        >
                          {vc.stateText}
                        </span>
                      </div>
                      <p className="text-2xs text-slate-600">
                        استاد: {vc.professorName}
                        {vc.timeText ? ` · ${vc.timeText}` : ''}
                        {vc.participantsText ? ` (${vc.participantsText})` : ''}
                        {` · اتاق مجازی: ${vc.meetingId}`}
                      </p>
                    </div>
                    <Link
                      href="/student/virtual-classes"
                      className="px-3.5 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-black text-xs shadow-xs transition active:scale-95 whitespace-nowrap"
                    >
                      ورود به کلاس
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function DemoChart({ filteredTermTitle }: { filteredTermTitle: string | null }) {
  return (
    <div className="student-chart-print space-y-4">
      {filteredTermTitle ? (
        <>
          <TermNotice title={filteredTermTitle} />
        </>
      ) : (
        <>
          {/* هدر چاپی: دانشگاه + مشخصات دانشجو — فقط روی کاغذ */}
          <div className="chart-print-header hidden print:!block border-b-2 border-slate-800 pb-2 text-center">
            <div className="t">دانشگاه آفاق</div>
            <div>
              چارت تحصیلی — نام و نام خانوادگی: {DEMO_STUDENT.fullName} · شمارهٔ دانشجویی: {DEMO_STUDENT.studentCode}
            </div>
            <div>
              رشته: {DEMO_STUDENT.majorName} · مقطع: {DEMO_STUDENT.degreeTitle} · سال ورود: {DEMO_STUDENT.entryYearFa}
            </div>
            <div>☑ = درس گذرانده‌شده · ☐ = پاس‌نشده</div>
          </div>
          <div className="card !p-4 bg-gradient-to-r from-emerald-800 to-teal-900 text-white border-0 shadow-md print:hidden">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-base font-extrabold">🗺️ چارت تحصیلی و کاتالوگ سرفصل دروس مصوب</h1>
                <p className="text-xs text-emerald-200 mt-0.5">
                  رشته: {DEMO_STUDENT.majorName} — مقطع: {DEMO_STUDENT.degreeTitle} (مجموع{' '}
                  {DEMO_CURRICULUM_TOTAL_UNITS_TEXT})
                </p>
              </div>
              <Link
                href="/student/enroll"
                className="text-xs bg-white text-emerald-900 font-bold px-3 py-2 rounded-xl hover:bg-emerald-50 transition-colors shadow-sm inline-flex items-center gap-1.5"
              >
                <span>🛒</span>
                <span>ورود به انتخاب واحد</span>
              </Link>
            </div>
          </div>

          <div className="space-y-4">
            {DEMO_CHART.map(sem => {
              const semUnits = sem.courses.reduce((sum, c) => sum + c.units, 0);
              return (
                <div key={sem.semester} className="card !p-4 bg-white border border-slate-200 shadow-sm space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-extrabold text-slate-800 text-sm">{sem.title}</span>
                      <span className="text-2xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-mono">
                        {fa(semUnits)} واحد
                      </span>
                    </div>
                    {sem.semester === 2 && (
                      <Link
                        href="/student/enroll"
                        className="text-2xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 px-2.5 py-1 rounded-lg transition-colors print:hidden"
                      >
                        ⚡ انتخاب هوشمند این ترم
                      </Link>
                    )}
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-right text-xs rt">
                      <thead>
                        <tr className="bg-slate-50 text-slate-500 border-b border-slate-200">
                          <th className="p-2 text-center w-8" title="تیک گذرانده‌ها">✓</th>
                          <th className="p-2">کد درس</th>
                          <th className="p-2">عنوان درس</th>
                          <th className="p-2 text-center">واحد</th>
                          <th className="p-2">نوع</th>
                          <th className="p-2">پیش‌نیازها</th>
                          <th className="p-2 text-left">وضعیت شما</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sem.courses.map(c => (
                          <tr key={c.code} className="border-b border-slate-100 hover:bg-slate-50">
                            <td className="p-2 text-center">
                              {/* تیک: ترم ۱ دمو گذرانده شده؛ بقیه خالی */}
                              {sem.semester === 1 ? (
                                <span className="text-emerald-700 font-black text-base leading-none" title="گذرانده‌شده">☑</span>
                              ) : (
                                <span className="text-slate-400 text-base leading-none" title="پاس‌نشده">☐</span>
                              )}
                            </td>
                            <td className="p-2 font-mono text-slate-600" dir="ltr">
                              {c.code}
                            </td>
                            <td className="p-2 font-semibold text-slate-900">{c.title}</td>
                            <td className="p-2 text-center font-mono font-bold">{c.units}</td>
                            <td className="p-2 text-slate-600">{c.type}</td>
                            <td className="p-2 text-slate-500">{c.prereq}</td>
                            <td className="p-2 text-left">
                              {sem.semester === 1 ? (
                                <span className="inline-block px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-3xs">
                                  ✅ گذرانده‌شده
                                </span>
                              ) : sem.semester === 2 ? (
                                <span className="inline-block px-2.5 py-0.5 rounded-full bg-sky-100 text-sky-800 font-bold text-3xs">
                                  ⏳ ترم جاری (پیشنهادی)
                                </span>
                              ) : (
                                <span className="inline-block px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-500 font-medium text-3xs">
                                  🔒 ترم‌های بعد
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="rounded-xl bg-amber-50/80 p-3.5 text-xs text-amber-900 border border-amber-200">
            💡 <b>راهنمای سرفصل:</b> بر اساس چارت مصوب رشته، در صورت تمایل به اخذ دروس ترم‌های بالاتر، رعایت تمامی پیش‌نیازها و
            سقف واحدهای ترم الزامی است.
          </div>
        </>
      )}
    </div>
  );
}

export function DemoFinance({ filteredTermTitle }: { filteredTermTitle: string | null }) {
  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div>
          <h1 className="font-extrabold text-slate-800 text-base sm:text-lg">💳 امور مالی من</h1>
          <p className="text-xs text-slate-500 mt-1">کارنامهٔ مالی ترم‌به‌ترم، چک‌ها و وام‌ها</p>
        </div>
      </div>

      {filteredTermTitle ? (
        <TermNotice title={filteredTermTitle} />
      ) : (
        <>
          <div className="print-area space-y-4">
            <div className="card">
              <div className="mb-3 border-b border-slate-100 pb-2 text-center">
                <h2 className="font-extrabold text-slate-800">کارنامهٔ مالی دانشجو</h2>
                <p className="text-2xs text-slate-500 mt-0.5">دانشگاه آزاد اسلامی — واحد ممسنی</p>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
                <div>
                  <span className="text-slate-500">نام و نام خانوادگی: </span>
                  <span className="font-medium text-slate-800">{DEMO_FINANCE.fullName}</span>
                </div>
                <div>
                  <span className="text-slate-500">شمارهٔ دانشجویی: </span>
                  <span className="font-medium text-slate-800">{DEMO_FINANCE.studentCode}</span>
                </div>
                <div>
                  <span className="text-slate-500">کد ملی: </span>
                  <span className="font-medium text-slate-800" dir="ltr">
                    {DEMO_FINANCE.nationalCode}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">رشته: </span>
                  <span className="font-medium text-slate-800">{DEMO_FINANCE.majorTitle}</span>
                </div>
                <div>
                  <span className="text-slate-500">مقطع: </span>
                  <span className="font-medium text-slate-800">{DEMO_FINANCE.degreeTitle}</span>
                </div>
                <div>
                  <span className="text-slate-500">ورودی: </span>
                  <span className="font-medium text-slate-800">{DEMO_FINANCE.entryYear}</span>
                </div>
              </div>
            </div>

            <div className="card">
              <h3 className="mb-2 border-b border-slate-100 pb-2 font-bold text-slate-800">جمع کل دوره</h3>
              <div className="grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
                <div>
                  <p className="text-lg font-bold text-slate-800">{fa(DEMO_FINANCE.balance)}</p>
                  <p className="text-2xs text-slate-500">جمع شهریه (ریال)</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-violet-700">{fa(0)}</p>
                  <p className="text-2xs text-slate-500">تخفیف‌ها</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-indigo-700">{fa(0)}</p>
                  <p className="text-2xs text-slate-500">پوشش بنیادها</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-emerald-700">{fa(0)}</p>
                  <p className="text-2xs text-slate-500">پرداخت / وام / چک وصولی</p>
                </div>
              </div>
              <div className="mt-3 rounded-lg bg-slate-50 p-3 text-center">
                <p className="text-xl font-extrabold text-emerald-700">{fa(DEMO_FINANCE.balance)} ریال</p>
                <p className="text-2xs text-slate-600">{DEMO_FINANCE.settledLabel}</p>
              </div>
            </div>

            <div className="card">
              <h3 className="mb-2 border-b border-slate-100 pb-2 font-bold text-slate-800">ریز ترم‌به‌ترم</h3>
              <p className="py-6 text-center text-xs text-slate-500">{DEMO_FINANCE.emptyNote}</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}