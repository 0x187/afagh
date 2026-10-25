import { GraduationCap, LogOut } from 'lucide-react';
import { Link, Outlet } from 'react-router-dom';

import { ThemeToggle } from '@/components/shell/ThemeToggle';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useSession } from '@/lib/session';

// ═══ شل سراسری اپ — سربرگ تیرهٔ هم‌سبک با سامانهٔ فعلی (slate-900) ═══
// در فاز ۱ (Auth) منوی نقش‌محور و خروج واقعی به این شل اضافه می‌شود.
export function AppShell() {
  const { data, isLoading } = useSession();
  const user = data?.user ?? null;

  return (
    <div className="min-h-dvh flex flex-col">
      <header className="bg-header text-header-foreground border-b border-black/10">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <Link to="/" className="flex items-center gap-2 font-bold">
            <GraduationCap className="size-5 text-indigo-400" aria-hidden />
            <span>سامانه جامع آفاق</span>
            <Badge variant="secondary" className="bg-white/10 text-white/80 border-transparent">
              نسخهٔ جدید
            </Badge>
          </Link>
          <div className="ms-auto flex items-center gap-2">
            {isLoading ? (
              <Skeleton className="h-8 w-28 bg-white/10" />
            ) : user ? (
              <span className="hidden sm:inline text-sm text-white/90">{user.name}</span>
            ) : null}
            <ThemeToggle />
            {user ? (
              <Button
                variant="ghost"
                size="icon"
                title="خروج (فعلاً از سامانهٔ فعلی)"
                aria-label="خروج"
                className="text-header-foreground hover:bg-header-foreground/10"
                asChild
              >
                <a href="/logout">
                  <LogOut />
                </a>
              </Button>
            ) : null}
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
