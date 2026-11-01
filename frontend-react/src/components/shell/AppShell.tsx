import { GraduationCap, LogOut } from 'lucide-react';
import { useState } from 'react';
import { Link, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import { PanelSwitcher } from '@/components/shell/PanelSwitcher';
import { MobileTabBar, sectionOf } from '@/components/shell/MobileTabBar';
import { SessionLockOverlay } from '@/components/shell/SessionLockOverlay';
import { TermSwitcher } from '@/components/shell/TermSwitcher';
import { ThemeToggle } from '@/components/shell/ThemeToggle';
import { UniversitySwitcher } from '@/components/shell/UniversitySwitcher';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { logout } from '@/lib/auth-api';
import { useSession } from '@/lib/session';

// Global shell: dark header, switchers, idle lock, and mobile navigation.
export function AppShell() {
  const { data, isLoading } = useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [busy, setBusy] = useState(false);

  const user = data?.user ?? null;

  // Route guard: no session -> login; password change pending -> change screen.
  if (!isLoading && !user) {
    if (data?.pendingPasswordChange) {
      return <Navigate to="/change-password" replace />;
    }
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  async function doLogout() {
    setBusy(true);
    try {
      await logout();
    } catch {
      /* حتی با خطا، نشست سمت کلاینت پاک می‌شود */
    }
    await queryClient.invalidateQueries({ queryKey: ['session'] });
    setBusy(false);
    navigate('/login', { replace: true });
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <SessionLockOverlay />
      <header className="border-b border-black/10 bg-header text-header-foreground">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4">
          <Link to="/" className="flex items-center gap-2 font-bold">
            <GraduationCap className="size-5 text-indigo-400" aria-hidden />
            <span className="hidden sm:inline">سامانه جامع آفاق</span>
            <Badge variant="secondary" className="border-transparent bg-white/10 text-white/80">
              نسخهٔ جدید
            </Badge>
          </Link>

          <div className="ms-auto flex items-center gap-2">
            <UniversitySwitcher />
            <TermSwitcher />
            {user && <PanelSwitcher roles={user.roles} />}
            {isLoading ? (
              <Skeleton className="h-8 w-28 bg-white/10" />
            ) : user ? (
              <span className="hidden text-sm text-white/90 md:inline">{user.name}</span>
            ) : null}
            <ThemeToggle />
            {user ? (
              <Button
                variant="ghost"
                size="icon"
                title="خروج از سامانه"
                aria-label="خروج"
                disabled={busy}
                onClick={doLogout}
                className="text-header-foreground hover:bg-header-foreground/10"
              >
                <LogOut />
              </Button>
            ) : null}
          </div>
        </div>
      </header>
      <main className={`mx-auto w-full max-w-6xl flex-1 px-4 pt-6 ${sectionOf(location.pathname) ? 'pb-24 md:pb-6' : 'pb-6'}`}>
        <Outlet />
      </main>
      <MobileTabBar />
    </div>
  );
}
