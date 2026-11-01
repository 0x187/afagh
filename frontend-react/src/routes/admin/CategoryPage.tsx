import { Link, useParams } from 'react-router-dom';

import { Card, CardContent } from '@/components/ui/card';
import { MODULES } from '@/routes/admin/admin-modules';

// ═══ Tiles of one category — port of /admin/c/[group] (React version) ═══
//
// The categories are the same eight Next groups; tiles not yet ported to React
// are not shown on this page (no fake tiles).

const GROUPS: { key: string; title: string; icon: string; desc: string; hrefs: string[] }[] = [
  {
    key: 'edu', title: 'آموزش', icon: '🎓', desc: 'دانشجویان، پذیرش، کاتالوگ، دروس و آیین‌نامه',
    hrefs: ['/admin/students', '/admin/admissions', '/admin/offerings', '/admin/grade-status-codes', '/admin/course-merge', '/admin/equivalence-clusters', '/admin/manual-enroll', '/admin/group-transfer', '/admin/enrollment-approvals', '/admin/lesson-plans', '/admin/regulation-check', '/admin/short-courses', '/admin/weekly-board'],
  },
  {
    key: 'fin', title: 'مالی', icon: '💰', desc: 'حقوق، شهریه، دفتر مالی و صندوق',
    hrefs: ['/admin/finance', '/admin/finance/reports', '/admin/finance/rules', '/admin/finance/advanced', '/admin/finance/welfare', '/admin/finance/pos', '/admin/payroll', '/admin/tuition', '/admin/tuition/tariff'],
  },
  {
    key: 'plan', title: 'برنامه‌ریزی درسی', icon: '🗓️', desc: 'کارتابل مدیر گروه و فرآیندها',
    hrefs: ['/admin/workflows', '/admin/discipline', '/admin/council', '/admin/warnings', '/admin/enrollment-confirmation', '/admin/defense-scheduling'],
  },
  {
    key: 'research', title: 'پژوهش و فارغ‌التحصیلی', icon: '🔬', desc: 'دفاع، فارغ‌التحصیلی و مدارک',
    hrefs: ['/admin/graduation', '/admin/student-cards', '/admin/reports'],
  },
  {
    key: 'reports', title: 'گزارش‌ها', icon: '📑', desc: 'مرکز گزارش‌ها و هوش تجاری',
    hrefs: ['/admin/reports', '/admin/bi', '/admin/sanjesh-import'],
  },
  {
    key: 'archive', title: 'سامانه بایگانی و درخواست‌ها', icon: '🗄️', desc: 'اسناد و موارد خاص',
    hrefs: ['/admin/archive'],
  },
  {
    key: 'settings', title: 'تنظیمات', icon: '⚙️', desc: 'دسترسی‌ها، دانشگاه‌ها و پیکربندی',
    hrefs: ['/admin/departments', '/admin/staff', '/admin/settings', '/admin/dorm', '/admin/exams'],
  },
];

export function AdminCategoryPage() {
  const { group } = useParams<{ group: string }>();
  const g = GROUPS.find((x) => x.key === group);
  if (!g) {
    return (
      <div className="space-y-4">
        <Link to="/admin" className="text-xs font-bold text-indigo-700 hover:underline dark:text-indigo-300">→ بازگشت به داشبورد</Link>
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">دسته‌ای یافت نشد یا دسترسی ندارید.</CardContent></Card>
      </div>
    );
  }
  const tiles = g.hrefs.map((href) => MODULES.find((m) => m.to === href)).filter((m): m is (typeof MODULES)[number] => !!m);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-base font-black sm:text-lg">{g.icon} {g.title}</h1>
        <Link to="/admin" className="text-xs font-bold text-indigo-700 hover:underline dark:text-indigo-300">→ بازگشت به داشبورد</Link>
      </div>
      <p className="text-[11px] text-muted-foreground sm:text-xs">{g.desc} — {tiles.length} ماژول</p>
      <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 sm:gap-3.5 lg:grid-cols-5">
        {tiles.map((m) => {
          const Icon = m.icon;
          return (
            <Link key={m.to} to={m.to} title={m.label}
              className={`group flex min-h-24 flex-col items-center justify-start gap-2 rounded-2xl border border-border px-2 py-3 text-center shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg ${m.tone}`}>
              <Icon className="size-7" aria-hidden />
              <h3 className="line-clamp-3 text-[11px] font-black leading-tight sm:text-xs">{m.label}</h3>
            </Link>
          );
        })}
        {tiles.length === 0 ? <p className="col-span-full py-6 text-center text-xs text-muted-foreground">کاشی‌ای برای این دسته منتقل نشده است.</p> : null}
      </div>
    </div>
  );
}
