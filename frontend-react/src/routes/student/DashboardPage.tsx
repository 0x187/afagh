import { useQuery } from '@tanstack/react-query';
import {
  CalendarDays,
  ClipboardList,
  FolderOpen,
  GraduationCap,
  IdCard,
  Map,
  MonitorPlay,
  Printer,
  ScrollText,
  ShoppingCart,
  TriangleAlert,
  UserRound,
} from 'lucide-react';
import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits, faNumber, faRial } from '@/lib/fa';
import { getStudentDashboard } from '@/lib/student-api';

// ═══ Student dashboard — port of student/page.tsx ═══

type QuickLink = {
  to: string;
  label: string;
  hint: string;
  badge?: string;
  icon: typeof ShoppingCart;
  tone: string;
};

const QUICK_LINKS: QuickLink[] = [
  { to: '/student/enroll', label: 'انتخاب واحد', hint: 'کنترل هم‌نیازی، پیش‌نیازی و تداخل', icon: ShoppingCart, tone: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' },
  { to: '/student/exam-card', label: 'کارت آزمون', hint: 'ارزشیابی استاد و چاپ برگه A4', icon: IdCard, tone: 'bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300' },
  { to: '/student/enroll-confirm', label: 'تأییدیه', hint: 'چاپ برگه با QR استعلام اصالت', icon: Printer, tone: 'bg-lime-100 text-lime-700 dark:bg-lime-950 dark:text-lime-300' },
  { to: '/student/transcript', label: 'کارنامه', hint: 'محاسبه آیین‌نامه‌ای و حذف مردودی', badge: 'رسمی', icon: ScrollText, tone: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300' },
  { to: '/student/virtual-classes', label: 'کلاس آنلاین', hint: 'ورود مستقیم به جلسات مجازی LMS', badge: 'BBB زنده', icon: MonitorPlay, tone: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300' },
  { to: '/student/schedule', label: 'برنامه و آزمون', hint: 'شماره کلاس، ساختمان و ساعت آزمون', badge: 'تقویم شمسی', icon: CalendarDays, tone: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300' },
  { to: '/student/requests', label: 'میز خدمات', hint: 'درخواست مرخصی، حذف ترم و کمیسیون', icon: ClipboardList, tone: 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300' },
  { to: '/student/chart', label: 'چارت درسی', hint: 'دروس پایه، اصلی، تخصصی و عمومی', icon: Map, tone: 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300' },
  { to: '/student/documents', label: 'مدارک', hint: 'مدرک دیپلم، کارت ملی و تعهدنامه', icon: FolderOpen, tone: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
];

function faDate(value: string | null): string {
  if (!value) return '—';
  return faDigits(value.replace(/-/g, '/'));
}

export function StudentDashboardPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['student-dashboard'],
    queryFn: () => getStudentDashboard(),
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-40 w-full" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-52 w-full" />
          <Skeleton className="h-52 w-full" />
        </div>
      </div>
    );
  }
  if (isError || !data) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          دریافت داشبورد ناموفق بود. لطفاً دوباره تلاش کنید.
        </CardContent>
      </Card>
    );
  }

  const s = data.student;

  return (
    <div className="space-y-5">
      {/* Student ID card */}
      <Card className="overflow-hidden border-0 bg-gradient-to-l from-indigo-700 via-indigo-600 to-sky-600 text-white shadow-lg">
        <CardContent className="flex flex-wrap items-center gap-4 p-5">
          <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25">
            <GraduationCap className="size-7" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-black">{s.name}</h1>
              <Badge className="border-transparent bg-white/15 text-white">
                {s.majorName} — {s.degreeTitle}
              </Badge>
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-white/85">
              <span>شماره دانشجویی: <b className="font-mono">{faDigits(s.studentCode)}</b></span>
              <span>ترم: <b>{faDigits(s.currentTermNo)}</b></span>
              <span>نیمسال: <b>{data.term.title}</b></span>
            </p>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            {data.isFinancialCleared ? (
              <Badge className="border-transparent bg-emerald-400/20 text-emerald-50">تسویهٔ مالی ✓</Badge>
            ) : (
              <Badge className="border-transparent bg-rose-500/90 text-white">
                بدهی: {faRial(data.debtRials)}
              </Badge>
            )}
            <span className="text-[11px] text-white/70">{data.university.title}</span>
          </div>
        </CardContent>
      </Card>

      {!data.isFinancialCleared ? (
        <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            تسویهٔ مالی انجام نشده است؛ صدور کارت ورود به جلسه و برخی خدمات آموزشی تا پرداخت بدهی
            ({faRial(data.debtRials)}) ممکن نیست.
          </p>
        </div>
      ) : null}

      {/* Quick links */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-black text-foreground">
            <UserRound className="size-4 text-primary" aria-hidden />
            دسترسی سریع به درگاه‌ها و خدمات آموزشی
          </h2>
          <span className="text-[11px] font-bold text-muted-foreground">سامانهٔ یکپارچهٔ آفاق</span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {QUICK_LINKS.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className="group rounded-2xl border border-border bg-card p-3.5 shadow-xs transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
              >
                <div className="flex items-start justify-between">
                  <span className={`flex size-10 items-center justify-center rounded-xl ${item.tone}`}>
                    <Icon className="size-5" aria-hidden />
                  </span>
                  {item.badge ? (
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold text-secondary-foreground">
                      {item.badge}
                    </span>
                  ) : null}
                </div>
                <h3 className="mt-3 text-sm font-black text-foreground">{item.label}</h3>
                <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">{item.hint}</p>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Virtual classes + upcoming exams */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-2 border-b border-border/70 pb-3">
            <div className="flex items-center gap-2">
              <span className="flex size-9 items-center justify-center rounded-xl bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300">
                <MonitorPlay className="size-4.5" aria-hidden />
              </span>
              <div>
                <CardTitle className="text-sm">کلاس‌های آنلاین و جلسات وبینار LMS</CardTitle>
                <p className="text-[11px] text-muted-foreground">اتصال مستقیم به سرور BigBlueButton دانشگاه</p>
              </div>
            </div>
            <Link to="/student/virtual-classes" className="shrink-0 rounded-lg bg-sky-50 px-2.5 py-1 text-[11px] font-bold text-sky-700 hover:bg-sky-100 dark:bg-sky-950 dark:text-sky-300">
              همه جلسات ←
            </Link>
          </CardHeader>
          <CardContent className="space-y-2.5 pt-4">
            {data.virtualClasses.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">
                جلسهٔ کلاس مجازی برای دروس این نیمسال ثبت نشده است.
              </p>
            ) : (
              data.virtualClasses.map((vc) => (
                <div
                  key={vc.id}
                  className={`flex items-center justify-between gap-3 rounded-xl border p-3 ${
                    vc.isRunning
                      ? 'border-sky-200 bg-gradient-to-l from-sky-50 to-indigo-50/60 dark:border-sky-900 dark:from-sky-950/60 dark:to-indigo-950/40'
                      : 'border-border bg-muted/40'
                  }`}
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className={`size-2 shrink-0 rounded-full ${vc.isRunning ? 'animate-pulse bg-emerald-500' : 'bg-amber-400'}`} />
                      <strong className="truncate text-xs font-black">{vc.courseTitle}</strong>
                      {vc.isRunning ? (
                        <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
                          در حال برگزاری
                        </span>
                      ) : null}
                    </div>
                    <p className="truncate text-[11px] text-muted-foreground">
                      استاد: {vc.professor} · اتاق مجازی: <span dir="ltr">{vc.meetingId}</span>
                      {vc.isRunning && vc.currentAttendanceCount > 0
                        ? ` · ${faNumber(vc.currentAttendanceCount)} شرکت‌کننده`
                        : ''}
                    </p>
                  </div>
                  <Link
                    to="/student/virtual-classes"
                    className="shrink-0 rounded-xl bg-sky-600 px-3.5 py-1.5 text-xs font-black text-white shadow-xs transition hover:bg-sky-700"
                  >
                    ورود
                  </Link>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between gap-2 border-b border-border/70 pb-3">
            <div className="flex items-center gap-2">
              <span className="flex size-9 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                <CalendarDays className="size-4.5" aria-hidden />
              </span>
              <div>
                <CardTitle className="text-sm">برنامهٔ امتحانات پایان‌ترم و شمارهٔ صندلی</CardTitle>
                <p className="text-[11px] text-muted-foreground">همراه داشتن کارت آزمون چاپ‌شده و کارت ملی الزامی است</p>
              </div>
            </div>
            <Link to="/student/exam-card" className="shrink-0 rounded-lg bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950 dark:text-emerald-300">
              کارت آزمون ←
            </Link>
          </CardHeader>
          <CardContent className="space-y-2.5 pt-4">
            {data.upcomingExams.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">
                زمان‌بندی امتحانی برای این نیمسال ثبت نشده است.
              </p>
            ) : (
              data.upcomingExams.map((ex) => (
                <div
                  key={ex.code}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 p-3 text-xs transition hover:bg-emerald-50/50 dark:hover:bg-emerald-950/20"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="truncate font-black">{ex.title}</div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                      <span>📅 {faDate(ex.examDate)}</span>
                      {ex.examTime ? <span>⏰ {faDigits(ex.examTime)}</span> : null}
                      {ex.room ? <span>🏛️ {ex.room}</span> : null}
                    </div>
                  </div>
                  {ex.seatNumber != null ? (
                    <span className="shrink-0 rounded-lg bg-indigo-950 px-2.5 py-1 font-mono text-xs font-black text-white">
                      صندلی {faDigits(ex.seatNumber)}
                    </span>
                  ) : (
                    <span className="shrink-0 rounded-lg bg-secondary px-2.5 py-1 text-xs font-bold text-secondary-foreground">
                      بدون صندلی
                    </span>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
