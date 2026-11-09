import { GraduationCap, LogOut } from 'lucide-react';
import { useState } from 'react';
import { Link, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { AdminBackBar } from '@/components/shell/AdminBackBar';
import { AdminNav } from '@/components/shell/AdminNav';
import { HeaderActions } from '@/components/shell/HeaderActions';
import { MobileTabBar, sectionOf } from '@/components/shell/MobileTabBar';
import { PanelSwitcher } from '@/components/shell/PanelSwitcher';
import { SessionLockOverlay } from '@/components/shell/SessionLockOverlay';
import { TermSwitcher } from '@/components/shell/TermSwitcher';
import { ThemeToggle } from '@/components/shell/ThemeToggle';
import { UniversitySwitcher } from '@/components/shell/UniversitySwitcher';
import { UserAvatar } from '@/components/shell/UserAvatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { logout } from '@/lib/auth-api';
import { getScope } from '@/lib/scope-api';
import { useSession } from '@/lib/session';

// Global shell: dark header, switchers, idle lock, and mobile navigation.
// The admin area carries the reference app's own chrome: a two-row header
// (identity + switchers row) and a two-column body (AdminNav sidebar + main
// with the two-level back bar); student/professor keep the generic shell.
export function AppShell() {
  const { data, isLoading } = useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [busy, setBusy] = useState(false);

  const user = data?.user ?? null;
  const isAdmin = sectionOf(location.pathname) === 'admin';

  // Current university title for the admin header badge/label.
  const { data: scope } = useQuery({
    queryKey: ['scope'],
    queryFn: getScope,
    staleTime: 60_000,
    enabled: isAdmin,
  });
  const curUni = isAdmin ? scope?.universities.find(u => u.id === scope.universityId) : undefined;

  // Route guard: loading skeleton first, then no session -> login; password
  // change pending -> change screen. After these, `user` is non-null.
  if (isLoading) {
    return (
      <div className="min-h-dvh bg-sky-50/70 dark:bg-slate-950">
        <Skeleton className="h-14 w-full rounded-none" />
        <div className="mx-auto max-w-6xl space-y-4 p-4 pt-6">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }
  if (!user) {
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
      /* Even on error, the client-side session is cleared */
    }
    await queryClient.invalidateQueries({ queryKey: ['session'] });
    setBusy(false);
    navigate('/login', { replace: true });
  }

  const isStudent = sectionOf(location.pathname) === 'student';
  const isProfessor = sectionOf(location.pathname) === 'professor';
  // Per-panel chrome (tones and help hrefs mirror the reference layouts).
  // Brand title in the header is a home-link for THIS panel — never hard-code
  // /admin, or switching to the professor cartable and tapping the title
  // dumps the user back into the admin dashboard (reference: professor/layout.tsx).
  const chrome = isAdmin
    ? {
        header: 'bg-indigo-950',
        badge: 'border-indigo-600/60 bg-indigo-900/90',
        help: '/help/admin',
        pdf: '/help/pdfs/admin.pdf',
        page: 'bg-sky-50/70',
        home: '/admin',
        homeTitle: 'بازگشت به صفحه اول (داشبورد)',
      }
    : isStudent
      ? {
          header: 'bg-emerald-800',
          badge: 'border-emerald-500/50 bg-emerald-700',
          help: '/help/student',
          pdf: '/help/pdfs/student.pdf',
          page: 'bg-slate-100',
          home: '/student',
          homeTitle: 'بازگشت به کارتابل دانشجو',
        }
      : {
          header: 'bg-slate-900',
          badge: 'border-slate-600 bg-slate-700',
          help: '/help/professor',
          pdf: '/help/pdfs/professor.pdf',
          page: 'bg-slate-50',
          home: '/professor',
          homeTitle: 'بازگشت به کارتابل استاد',
        };

  if (isAdmin || isStudent || isProfessor) {
    return (
      <div className={`min-h-screen ${chrome.page} print:!bg-white dark:bg-slate-950`}>
        <SessionLockOverlay />
        <header className={`sticky top-0 z-40 ${chrome.header} text-white shadow-sm transition-colors print:hidden`}>
          {/* Explicit two-row header (same pattern as the professor panel):
              row 1 — identity + tools; row 2 — the cartable/term/university
              switchers (visible on every size so mobile never loses them). */}
          <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-2 p-3 sm:p-3.5 lg:flex-nowrap lg:gap-3">
            {/* Row 1: identity + tools (the mobile "منو" button floats above) */}
            <div className="order-1 flex min-w-0 flex-1 items-center gap-2">
              <div aria-hidden className="w-14 shrink-0 lg:hidden" />
              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                <div className={`flex size-8 shrink-0 items-center justify-center rounded-lg border text-sm font-bold shadow-inner ${chrome.badge}`}>
                  {(curUni?.title ?? 'آ').slice(0, 1)}
                </div>
                <UserAvatar userId={user.id} name={user.name} className="size-9" />
                <div className="min-w-0">
                  <Link
                    to={chrome.home}
                    title={chrome.homeTitle}
                    className="block transition-opacity hover:opacity-90"
                  >
                    <p className="truncate text-sm font-extrabold tracking-wide">
                      {isAdmin ? (
                        <>
                          <span className="sm:hidden">داشبورد مدیریت</span>
                          <span className="hidden sm:inline">داشبورد مدیریت جامع {curUni?.title ?? ''}</span>
                        </>
                      ) : isStudent ? (
                        <>
                          <span className="sm:hidden">دانشجو {user.name}</span>
                          <span className="hidden sm:inline">کارتابل دانشجو — {curUni?.title ?? ''}</span>
                        </>
                      ) : (
                        <>
                          <span className="sm:hidden">استاد {user.name}</span>
                          <span className="hidden sm:inline">خوش آمدید، استاد گرامی {user.name}</span>
                        </>
                      )}
                    </p>
                  </Link>
                  <p className="truncate text-xs opacity-80">{user.name} · {user.roles.join('، ')}</p>
                </div>
              </div>
            </div>

            {/* Row 2 (mobile) / middle column (desktop): switchers */}
            <div className="relative order-3 flex w-full flex-wrap items-center gap-1.5 sm:gap-2 lg:order-2 lg:w-auto lg:flex-nowrap lg:justify-center">
              {user && <PanelSwitcher roles={user.roles} />}
              <TermSwitcher />
              <UniversitySwitcher />
            </div>

            {/* Tools */}
            <div className="order-2 flex shrink-0 items-center gap-1.5 lg:order-3">
              <HeaderActions helpHref={chrome.help} pdfHref={chrome.pdf} />
            </div>
          </div>
        </header>

        {isAdmin ? (
          <div className="mx-auto flex w-full max-w-[2100px] items-start gap-4 p-3 pb-16 sm:p-5 lg:gap-6">
            <AdminNav />
            <main id="main" className="min-w-0 flex-1 pb-4">
              <AdminBackBar />
              <Outlet />
            </main>
          </div>
        ) : (
          <main className={`mx-auto w-full max-w-6xl flex-1 px-4 pt-6 ${sectionOf(location.pathname) ? 'pb-24 md:pb-6' : 'pb-6'}`}>
            <Outlet />
          </main>
        )}
        <MobileTabBar />
      </div>
    );
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
