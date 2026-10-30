import { useQuery } from '@tanstack/react-query';
import {
  BellRing,
  BookOpenCheck,
  CalendarRange,
  ClipboardList,
  CreditCard,
  GraduationCap,
  Landmark,
  ListChecks,
  Settings,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits, faNumber } from '@/lib/fa';
import { getAdminDashboard } from '@/lib/admin-api';

// ═══ داشبورد ادمین — پورت admin/page.tsx (خلاصه) ═══

const STATUS_FA: Record<string, string> = {
  SUBMITTED: 'ثبت‌شده', IN_REVIEW: 'در بررسی', APPROVED: 'تأییدشده', REJECTED: 'ردشده', RETURNED: 'بازگشتی',
};

const MODULES = [
  { to: '/admin/students', label: 'مدیریت دانشجویان', icon: Users, tone: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' },
  { to: '/admin/offerings', label: 'ارائه‌ها و کلاس‌ها', icon: CalendarRange, tone: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300' },
  { to: '/admin/weekly-board', label: 'تختهٔ هفتگی', icon: CalendarRange, tone: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300' },
  { to: '/admin/grade-status-codes', label: 'وضعیت نمرات', icon: BookOpenCheck, tone: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300' },
  { to: '/admin/evaluations', label: 'ارزشیابی اساتید', icon: GraduationCap, tone: 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300' },
  { to: '/admin/finance', label: 'امور مالی', icon: CreditCard, tone: 'bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300' },
  { to: '/admin/payroll', label: 'حقوق و دستمزد', icon: Landmark, tone: 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300' },
  { to: '/admin/workflows', label: 'گردش‌کار', icon: ClipboardList, tone: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300' },
  { to: '/admin/warnings', label: 'هشدارهای زمان‌بندی‌شده', icon: BellRing, tone: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300' },
  { to: '/admin/departments', label: 'دانشکده‌ها و گروه‌ها', icon: ListChecks, tone: 'bg-lime-100 text-lime-700 dark:bg-lime-950 dark:text-lime-300' },
  { to: '/admin/staff', label: 'کارکنان و اساتید', icon: ShieldCheck, tone: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
  { to: '/admin/settings', label: 'تنظیمات سامانه', icon: Settings, tone: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300' },
];

export function AdminDashboardPage() {
  const { data, isLoading, isError } = useQuery({ queryKey: ['admin-dashboard'], queryFn: getAdminDashboard, staleTime: 20_000 });

  if (isLoading) {
    return <div className="space-y-4"><Skeleton className="h-28 w-full" /><Skeleton className="h-64 w-full" /></div>;
  }
  if (isError || !data) {
    return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت داشبورد مدیریت ناموفق بود.</CardContent></Card>;
  }

  return (
    <div className="space-y-4">
      <Card className="border-0 bg-gradient-to-l from-slate-900 via-indigo-900 to-slate-800 text-white">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <p className="text-[11px] text-indigo-200">پنل مدیریت — {data.universityTitle}</p>
            <h1 className="mt-1 text-lg font-black">نمای کلی سامانه</h1>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px]">
            <span className="rounded-lg bg-white/10 px-2.5 py-1.5">صف ثبت‌نام: {faNumber(data.queueLength)}</span>
            <span className="rounded-lg bg-white/10 px-2.5 py-1.5">ظرفیت گرم‌شده: {faNumber(data.warmedOfferings)}</span>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ['دانشجویان', data.stats.studentsTotal, `${faNumber(data.stats.studentsActive)} فعال`],
          ['ارائه‌های ترم', data.stats.offerings, 'فعال'],
          ['ثبت‌نام‌ها', data.stats.enrollments, 'ترم جاری'],
          ['درخواست‌ها', data.stats.requestsTotal, `${faNumber(data.stats.requestsOpen)} باز`],
          ['صف ثبت‌نام', data.queueLength, 'Redis'],
          ['ظرفیت گرم', data.warmedOfferings, 'کلاس'],
        ].map(([label, value, hint]) => (
          <Card key={String(label)}>
            <CardContent className="p-3 text-center">
              <p className="font-mono text-xl font-black">{faNumber(Number(value))}</p>
              <p className="mt-0.5 text-[11px] font-bold">{label}</p>
              <p className="text-[10px] text-muted-foreground">{hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-6">
        {MODULES.map((m) => {
          const Icon = m.icon;
          return (
            <Link key={m.to} to={m.to} className="rounded-xl border border-border bg-card p-3 shadow-xs transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
              <span className={`flex size-9 items-center justify-center rounded-xl ${m.tone}`}><Icon className="size-4.5" aria-hidden /></span>
              <p className="mt-2 text-[11px] font-black">{m.label}</p>
            </Link>
          );
        })}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">کارتابل درخواست‌ها</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {data.inbox.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">درخواستی ثبت نشده است.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-right text-[11px]">
                  <thead><tr className="border-b border-border text-muted-foreground"><th className="p-1.5">کد رهگیری</th><th className="p-1.5">دانشجو</th><th className="p-1.5">فرایند</th><th className="p-1.5">وضعیت</th></tr></thead>
                  <tbody>
                    {data.inbox.map((r) => (
                      <tr key={r.id} className="border-b border-border/50 last:border-0">
                        <td className="p-1.5 font-mono" dir="ltr">{r.trackingCode}</td>
                        <td className="p-1.5">{r.studentName} <span className="text-muted-foreground" dir="ltr">{faDigits(r.studentCode)}</span></td>
                        <td className="p-1.5">{r.processTitle ?? '—'}</td>
                        <td className="p-1.5"><Badge variant="secondary" className="text-[10px]">{STATUS_FA[r.status] ?? r.status}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">فعالیت زندهٔ نمرات (۳۰ دقیقه)</CardTitle></CardHeader>
          <CardContent className="space-y-1.5">
            {data.gradeLive.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">تغییر نمره‌ای در ۳۰ دقیقهٔ اخیر ثبت نشده است.</p>
            ) : (
              data.gradeLive.map((g, i) => (
                <div key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 px-2 py-1.5 text-[11px]">
                  <span><b>{g.actor}</b> — {g.course ?? '—'} (<span className="font-mono" dir="ltr">{g.studentCode ?? '—'}</span>)</span>
                  <span className="font-mono font-bold">{g.grade ?? '—'}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
