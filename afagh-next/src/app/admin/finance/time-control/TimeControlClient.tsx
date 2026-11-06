'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { LockState } from '@/lib/finance-time-control';

const inputCls =
  'w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500';
const labelCls = 'flex flex-col gap-1 text-2xs font-medium text-slate-600';
const btnCls =
  'rounded-lg bg-emerald-700 hover:bg-emerald-800 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50';

const fa = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('fa-IR') : '—';

/** Date → مقدار محلیِ input[type=datetime-local] (بدون منطقهٔ زمانی) */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function TimeControlClient({ initial }: { initial: LockState }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [periodName, setPeriodName] = useState(initial.period?.periodName ?? '');
  const [opensAt, setOpensAt] = useState(toLocalInput(initial.period?.opensAt));
  const [closesAt, setClosesAt] = useState(toLocalInput(initial.period?.closesAt));
  const [isLocked, setIsLocked] = useState(initial.period?.isLocked ?? false);

  function save() {
    setMsg(null);
    if (!opensAt || !closesAt) {
      setMsg({ ok: false, text: 'تاریخ شروع و پایان دوره الزامی است' });
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch('/api/admin/finance/time-control', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            // اگر دوره‌ای از قبل هست، همان به‌روز می‌شود؛ وگرنه دورهٔ جدید ثبت می‌شود
            ...(initial.period ? { id: initial.period.id } : {}),
            periodName,
            // datetime-local = زمان محلی کاربر → ISO برای سرور
            opensAt: new Date(opensAt).toISOString(),
            closesAt: new Date(closesAt).toISOString(),
            isLocked,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok) {
          setMsg({ ok: true, text: initial.period ? 'دورهٔ مالی به‌روزرسانی شد.' : 'دورهٔ مالی ثبت شد.' });
          router.refresh();
        } else {
          setMsg({ ok: false, text: data.error || 'خطا در ذخیرهٔ دورهٔ مالی' });
        }
      } catch (e) {
        setMsg({ ok: false, text: e instanceof Error ? e.message : 'خطای ناشناخته' });
      }
    });
  }

  // ─── بنر وضعیت فعلی ───
  const banner = !initial.configured
    ? { cls: 'border-amber-300 bg-amber-50 text-amber-800', icon: '⚠️', label: 'دورهٔ مالی تعریف نشده — ثبت مالی محدودیتی ندارد' }
    : initial.entryAllowed
      ? { cls: 'border-emerald-300 bg-emerald-50 text-emerald-800', icon: '✅', label: 'دورهٔ مالی باز است — ثبت مالی مجاز است' }
      : initial.locked
        ? { cls: 'border-rose-300 bg-rose-50 text-rose-800', icon: '🔒', label: 'دورهٔ مالی قفل است — ثبت مالی ممنوع است' }
        : { cls: 'border-rose-300 bg-rose-50 text-rose-800', icon: '⛔', label: 'خارج از بازهٔ دورهٔ مالی — ثبت مالی ممنوع است' };

  return (
    <div className="space-y-4">
      {/* وضعیت فعلی */}
      <div className={`rounded-xl border p-4 ${banner.cls}`}>
        <div className="flex items-center gap-2 font-bold text-sm">
          <span>{banner.icon}</span>
          <span>{banner.label}</span>
        </div>
        <p className="mt-1 text-xs opacity-90">{initial.reason}</p>
        {initial.period && (
          <div className="mt-2 grid grid-cols-1 gap-1 text-2xs sm:grid-cols-3">
            <div>نام دوره: <b>{initial.period.periodName || `#${initial.period.id}`}</b></div>
            <div>از: <b>{fa(initial.period.opensAt)}</b></div>
            <div>تا: <b>{fa(initial.period.closesAt)}</b></div>
          </div>
        )}
      </div>

      {/* فرم تنظیم دوره */}
      <div className="card">
        <h2 className="mb-3 border-b border-slate-100 pb-2 font-bold text-slate-800">
          {initial.period ? 'ویرایش دورهٔ مالی فعال' : 'تعریف دورهٔ مالی'}
        </h2>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className={`${labelCls} sm:col-span-2`}>
            <span>نام دوره (مثلاً «دورهٔ مالی ۱۴۰۴»)</span>
            <input
              className={inputCls}
              value={periodName}
              onChange={(e) => setPeriodName(e.target.value)}
              placeholder="دورهٔ مالی …"
              maxLength={150}
            />
          </label>

          <label className={labelCls}>
            <span>آغاز دوره (تاریخ و ساعت)</span>
            <input type="datetime-local" className={inputCls} value={opensAt} onChange={(e) => setOpensAt(e.target.value)} />
          </label>

          <label className={labelCls}>
            <span>پایان دوره (تاریخ و ساعت)</span>
            <input type="datetime-local" className={inputCls} value={closesAt} onChange={(e) => setClosesAt(e.target.value)} />
          </label>
        </div>

        <label className="mt-3 flex items-center gap-2 text-xs text-slate-700">
          <input
            type="checkbox"
            className="accent-rose-700"
            checked={isLocked}
            onChange={(e) => setIsLocked(e.target.checked)}
          />
          قفل دستی دوره (حتی داخل بازه هم ثبت مالی ممنوع شود)
        </label>

        {msg && (
          <p className={`mt-3 rounded-lg px-3 py-2 text-xs ${msg.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>
            {msg.text}
          </p>
        )}

        <div className="mt-4 flex items-center gap-2">
          <button type="button" className={btnCls} disabled={pending} onClick={save}>
            {pending ? 'در حال ذخیره…' : 'ذخیرهٔ دورهٔ مالی'}
          </button>
          <span className="text-2xs text-slate-500">
            تغییرات بلافاصله اعمال می‌شود؛ اکشن‌های مالی بازهٔ جدید را رعایت می‌کنند.
          </span>
        </div>
      </div>

      {/* توضیح */}
      <div className="card text-2xs leading-6 text-slate-600">
        <b>نحوهٔ اِعمال:</b> ثبت پرداخت، شارژ شهریه، تخفیف، برگشتی و سایر اکشن‌های مالی در ابتدای کار
        <code className="mx-1 rounded bg-slate-100 px-1">assertEntryAllowed()</code>
        را صدا می‌زنند؛ اگر دوره قفل باشد یا زمانِ ثبت خارج از پنجره باشد، عملیات با پیام فارسی رد می‌شود.
        اگر هیچ دوره‌ای تعریف نشده باشد، رفتار سابق (ثبت آزاد) حفظ می‌شود.
      </div>
    </div>
  );
}
