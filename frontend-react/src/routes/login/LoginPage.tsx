import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Landmark } from 'lucide-react';

import { BackgroundPaths } from '@/routes/login/BackgroundPaths';
import { ShowcaseSlider } from '@/routes/login/ShowcaseSlider';
import { ApiError, chooseAccount, getLoginShowcase, login, type LoginCandidate } from '@/lib/auth-api';
import { toEnDigits } from '@/lib/fa';

// ═══ Login screen — visual port of the reference login (app.afagh.ac.ir) ═══
//
// One centered glass card on an animated line-art backdrop: logo, welcome
// heading, the two credential fields, the primary sign-in pill, an "or"
// divider, and the government-login entry point.
// Behaviour is the ported original unchanged: account selection for shared
// identifiers, forced password change, the same Persian messages, and the
// stale-session cache fix after a successful sign-in.
//
// The screen is intentionally dark-only (like the reference) regardless of the
// stored theme, so every color here is an explicit literal instead of a token.

const NOTICE_STYLE: Record<string, string> = {
  important: 'border-red-400/30 bg-red-500/10 text-red-100',
  warning: 'border-amber-400/30 bg-amber-500/10 text-amber-100',
  info: 'border-white/10 bg-white/[0.04] text-white/75',
};
const NOTICE_ICON: Record<string, string> = { important: '📢', warning: '⚠️', info: 'ℹ️' };

