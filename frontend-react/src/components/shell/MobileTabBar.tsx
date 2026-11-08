import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  BookOpenCheck,
  Calculator,
  CalendarDays,
  CalendarRange,
  ClipboardCheck,
  ClipboardList,
  Clock,
  CreditCard,
  FileText,
  FolderOpen,
  GraduationCap,
  IdCard,
  Landmark,
  LayoutDashboard,
  Map,
  Megaphone,
  Menu,
  MonitorPlay,
  Printer,
  ScrollText,
  ShoppingCart,
  Target,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';

import { ADMIN_MODULES, canSeeModule } from '@/routes/admin/admin-modules';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

// Mobile bottom navigation for student/professor/admin shells, ported from
// StudentNav/ProfessorNav. Shows five frequent destinations plus a menu button
// that opens the full destination list in a bottom sheet.

type Tab = { to: string; label: string; icon: typeof LayoutDashboard | string; exact?: boolean };

const STUDENT_TABS: Tab[] = [
  { to: '/student', label: 'داشبورد', icon: LayoutDashboard, exact: true },
  { to: '/student/enroll', label: 'انتخاب واحد', icon: ShoppingCart },
  { to: '/student/requests', label: 'میز خدمات', icon: ClipboardList },
  { to: '/student/transcript', label: 'کارنامه', icon: ScrollText },
  { to: '/student/finance', label: 'امور مالی', icon: CreditCard },
];

const STUDENT_MENU: Tab[] = [
  { to: '/student', label: 'داشبورد هوشمند', icon: LayoutDashboard, exact: true },
  { to: '/student/schedule', label: 'برنامه هفتگی و آزمون', icon: CalendarDays },
  { to: '/student/enroll', label: 'انتخاب واحد', icon: ShoppingCart },
  { to: '/student/enroll-confirm', label: 'تأییدیهٔ انتخاب واحد', icon: Printer },
  { to: '/student/exam-card', label: 'کارت آزمون و صندلی', icon: IdCard },
  { to: '/student/transcript', label: 'کارنامهٔ کل دوره‌ها', icon: ScrollText },
  { to: '/student/finance', label: 'امور مالی و شهریه', icon: CreditCard },
  { to: '/student/virtual-classes', label: 'کلاس آنلاین و LMS', icon: MonitorPlay },
  { to: '/student/chart', label: 'چارت مصوب سرفصل', icon: Map },
  { to: '/student/requests', label: 'میز خدمات و کمیسیون', icon: ClipboardList },
  { to: '/student/documents', label: 'مدارک و بایگانی', icon: FolderOpen },
  { to: '/student/graduation', label: 'فارغ‌التحصیلی من', icon: GraduationCap },
  { to: '/student/thesis-proposal', label: 'پایان‌نامه و پروپوزال', icon: BookOpenCheck },
];

const PROFESSOR_TABS: Tab[] = [
  { to: '/professor', label: 'داشبورد', icon: LayoutDashboard, exact: true },
  { to: '/professor/schedule', label: 'برنامه', icon: CalendarDays },
  { to: '/professor/attendance', label: 'حضور', icon: ClipboardList },
  { to: '/professor/grades', label: 'نمرات', icon: BookOpenCheck },
];

const PROFESSOR_MENU: Tab[] = [
  { to: '/professor', label: 'داشبورد', icon: LayoutDashboard, exact: true },
  { to: '/professor/schedule', label: 'برنامهٔ هفتگی تدریس', icon: CalendarDays },
  { to: '/professor/attendance', label: 'ثبت حضور و غیاب', icon: ClipboardList },
  { to: '/professor/grades', label: 'بارم‌بندی و ثبت نمرات', icon: BookOpenCheck },
  { to: '/professor/contract', label: 'قرارداد تدریس و مالی', icon: FileText },
  { to: '/professor/availability', label: 'اعلام ساعات حضور ترم', icon: Clock },
  { to: '/professor/performance', label: 'کارنامهٔ عملکرد', icon: TrendingUp },
  { to: '/professor/evaluation', label: 'ارزشیابی دانشجویان', icon: Target },
  { to: '/professor/broadcast', label: 'پیام به کلاس', icon: Megaphone },
  { to: '/professor/documents', label: 'اسناد و امضا', icon: FolderOpen },
  { to: '/professor/payroll', label: 'فیش حقوق', icon: Landmark },
];

const ADMIN_TABS: Tab[] = [
  { to: '/admin', label: 'داشبورد', icon: LayoutDashboard, exact: true },
  { to: '/admin/students', label: 'دانشجویان', icon: Users },
  { to: '/admin/offerings', label: 'ارائه‌ها', icon: CalendarRange },
  { to: '/admin/finance', label: 'مالی', icon: CreditCard },
  { to: '/admin/payroll', label: 'حقوق', icon: Landmark },
];

