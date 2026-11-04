'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { switchAccountAction, type SiblingAccount } from '@/lib/account-switch';
import { availablePanels, panelRoleHint, type PanelKey } from '@/lib/panel-links';

/**
 * سوییچر واحد «کارتابل‌ها و حساب‌ها» — بالای همهٔ پنل‌ها.
 *
 * دو مسئله را با هم حل می‌کند (قبلاً دو UI جدا بود و یکی از آن‌ها اصلاً در
 * پنل استاد/مدیر گروه وجود نداشت):
 *   ۱) چند نقشی بودن: استاد + مدیر گروه + کارشناس مالی/آموزش با یک کلیک بین
 *      کارتابل‌ها جابه‌جا می‌شد؛ پیش‌تر از پنل استاد راهی به /admin نبود.
 *   ۲) چند حسابی بودن با یک کدملی: حساب‌های هم‌شخص (کد پرسنلی/دانشجویی دیگر)
 *      در همان منو آمده‌اند و جابه‌جایی مثل قبل رمزِ همان حساب را می‌خواهد.
 *
 * کامپوننت کلاینت است چون بخش «حساب دیگر» ورودی رمز و Server Action دارد.
 */
export default function PanelSwitcher({
  roles,
  current,
  permissionCount = 0,
  groupTitle,
  siblings = [],
}: {
  roles: string[];
  current: PanelKey;
  /** تعداد مجوزهای سفارشی (RBAC) — برای نمایش /admin به نقش‌های غیرسیستمی */
  permissionCount?: number;
  /** نام گروه‌های تحت مدیریت — فقط برای لینک مدیر گروه */
  groupTitle?: string;
  /** حساب‌های هم‌شخصِ همین کدملی (از getSiblingAccounts) */
  siblings?: SiblingAccount[];
}) {
  const [open, setOpen] = useState(false);
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  /**
   * همهٔ کارتابل‌ها نمایش داده می‌شوند — از جمله کارتابلِ فعلی (با برچسب
   * «اینجا هستید»). پیش‌تر کارتابل فعلی فیلتر می‌شد و کاربرِ سه‌نقشی فکر
   * می‌کرد نقشش گم شده: از /admin که به استاد می‌رفت، فقط «دانشجو» می‌ماند
   * و معلوم نبود سه کارتابل دارد یا دو تا.
   */
  const panels = availablePanels(roles, permissionCount);
  const others = panels.filter(l => l.key !== current);
  const total = others.length + siblings.length;

  // بستن با کلیک بیرون / Escape
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false); setOpenFor(null); setPw(''); setErr('');
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); setOpenFor(null); setPw(''); setErr(''); }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (total === 0) return null;

  async function go(s: SiblingAccount) {
    if (!pw) { setErr('رمز این حساب را وارد کنید.'); return; }
    setBusy(true); setErr('');
    const res = await switchAccountAction(s.kind, s.code, pw).catch(() => null);
    if (!res) { setErr('ارتباط با سرور برقرار نشد.'); setBusy(false); return; }
    if (!res.ok) { setErr(res.error || 'انجام نشد.'); setBusy(false); return; }
    // نشست عوض شد — ریشه بر اساس نقشِ حساب جدید مسیریابی می‌کند
    if (res.mustChange) window.location.assign('/change-password');
    else window.location.assign('/');
  }

  function close() {
    setOpen(false); setOpenFor(null); setPw(''); setErr('');
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
        {/* در موبایل برچسب کوتاه — تا با سوییچر نیمسال در یک ردیف جا شود */}
        <span className="hidden sm:inline">کارتابل‌ها و حساب‌ها</span>
        <span className="sm:hidden">کارتابل</span>
        <span className="rounded-full bg-white/25 px-1.5 text-3xs font-black leading-5">{total.toLocaleString('fa-IR')}</span>
      </button>

      {open && (
        <div
          role="menu"
          dir="rtl"
          className="absolute inset-x-0 top-full z-50 mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-800 shadow-2xl md:inset-x-auto md:right-0 md:left-auto md:w-80"
        >
          {panels.length > 0 && (
            <div className="p-2">
              <p className="px-2 pb-1 pt-1 text-2xs font-black text-slate-400">کارتابل‌های من</p>
              {panels.map(l => {
                const hint = l.key === 'group-manager' && groupTitle ? `مدیر گروه: ${groupTitle}` : panelRoleHint(l.key, roles);
                const isCurrent = l.key === current;
                const body = (
                  <>
                    <span className="text-base leading-6" aria-hidden>{l.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className={`block text-sm font-bold ${isCurrent ? 'text-indigo-700' : 'text-slate-800'}`}>
                        {l.label}
                        {l.key === 'group-manager' && groupTitle ? <span className="font-normal text-slate-500"> ({groupTitle})</span> : null}
                      </span>
                      {hint && <span className="block text-2xs text-slate-500">{hint}</span>}
                    </span>
                    {isCurrent && (
                      <span className="shrink-0 rounded-full bg-indigo-100 px-1.5 py-0.5 text-3xs font-black text-indigo-700">
                        اینجا هستید
                      </span>
                    )}
                  </>
                );
                return isCurrent ? (
                  <div
                    key={l.key}
                    aria-current="page"
                    className="flex items-start gap-2 rounded-lg bg-indigo-50 px-2 py-2 ring-1 ring-inset ring-indigo-200"
                  >
                    {body}
                  </div>
                ) : (
                  <Link prefetch={false}
                    key={l.key}
                    href={l.href}
                    role="menuitem"
                    onClick={close}
                    className="flex items-start gap-2 rounded-lg px-2 py-2 transition hover:bg-slate-50"
                  >
                    {body}
                  </Link>
                );
              })}
            </div>
          )}

          {siblings.length > 0 && (
            <div className={`p-2 ${panels.length > 0 ? 'border-t border-slate-200' : ''} bg-amber-50/70`}>
              <p className="px-2 pb-1 pt-1 text-2xs font-black text-amber-700">
                حساب‌های دیگر با همین کدملی
              </p>
              {siblings.map(s => {
                const key = `${s.kind}:${s.code}`;
                return (
                  <div key={key} className="mb-1.5 rounded-lg bg-white p-2 shadow-xs last:mb-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-slate-800">
                          {s.kind === 'staff' ? '👨‍🏫 کد پرسنلی' : '🎓 شماره دانشجویی'} {s.code}
                        </p>
                        <p className="truncate text-2xs text-slate-500">
                          {s.name}{s.universityTitle ? ` · ${s.universityTitle}` : ''}
                        </p>
                      </div>
                      {openFor !== key && (
                        <button
                          type="button"
                          onClick={() => { setOpenFor(key); setPw(''); setErr(''); }}
                          className="shrink-0 rounded-lg bg-indigo-700 px-2.5 py-1 text-2xs font-bold text-white hover:bg-indigo-800"
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
                          className="w-32 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1 text-left text-xs"
                          autoComplete="current-password"
                          autoFocus
                        />
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => go(s)}
                          className="rounded-lg bg-emerald-700 px-2.5 py-1 text-2xs font-bold text-white hover:bg-emerald-800 disabled:opacity-60"
                        >
                          {busy ? '…' : 'ورود'}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => { setOpenFor(null); setPw(''); setErr(''); }}
                          className="rounded-lg bg-white px-1.5 py-1 text-2xs text-slate-500 hover:underline"
                        >
                          انصراف
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
              {err && <p className="mt-1 rounded-lg bg-red-50 p-1.5 text-center text-2xs font-bold text-red-700">{err}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
