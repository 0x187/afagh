import { requireRole } from '@/lib/auth';
import { groupedModules } from '@/lib/admin-modules';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

const ALL_ADMIN_ROLES = [
  'ADMIN',
  'EDU_EXPERT',
  'ARCHIVE_EXPERT',
  'FINANCE_EXPERT',
  'FINANCE',
  'MILITARY_OFFICER',
  'VAULT_MANAGER',
  'DEP_HEAD',
  'VICE_EDU',
];

/** صفحهٔ کاشی‌های یک دسته — /admin/c/edu */
export default async function CategoryPage({ params }: { params: Promise<{ group: string }> }) {
  const user = await requireRole(ALL_ADMIN_ROLES);
  const { group: key } = await params;
  const { getUserPermissionCodes } = await import('@/lib/permissions-enforcer');
  const permissionCodes = await getUserPermissionCodes(user.id).catch(() => []);
  const groups = groupedModules(user.roles, permissionCodes);
  const g = groups.find(x => x.group.key === key);

  if (!g) {
    return (
      <div className="space-y-4">
        <div className="card text-center p-8 text-slate-500 text-sm">دسته‌ای یافت نشد یا دسترسی ندارید.</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* سربرگِ دسته: تیتر + شمارش + توضیح در یک بلوکِ منظم */}
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 pb-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-base font-black tracking-tight text-slate-900 sm:text-lg">
            <span aria-hidden className="text-lg leading-none sm:text-xl">{g.group.icon}</span>
            <span className="truncate">{g.group.title}</span>
          </h1>
          <p className="mt-1 text-2xs font-bold leading-5 text-slate-500 sm:text-xs">{g.group.desc}</p>
        </div>
        <span className="ui-chip shrink-0">{g.modules.length} ماژول</span>
      </div>

      {/* کاشی‌های ماژول — همان الگوی «آیکن + عنوان کوتاه» کارتابل استاد/دانشجو.
          پیش‌تر هر کاشی یک پاراگراف توضیح داشت؛ در موبایل با ۳ ستون، کاشی‌ها
          بسیار بلند و ناخوانا می‌شدند. توضیح حذف شد و عنوان تا ۳ خط جمع می‌شود.

          ⚠ بازطراحی: پیش‌تر **کلِ کاشی** یک گرادیانِ رنگیِ مخصوصِ خودش داشت؛ با
          ۴۰+ ماژول، صفحه به یک تابلوی رنگارنگ تبدیل می‌شد و سلسله‌مراتب نداشت.
          حالا سطحِ کاشی خنثی است و رنگِ هر ماژول فقط در «نشانِ آیکن» می‌ماند —
          هم‌خوان با کاشی‌های دسته در داشبورد و با هر دو حالت روشن/تیره.

          prefetch خاموش است: هر کاشی یک صفحهٔ سنگینِ force-dynamic است. با
          prefetch روشن، باز کردن یک دسته ۵ تا ۸ رندرِ کاملِ RSC با تمام
          کوئری‌هایشان را همزمان به event-loop نود تحمیل می‌کرد — همان الگویی
          که در HAR باعث ۱۶۲ درخواست `_rsc` روی یک بارگذاری شده بود.
          ناوبری حالا فقط با کلیک و یک درخواست انجام می‌شود. */}
      <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 sm:gap-3.5 lg:grid-cols-5">
        {g.modules.map(m => (
          <Link
            key={m.href}
            href={m.href}
            title={m.title}
            prefetch={false}
            className="group flex min-h-[104px] flex-col items-center justify-start gap-2 rounded-2xl border border-slate-200 bg-white px-2 py-3 text-center shadow-sm transition-all hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-md"
          >
            <div
              aria-hidden
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/25 bg-gradient-to-br ${m.accent} text-lg text-white shadow-sm transition-transform group-hover:scale-105`}
            >
              {m.icon}
            </div>
            <h3 className="line-clamp-3 text-2xs font-extrabold leading-tight text-slate-800 sm:text-xs">
              {m.title}
            </h3>
          </Link>
        ))}
      </div>
    </div>
  );
}