const ADMIN_MENU_EXTRA: Tab[] = [
  { to: '/admin', label: 'داشبورد مدیریت', icon: LayoutDashboard, exact: true },
  { to: '/admin/attendance-manual', label: 'تأیید دستی حضور استاد', icon: ClipboardCheck },
  { to: '/admin/finance/advanced', label: 'مالی پیشرفته', icon: Wallet },
  { to: '/admin/finance/rules', label: 'تعاریف موتور مالی', icon: Wallet },
  { to: '/admin/finance/time-control', label: 'کنترل زمانی ثبت مالی', icon: Clock },
  { to: '/admin/finance/welfare', label: 'صندوق رفاه', icon: Wallet },
  { to: '/admin/finance/student-formula', label: 'فرمول ویژهٔ دانشجو', icon: Calculator },
  { to: '/admin/tuition/tariff', label: 'تعرفهٔ سالانه', icon: CreditCard },
  { to: '/admin/payroll/roles', label: 'سمت‌های موظفی', icon: Landmark },
  { to: '/admin/payroll/teaching-roles', label: 'نقش‌های تدریس', icon: Landmark },
  { to: '/admin/payroll/decrees', label: 'ابلاغ‌های آموزشی', icon: Landmark },
  { to: '/admin/payroll/regs-objections', label: 'آیین‌نامه/اعتراض حقوق', icon: Landmark },
  { to: '/admin/payroll/operations', label: 'عملیات حقوق', icon: Landmark },
];

function adminMenu(roles: string[]): Tab[] {
  // Registry modules (role-filtered) merged with the sub-pages that are not
  // registry roots, so the mobile menu reaches the full admin surface.
  const items: Tab[] = [
    ...ADMIN_MENU_EXTRA,
    ...ADMIN_MODULES.filter((m) => m.href !== '/admin' && canSeeModule(roles, m)).map((m) => ({
      to: m.href, label: m.title, icon: m.emoji as string | typeof LayoutDashboard,
    })),
  ];
  const seen = new Set<string>();
  const out: Tab[] = [];
  for (const item of items) {
    if (seen.has(item.to)) continue;
    seen.add(item.to);
    out.push(item);
  }
  return out;
}

function sectionOf(pathname: string): 'student' | 'professor' | 'admin' | null {
  if (pathname === '/student' || pathname.startsWith('/student/')) return 'student';
  if (pathname === '/professor' || pathname.startsWith('/professor/')) return 'professor';
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return 'admin';
  return null;
}

function isActive(pathname: string, tab: Tab): boolean {
  return tab.exact ? pathname === tab.to : pathname === tab.to || pathname.startsWith(`${tab.to}/`);
}

const DATA = {
  student: { tabs: STUDENT_TABS, menu: STUDENT_MENU, title: 'منوی دانشجو', aria: 'ناوبری اصلی دانشجو' },
  professor: { tabs: PROFESSOR_TABS, menu: PROFESSOR_MENU, title: 'منوی استاد', aria: 'ناوبری اصلی استاد' },
  admin: { tabs: ADMIN_TABS, menu: [] as Tab[], title: 'منوی مدیریت', aria: 'ناوبری اصلی مدیریت' },
};

/** Fixed mobile tab bar; returns null outside student/professor/admin routes. */
export function MobileTabBar() {
  const { pathname } = useLocation();
  const section = sectionOf(pathname);
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!section) return null;
  const base = DATA[section];
  const data = section === 'admin'
    ? { ...base, menu: adminMenu(session?.user?.roles ?? []) }
    : base;

  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-card text-card-foreground print:hidden md:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)', touchAction: 'manipulation' }}
        aria-label={data.aria}
      >
        <div className="mx-auto flex max-w-md items-stretch justify-around px-1 py-1.5">
          {data.tabs.map((tab) => {
            const active = isActive(pathname, tab);
            const Icon = tab.icon;
            return (
              <Link
                key={tab.to}
                to={tab.to}
                style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
                className={cn(
                  'flex flex-1 flex-col items-center gap-0.5 rounded-xl px-1 py-1 transition active:scale-95',
                  active ? 'bg-primary/10 font-bold text-primary' : 'text-muted-foreground hover:bg-muted',
                )}
              >
                {typeof Icon === 'string'
                  ? <span className="text-base leading-none" aria-hidden>{Icon}</span>
                  : <Icon className="size-5" aria-hidden />}
                <span className="text-[10px] leading-tight text-center">{tab.label}</span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="باز کردن منوی کامل"
            className="flex flex-1 flex-col items-center gap-0.5 rounded-xl px-1 py-1 text-muted-foreground transition hover:bg-muted active:scale-95"
          >
            <Menu className="size-5" aria-hidden />
            <span className="text-[10px] leading-tight">منو</span>
          </button>
        </div>
      </nav>

      {open ? (
        <div className="fixed inset-0 z-[60] md:hidden" role="dialog" aria-modal="true" aria-label={data.title}>
          <div className="absolute inset-0 bg-foreground/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-x-0 bottom-0 flex max-h-[82vh] flex-col overflow-y-auto rounded-t-2xl border-t border-border bg-card shadow-2xl">
            <div className="sticky top-0 flex items-center justify-between border-b border-border bg-card p-4">
              <p className="text-sm font-extrabold">{data.title}</p>
              <button type="button" onClick={() => setOpen(false)} aria-label="بستن منو" className="rounded-lg px-2 py-1 text-xl leading-none text-muted-foreground hover:bg-muted">
                ×
              </button>
            </div>
            <div className="space-y-1 p-2">
              {data.menu.map((item) => {
                const active = isActive(pathname, item);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={() => setOpen(false)}
                    className={cn(
                      'flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-bold transition',
                      active ? 'bg-primary text-primary-foreground shadow-sm' : 'text-foreground hover:bg-muted',
                    )}
                  >
                    {typeof Icon === 'string'
                      ? <span className="w-4 shrink-0 text-center text-base leading-none" aria-hidden>{Icon}</span>
                      : <Icon className="size-4 shrink-0" aria-hidden />}
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}

export { sectionOf };
