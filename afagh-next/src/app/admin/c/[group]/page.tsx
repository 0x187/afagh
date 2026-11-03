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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-extrabold text-slate-800 text-base sm:text-lg">
          {g.group.icon} {g.group.title}
        </h1>
      </div>
      <p className="text-2xs sm:text-xs text-slate-500">{g.group.desc} — {g.modules.length} ماژول</p>

      {/* کاشی‌های ماژول — همان الگوی «آیکن + عنوان کوتاه» کارتابل استاد/دانشجو.
          پیش‌تر هر کاشی یک پاراگراف توضیح داشت؛ در موبایل با ۳ ستون، کاشی‌ها
          بسیار بلند و ناخوانا می‌شدند. توضیح حذف شد و عنوان تا ۳ خط جمع می‌شود. */}
      <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-2.5 sm:gap-3.5">
        {g.modules.map(m => (
          <Link
            key={m.href}
            href={m.href}
            title={m.title}
            className={`group flex min-h-[96px] flex-col items-center justify-start gap-2 rounded-2xl bg-gradient-to-br ${m.accent} px-2 py-3 text-center text-white shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all border`}
          >
            <div className={`w-10 h-10 shrink-0 rounded-2xl ${m.iconBg} border flex items-center justify-center text-lg shadow-inner group-hover:scale-110 transition-transform`}>
              {m.icon}
            </div>
            <h3 className="line-clamp-3 font-extrabold text-2xs sm:text-xs leading-tight">
              {m.title}
            </h3>
          </Link>
        ))}
      </div>
    </div>
  );
}
