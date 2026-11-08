import { Link, useParams } from 'react-router-dom';

import { Card, CardContent } from '@/components/ui/card';
import { useSession } from '@/lib/session';
import { faNumber } from '@/lib/fa';
import { ADMIN_MODULES, canSeeModule, MODULE_GROUPS } from '@/routes/admin/admin-modules';

// ═══ Tiles of one category — port of /admin/c/[group] ═══
//
// Tiles come straight from the central registry (group + role filtering), so
// this page always matches the reference app's category counts.

export function AdminCategoryPage() {
  const { group } = useParams<{ group: string }>();
  const { data: session } = useSession();
  const roles = session?.user?.roles ?? [];
  const g = MODULE_GROUPS.find((x) => x.key === group);
  if (!g) {
    return (
      <div className="space-y-4">
        <Link to="/admin" className="text-xs font-bold text-indigo-700 hover:underline dark:text-indigo-300">→ بازگشت به داشبورد</Link>
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">دسته‌ای یافت نشد یا دسترسی ندارید.</CardContent></Card>
      </div>
    );
  }
  const modules = ADMIN_MODULES.filter((m) => m.inGrid && m.group === g.key && canSeeModule(roles, m));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-base font-black sm:text-lg">{g.emoji} {g.title}</h1>
        <Link to="/admin" className="text-xs font-bold text-indigo-700 hover:underline dark:text-indigo-300">→ بازگشت به داشبورد</Link>
      </div>
      <p className="text-[11px] text-muted-foreground sm:text-xs">{g.desc} — {faNumber(modules.length)} ماژول</p>
      <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 sm:gap-3.5 lg:grid-cols-5">
        {modules.map((m) => (
          <Link key={m.href} to={m.href} title={m.desc}
            className="group flex min-h-24 flex-col items-center justify-start gap-2 rounded-2xl border border-border px-2 py-3 text-center shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg">
            <span className={`flex size-10 items-center justify-center rounded-xl text-lg ${m.iconBg}`}>{m.emoji}</span>
            <h3 className="line-clamp-3 text-[11px] font-black leading-tight sm:text-xs">{m.title}</h3>
          </Link>
        ))}
        {modules.length === 0 ? <p className="col-span-full py-6 text-center text-xs text-muted-foreground">ماژولی برای نقش شما در این دسته نیست.</p> : null}
      </div>
    </div>
  );
}
