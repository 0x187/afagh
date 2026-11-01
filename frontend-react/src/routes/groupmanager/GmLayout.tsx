import { useQuery } from '@tanstack/react-query';
import { BookOpen, CalendarRange, DoorOpen, GitBranch, GraduationCap, ListChecks, ShieldQuestion, UserCog } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { getGmMe } from '@/lib/groupmanager-api';

// ═══ Group manager panel shell ═══

const NAV = [
  { to: '/group-manager/courses', label: 'دروس گروه', icon: BookOpen },
  { to: '/group-manager/offerings', label: 'ارائه‌ها و برنامه', icon: CalendarRange },
  { to: '/group-manager/classrooms', label: 'کلاس‌ها', icon: DoorOpen },
  { to: '/group-manager/grants', label: 'تخصیص درس', icon: ListChecks },
  { to: '/group-manager/compensatory', label: 'دانشجویان جبرانی', icon: UserCog },
  { to: '/group-manager/bypass', label: 'درخواست‌های بایپس', icon: ShieldQuestion },
  { to: '/group-manager/equivalence', label: 'معادل‌سازی', icon: GitBranch },
];

export function GmLayout({ children }: { children: React.ReactNode }) {
  const { data, isLoading, isError, error } = useQuery({ queryKey: ['gm-me'], queryFn: getGmMe, staleTime: 60_000 });
  const location = useLocation();

  if (isLoading) return <Skeleton className="h-48 w-full" />;
  if (isError || !data) {
    return (
      <Card className="border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40">
        <CardContent className="space-y-2 p-6 text-xs text-amber-900 dark:text-amber-100">
          <p className="text-sm font-black">دسترسی به پنل مدیر گروه ممکن نیست</p>
          <p className="leading-6">
            {(error as Error)?.message ??
              'پروندهٔ کارمندی شما به گروه آموزشی وصل نیست. از مدیر سامانه بخواهید در پنل «گروه‌های آموزشی و مدیران گروه» وضعیت شما را اصلاح کند.'}
          </p>
          <Link to="/" className="inline-block rounded-lg border border-amber-300 bg-white px-3 py-1.5 font-bold text-amber-900 hover:bg-amber-100">
            بازگشت به کارتابل من
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="border-0 bg-gradient-to-l from-teal-800 to-emerald-700 text-white">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div className="flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-2xl bg-white/15">
              <GraduationCap className="size-5" aria-hidden />
            </span>
            <div>
              <h1 className="text-base font-black">پنل مدیر گروه</h1>
              <p className="mt-0.5 text-xs text-emerald-100">
                {data.dept.name} · {data.staff.name}
                {data.depts.length > 1 ? ` — ${data.depts.length} گروه تحت مدیریت` : ''}
              </p>
            </div>
          </div>
          <span className="rounded-full bg-white/15 px-3 py-1 text-[11px] font-bold">{data.dept.via === 'HEAD' ? 'مدیر گروه' : 'عضو گروه'}</span>
        </CardContent>
      </Card>

      <nav className="flex flex-wrap gap-1.5 rounded-xl border border-border bg-card p-2 shadow-xs">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = location.pathname === item.to;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition ${active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
            >
              <Icon className="size-3.5" aria-hidden /> {item.label}
            </Link>
          );
        })}
      </nav>

      {children}
    </div>
  );
}