const FIELD =
  'h-12 w-full min-w-0 rounded-2xl border border-white/15 bg-white/5 px-2.5 text-center text-base tracking-widest text-white outline-none transition-colors placeholder:text-sm placeholder:tracking-normal placeholder:text-white/40 focus-visible:border-white/40 focus-visible:ring-3 focus-visible:ring-white/15 disabled:opacity-50';

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
    const params = new URLSearchParams(window.location.search);
    if (params.get('e') === 'norole') setErr('ورود موفق بود، اما برای این حساب هیچ نقشی تعریف نشده است. با مدیر سامانه تماس بگیرید.');
    if (params.get('e') === 'expired') setErr('نشست شما منقضی شده است. دوباره وارد شوید.');
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
  const logoSrc = uni?.logoUrl || `${import.meta.env.BASE_URL}icons/icon-192.png`;

  return (
    <main
      dir="rtl"
      className="relative flex min-h-svh flex-col overflow-hidden bg-[#0b0b0d] text-white"
    >
      <BackgroundPaths />

      {/* Vignette: darkens the edges so the card keeps full contrast over the lines */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_65%_55%_at_50%_42%,transparent_0%,rgba(11,11,13,0.55)_72%,rgba(11,11,13,0.92)_100%)]"
      />

      <div className="relative z-10 mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-6 sm:py-10">
        {important.map((n) => (
          <p
            key={n.id}
            className={`lgn-enter mb-3 rounded-2xl border px-4 py-3 text-center text-xs font-bold leading-6 ${NOTICE_STYLE[n.kind] ?? NOTICE_STYLE.info}`}
          >
            {NOTICE_ICON[n.kind] ?? 'ℹ️'} {n.title}
          </p>
        ))}

        <div className="rounded-[1.75rem] border border-white/10 bg-white/[0.05] p-5 shadow-2xl shadow-black/50 backdrop-blur-xl sm:p-7">
          <div className="flex flex-col gap-5 sm:gap-7">
            {/* ── Identity ── */}
            <div className="lgn-enter space-y-4 text-center" style={{ '--lgn-i': 0 } as React.CSSProperties}>
              <img
                src={logoSrc}
                alt={uni?.title ?? 'آفاق'}
                className="lgn-pop mx-auto size-16 rounded-2xl bg-[rgba(255,255,255,0.95)] object-contain p-1.5 shadow-lg shadow-black/40"
              />
              <div className="space-y-1.5">
                <h1 className="text-2xl font-bold tracking-tight">خوش آمدید</h1>
                <p className="text-sm leading-6 text-white/55">
                  برای ورود، شماره دانشجویی یا کد استادی و رمز عبور خود را وارد کنید
                </p>
              </div>

              {isLoading ? null : showcase && showcase.universities.length > 1 ? (
                <select
                  aria-label="انتخاب دانشگاه"
                  value={uni?.code ?? ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    setUniCode(v);
                    window.history.replaceState(null, '', `?u=${encodeURIComponent(v)}`);
                  }}
                  className="mx-auto block cursor-pointer rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-[12px] font-bold text-white/80 outline-none transition-colors hover:bg-white/10 focus-visible:ring-3 focus-visible:ring-white/15"
                >
                  {showcase.universities.map((u) => (
                    <option key={u.code} value={u.code} className="bg-[#171310] text-white">
                      {u.title}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>

            {!choice ? (
              <form
                onSubmit={submit}
                method="post"
                autoComplete="off"
                className="lgn-enter space-y-3"
                style={{ '--lgn-i': 1 } as React.CSSProperties}
              >
                <input
                  id="username"
                  dir="ltr"
                  className={FIELD}
                  placeholder="شماره دانشجویی یا کد استادی"
                  value={code}
                  onChange={(e) => setCode(toEnDigits(e.target.value))}
                  name="code"
                  autoComplete="username"
                  inputMode="text"
                  enterKeyHint="next"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-label="شماره دانشجویی یا کد استادی"
                />
                <input
                  id="password"
                  dir="ltr"
                  type="password"
                  className={FIELD}
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
                  <p role="alert" className="rounded-2xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-center text-xs leading-6 text-red-100">
                    {err}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={busy}
                  // Literal colors (not `bg-white`): the theme remaps above rewrite
                  // `.bg-white` in dark mode, and this screen is dark in both themes.
                  className="h-12 w-full rounded-full bg-[#f7f6f3] text-base font-semibold text-[#0b0b0d] shadow-lg shadow-black/30 transition-transform hover:bg-[#ffffff] active:scale-[0.99] disabled:pointer-events-none disabled:opacity-50"
                >
                  {busy ? 'در حال ورود…' : 'ورود'}
                </button>
              </form>
            ) : (
              <div className="lgn-enter space-y-3" style={{ '--lgn-i': 1 } as React.CSSProperties}>
                <p className="rounded-2xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-center text-xs font-bold leading-6 text-amber-100">
                  این شناسه چند حساب دارد — وارد کدام کارتابل می‌شوید؟
                </p>
                <div className="space-y-2">
                  {choice.candidates.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      disabled={busy}
                      onClick={() => pick(c.id)}
                      className="w-full rounded-2xl border border-white/10 bg-white/[0.06] p-3 text-right transition-colors hover:bg-white/10 disabled:opacity-60"
                    >
                      <span className="block text-sm font-extrabold text-white">{c.name}</span>
                      <span className="mt-0.5 block text-xs text-white/50">
                        {c.staffCodes.length ? `کد پرسنلی: ${c.staffCodes.join('، ')}` : 'بدون کد پرسنلی'}
                        {c.universityTitle ? ` · ${c.universityTitle}` : ''}
                      </span>
                      {c.roles.length > 0 && (
                        <span className="mt-1.5 flex flex-wrap gap-1">
                          {c.roles.map((r) => (
                            <span key={r} className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-bold text-white/65">
                              {r}
                            </span>
                          ))}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
                {err && (
                  <p className="rounded-2xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-center text-xs leading-6 text-red-100">
                    {err}
                  </p>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setChoice(null);
                    setErr('');
                  }}
                  className="w-full text-center text-xs text-white/50 transition-colors hover:text-white/80 hover:underline"
                >
                  بازگشت به ورود
                </button>
              </div>
            )}

            {/* ── Alternative entry points ── */}
            {!choice && (
              <>
                <div className="lgn-enter flex items-center gap-3 text-xs text-white/35" style={{ '--lgn-i': 2 } as React.CSSProperties}>
                  <span className="h-px flex-1 bg-white/10" />
                  یا
                  <span className="h-px flex-1 bg-white/10" />
                </div>

                {/* Government (Dolat Man) sign-in — interface only; no provider
                    is wired yet, so the button is inert rather than misleading. */}
                <button
                  type="button"
                  className="lgn-enter flex h-12 w-full items-center justify-center gap-2 rounded-full border border-white/15 bg-white/[0.06] text-sm font-medium text-white/85 transition-colors hover:bg-white/10"
                  style={{ '--lgn-i': 3 } as React.CSSProperties}
                >
                  <Landmark className="size-4" aria-hidden />
                  ورود با دولت من
                </button>
              </>
            )}
          </div>
        </div>

        {/* Admin-managed notices and slides stay available under the card — the
            reference is card-only, so they never push the form off balance. */}
        {rest.length > 0 && (
          <div className="mt-4 space-y-2">
            {rest.map((n) => (
              <div key={n.id} className={`rounded-2xl border px-4 py-3 text-[11px] leading-6 ${NOTICE_STYLE[n.kind] ?? NOTICE_STYLE.info}`}>
                <p className="font-black">
                  {NOTICE_ICON[n.kind] ?? 'ℹ️'} {n.title}
                </p>
                {n.body ? <p className="mt-0.5 opacity-85">{n.body}</p> : null}
              </div>
            ))}
          </div>
        )}

        {!isLoading && (showcase?.slides.length ?? 0) > 0 && (
          <div className="mt-4">
            <ShowcaseSlider slides={showcase?.slides ?? []} />
          </div>
        )}
      </div>
    </main>
  );
}
