import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { getSiblingAccounts, switchAccount } from '@/lib/auth-api';
import { availablePanels, panelRoleHint, type PanelKey } from '@/lib/panel-links';

// ═══ "Inboxes and accounts" switcher — port of PanelSwitcher.tsx ═══
//
// 1) A multi-role user navigates between allowed inboxes (the system's current routes
//    until each module is ported — full navigation).
// 2) Same-person accounts with the same national ID are opened with that account's own password.
export function PanelSwitcher({ roles, current }: { roles: string[]; current?: PanelKey }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const { data: siblingsData } = useQuery({
    queryKey: ['siblings'],
    queryFn: getSiblingAccounts,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const siblings = siblingsData?.accounts ?? [];

  const panels = availablePanels(roles);
  const others = panels.filter((l) => l.key !== current);
  const total = others.length + siblings.length;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
        setOpenFor(null);
        setPw('');
        setErr('');
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setOpenFor(null);
        setPw('');
        setErr('');
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (total === 0) return null;

  async function go(kind: 'staff' | 'student', code: string) {
    if (!pw) {
      setErr('رمز این حساب را وارد کنید.');
      return;
    }
    setBusy(true);
    setErr('');
    const res = await switchAccount(kind, code, pw);
    if (!res.ok) {
      setErr(res.error || 'انجام نشد.');
      setBusy(false);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ['session'] });
    if (res.mustChange) window.location.assign('/app/change-password');
    else window.location.reload();
  }

  function close() {
    setOpen(false);
    setOpenFor(null);
    setPw('');
    setErr('');
  }

  return (
    <div className="md:relative" ref={boxRef}>
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        aria-haspopup="menu"
        className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/10 px-2.5 py-1.5 text-xs font-bold text-white transition hover:bg-white/20"
        title="تعویض کارتابل (نقش) یا حساب دیگری با همین کدملی"
      >
        <span aria-hidden>🔀</span>
        <span className="hidden sm:inline">کارتابل‌ها و حساب‌ها</span>
        <span className="sm:hidden">کارتابل</span>
        <span className="rounded-full bg-white/25 px-1.5 text-[10px] font-black leading-5">
          {total.toLocaleString('fa-IR')}
        </span>
      </button>

      {open && (
        <div
          role="menu"
          dir="rtl"
          className="absolute inset-x-0 top-full z-50 mt-2 overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-2xl md:inset-x-auto md:left-auto md:right-0 md:w-80"
        >
          {panels.length > 0 && (
            <div className="p-2">
              <p className="px-2 pt-1 pb-1 text-[11px] font-black text-muted-foreground">کارتابل‌های من</p>
              {panels.map((l) => {
                const hint = panelRoleHint(l.key, roles);
                const isCurrent = l.key === current;
                const body = (
                  <>
                    <span className="text-base leading-6" aria-hidden>
                      {l.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block text-sm font-bold ${isCurrent ? 'text-primary' : ''}`}>{l.label}</span>
                      {hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}
                    </span>
                    {isCurrent && (
                      <span className="shrink-0 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-black text-accent-foreground">
                        اینجا هستید
                      </span>
                    )}
                  </>
                );
                return isCurrent ? (
                  <div
                    key={l.key}
                    aria-current="page"
                    className="flex items-start gap-2 rounded-lg bg-accent px-2 py-2 ring-1 ring-inset ring-accent-foreground/20"
                  >
                    {body}
                  </div>
                ) : l.spaHref ? (
                  <Link
                    key={l.key}
                    to={l.spaHref}
                    role="menuitem"
                    onClick={close}
                    className="flex items-start gap-2 rounded-lg px-2 py-2 transition hover:bg-muted"
                  >
                    {body}
                  </Link>
                ) : (
                  <a
                    key={l.key}
                    href={l.href}
                    role="menuitem"
                    onClick={close}
                    className="flex items-start gap-2 rounded-lg px-2 py-2 transition hover:bg-muted"
                  >
                    {body}
                  </a>
                );
              })}
            </div>
          )}

          {siblings.length > 0 && (
            <div className={`p-2 ${panels.length > 0 ? 'border-t border-border' : ''} bg-amber-50/70 dark:bg-amber-950/30`}>
              <p className="px-2 pt-1 pb-1 text-[11px] font-black text-amber-700 dark:text-amber-300">
                حساب‌های دیگر با همین کدملی
              </p>
              {siblings.map((s) => {
                const key = `${s.kind}:${s.code}`;
                return (
                  <div key={key} className="mb-1.5 rounded-lg border border-border bg-card p-2 shadow-sm last:mb-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-bold">
                          {s.kind === 'staff' ? '👨‍🏫 کد پرسنلی' : '🎓 شماره دانشجویی'} {s.code}
                        </p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {s.name}
                          {s.universityTitle ? ` · ${s.universityTitle}` : ''}
                        </p>
                      </div>
                      {openFor !== key && (
                        <button
                          type="button"
                          onClick={() => {
                            setOpenFor(key);
                            setPw('');
                            setErr('');
                          }}
                          className="shrink-0 rounded-lg bg-primary px-2.5 py-1 text-[11px] font-bold text-primary-foreground hover:opacity-90"
                        >
                          ورود با این کد ←
                        </button>
                      )}
                    </div>
                    {openFor === key && (
                      <div className="mt-2 flex items-center gap-1.5">
                        <input
                          type="password"
                          dir="ltr"
                          placeholder="رمز این حساب"
                          value={pw}
                          onChange={(e) => setPw(e.target.value)}
                          className="min-w-0 flex-1 rounded-lg border border-input bg-card px-2 py-1 text-left text-xs"
                          autoComplete="current-password"
                          autoFocus
                        />
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => go(s.kind, s.code)}
                          className="rounded-lg bg-emerald-700 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-emerald-800 disabled:opacity-60"
                        >
                          {busy ? '…' : 'ورود'}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setOpenFor(null);
                            setPw('');
                            setErr('');
                          }}
                          className="rounded-lg px-1.5 py-1 text-[11px] text-muted-foreground hover:underline"
                        >
                          انصراف
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
              {err && (
                <p className="mt-1 rounded-lg bg-red-50 p-1.5 text-center text-[11px] font-bold text-red-700 dark:bg-red-950 dark:text-red-200">
                  {err}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
