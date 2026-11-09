import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { GraduationCap } from 'lucide-react';

import { ShowcaseSlider } from '@/routes/login/ShowcaseSlider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, chooseAccount, getLoginShowcase, login, type LoginCandidate } from '@/lib/auth-api';
import { toEnDigits } from '@/lib/fa';

// ═══ SPA login page — faithful port of LoginCard + page.tsx from the current system ═══
//
// The original visual identity (dark gradient + showcase + form) is preserved; the form is built with the
// new design system. Messages, states (account selection, forced password change, network
// errors) and input rules are ported verbatim.

const NOTICE_STYLE: Record<string, string> = {
  important: 'border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200',
  warning: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200',
  info: 'border-sky-200 bg-white/95 text-slate-700 dark:border-sky-800 dark:bg-slate-900 dark:text-slate-200',
};
const NOTICE_ICON: Record<string, string> = { important: '📢', warning: '⚠️', info: 'ℹ️' };

export function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [uniCode, setUniCode] = useState(() => new URLSearchParams(window.location.search).get('u') ?? '');

  const { data: showcase, isLoading } = useQuery({
    queryKey: ['login-showcase', uniCode],
    queryFn: () => getLoginShowcase(uniCode || undefined),
    staleTime: 60_000,
    retry: 1,
  });

  const [code, setCode] = useState('');
  const [pass, setPass] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [choice, setChoice] = useState<{ token: string; candidates: LoginCandidate[] } | null>(null);

  // Returned messages (e.g. user with no role) — identical to LoginCard
  useEffect(() => {
    const e = new URLSearchParams(window.location.search).get('e');
    if (e === 'norole') setErr('ورود موفق بود، اما برای این حساب هیچ نقشی تعریف نشده است. با مدیر سامانه تماس بگیرید.');
    if (e === 'expired') setErr('نشست شما منقضی شده است. دوباره وارد شوید.');
  }, []);

  // Drop the stale anonymous session cache BEFORE navigating. Without this,
  // AppShell can still see the pre-login `{user:null}` for up to staleTime
  // (60s) and bounce the user straight back to /login — which looks like
  // "login needs a refresh / several tries". removeQueries (not just
  // invalidate) is required: on /login there is no active session observer,
  // so refetchQueries would be a no-op and the null cache would survive.
  async function afterOk(mustChange?: boolean) {
    queryClient.removeQueries({ queryKey: ['session'] });
    if (mustChange) {
      navigate('/change-password', { replace: true });
      return;
    }
    navigate('/', { replace: true });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim() || !pass) {
      setErr('کد (ملی یا پرسنلی) و رمز عبور را وارد کنید.');
      return;
    }
    setBusy(true);
    setErr('');
    setChoice(null);
    try {
      const res = await login(code, pass);
      if ('needChoice' in res && res.needChoice) {
        setChoice({ token: res.token, candidates: res.candidates });
        setBusy(false);
        return;
      }
      if (!res.ok) {
        // At this point needChoice is moot — the union narrows to the error state
        setErr(('error' in res && res.error) || 'خطا');
        setBusy(false);
        return;
      }
      await afterOk(res.mustChange);
    } catch (e2) {
      const msg = e2 instanceof ApiError ? e2.message : e2 instanceof Error ? e2.message : String(e2 ?? '');
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setErr('به اینترنت متصل نیستید. اتصال را بررسی و دوباره تلاش کنید.');
      } else if (/failed to fetch|network|load failed|timeout/i.test(msg)) {
        setErr(`ارتباط با سرور برقرار نشد (${msg.slice(0, 80)}). اگر با فیلترشکن هستید آن را عوض کنید و دوباره تلاش کنید.`);
      } else {
        setErr(`خطای ورود: ${msg.slice(0, 120) || 'نامشخص'}`);
      }
      setBusy(false);
    }
  }

  async function pick(id: number) {
    if (!choice) return;
    setBusy(true);
    setErr('');
    try {
      const res = await chooseAccount(choice.token, id);
      if (!res.ok) {
        setErr(res.error || 'خطا');
        setBusy(false);
        return;
      }
      await afterOk(res.mustChange);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'نامشخص';
      setErr(`خطای انتخاب حساب: ${msg.slice(0, 120)}`);
      setBusy(false);
    }
  }

  const uni = showcase?.university;
  const important = showcase?.notices.filter((n) => n.kind === 'important') ?? [];
  const rest = showcase?.notices.filter((n) => n.kind !== 'important') ?? [];

  return (
    <main
      dir="rtl"
      className="flex min-h-dvh items-start justify-center bg-gradient-to-bl from-emerald-950 via-slate-900 to-teal-950 p-4 sm:items-center sm:p-8"
    >
      <div className="grid w-full max-w-6xl items-start gap-6 lg:grid-cols-5">
        {/* ── Intro panel / slider ── */}
        <div className="order-2 space-y-4 lg:order-1 lg:col-span-3">
          <div className="flex items-center gap-4">
            {uni?.logoUrl ? (
              <img
                src={uni.logoUrl}
                alt={uni.title}
                className="h-16 w-16 rounded-3xl bg-white object-contain p-2 shadow-2xl sm:h-20 sm:w-20"
              />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-emerald-500 text-3xl font-black text-emerald-950 shadow-2xl sm:h-20 sm:w-20">
                آ
              </div>
            )}
            <div>
              {isLoading ? (
                <Skeleton className="h-7 w-56 bg-white/10" />
              ) : (
                <h1 className="text-lg leading-9 font-black text-white sm:text-2xl">
                  {uni?.title ?? 'دانشگاه آفاق'}
                </h1>
              )}
              <p className="mt-0.5 text-xs text-emerald-200/80 sm:text-sm">سامانه جامع آموزشی، مالی و پژوهشی</p>
            </div>
          </div>

          {showcase && showcase.universities.length > 1 && (
            <select
              aria-label="انتخاب دانشگاه"
              value={uni?.code ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                setUniCode(v);
                window.history.replaceState(null, '', `?u=${encodeURIComponent(v)}`);
              }}
              className="cursor-pointer rounded-xl border border-white/25 bg-white/10 px-3 py-1.5 text-[12px] font-bold text-emerald-50 backdrop-blur hover:bg-white/20 focus:ring-2 focus:ring-emerald-300/60 focus:outline-none"
            >
              {showcase.universities.map((u) => (
                <option key={u.code} value={u.code} className="text-slate-900">
                  {u.title}
                </option>
              ))}
            </select>
          )}

          {isLoading ? (
            <Skeleton className="h-52 w-full rounded-3xl bg-white/10 sm:h-64" />
          ) : (
            <ShowcaseSlider slides={showcase?.slides ?? []} />
          )}

          {rest.length > 0 && (
            <div className="space-y-2.5">
              {rest.map((n) => (
                <div key={n.id} className={`rounded-2xl border p-3.5 shadow-sm ${NOTICE_STYLE[n.kind] ?? NOTICE_STYLE.info}`}>
                  <p className="flex items-center gap-1.5 text-[13px] font-black">
                    <span>{NOTICE_ICON[n.kind] ?? 'ℹ️'}</span>
                    <span>{n.title}</span>
                  </p>
                  {n.body ? <p className="mt-1 text-xs leading-6 opacity-90">{n.body}</p> : null}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Login column ── */}
        <div className="order-1 space-y-4 lg:sticky lg:top-6 lg:order-2 lg:col-span-2">
          {important.map((n) => (
            <div key={n.id} className={`rounded-2xl border p-3.5 text-xs font-bold leading-6 shadow-sm ${NOTICE_STYLE[n.kind] ?? NOTICE_STYLE.info}`}>
              {NOTICE_ICON[n.kind] ?? 'ℹ️'} {n.title}
            </div>
          ))}

          <Card className="gap-0 overflow-hidden py-0 shadow-2xl">
            <CardContent className="space-y-4 p-5">
              <div className="text-center">
                <div className="mx-auto mb-2 flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
                  <GraduationCap className="size-6" aria-hidden />
                </div>
                <h2 className="text-base font-black">ورود به سامانه</h2>
                <p className="mt-1 text-xs text-muted-foreground">ورود با کد پرسنلی / شماره دانشجویی + رمز عبور</p>
              </div>

              {!choice ? (
                <form onSubmit={submit} method="post" className="space-y-4">
                  <Input
                    dir="ltr"
                    className="text-left"
                    placeholder="کد پرسنلی یا شماره دانشجویی"
                    value={code}
                    onChange={(e) => setCode(toEnDigits(e.target.value))}
                    name="code"
                    autoComplete="username"
                    inputMode="text"
                    enterKeyHint="next"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    aria-label="کد پرسنلی یا شماره دانشجویی"
                  />
                  <Input
                    dir="ltr"
                    type="password"
                    className="text-left"
                    placeholder="رمز عبور"
                    value={pass}
                    onChange={(e) => setPass(toEnDigits(e.target.value))}
                    name="password"
                    autoComplete="current-password"
                    enterKeyHint="go"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    aria-label="رمز عبور"
                  />
                  {err && (
                    <p role="alert" className="rounded-xl bg-red-50 p-2 text-center text-sm text-red-700 dark:border dark:border-red-800 dark:bg-red-950 dark:text-red-200">
                      {err}
                    </p>
                  )}
                  <Button type="submit" disabled={busy} className="w-full">
                    {busy ? 'در حال ورود…' : 'ورود'}
                  </Button>
                  <p className="text-center text-[11px] text-muted-foreground">
                    ورود اول؟ گذرواژهٔ اولیهٔ شما برابر همان کد است.{' '}
                    <a href="/help?tab=shared" className="font-bold text-primary hover:underline">
                      راهنمای ورود
                    </a>
                  </p>
                </form>
              ) : (
                <div className="space-y-3">
                  <p className="rounded-xl bg-amber-50 p-2 text-center text-sm font-bold text-amber-900 dark:border dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                    این شناسه چند حساب دارد — وارد کدام کارتابل می‌شوید؟
                  </p>
                  <div className="space-y-2">
                    {choice.candidates.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        disabled={busy}
                        onClick={() => pick(c.id)}
                        className="w-full rounded-xl border border-border bg-card p-3 text-right shadow-sm transition hover:border-primary hover:bg-accent disabled:opacity-60"
                      >
                        <span className="block text-sm font-extrabold">{c.name}</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {c.staffCodes.length ? `کد پرسنلی: ${c.staffCodes.join('، ')}` : 'بدون کد پرسنلی'}
                          {c.universityTitle ? ` · ${c.universityTitle}` : ''}
                        </span>
                        {c.roles.length > 0 && (
                          <span className="mt-1 flex flex-wrap gap-1">
                            {c.roles.map((r) => (
                              <Badge key={r} variant="secondary">
                                {r}
                              </Badge>
                            ))}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                  {err && (
                    <p className="rounded-xl bg-red-50 p-2 text-center text-sm text-red-700 dark:border dark:border-red-800 dark:bg-red-950 dark:text-red-200">
                      {err}
                    </p>
                  )}
                  <button
                    type="button"
                    className="w-full text-center text-xs text-muted-foreground hover:underline"
                    disabled={busy}
                    onClick={() => {
                      setChoice(null);
                      setErr('');
                    }}
                  >
                    بازگشت به ورود
                  </button>
                </div>
              )}
            </CardContent>
          </Card>

          <p className="text-center text-[11px] text-emerald-200/60">
            <Link to="/" className="hover:underline">
              بازگشت به نسخهٔ جدید
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
