import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { getLockState } from '@/lib/finance-time-control';
import TimeControlClient from './TimeControlClient';

export const dynamic = 'force-dynamic';

const FINANCE = ['ADMIN', 'FINANCE_EXPERT', 'FINANCE'];

/**
 * صفحهٔ «کنترل زمانی دقیق ثبت مالی»: تعیین پنجرهٔ دورهٔ مالی باز
 * (opens_at … closes_at) و قفل دستی. اِعمال قفل در ثبت‌های مالی با
 * assertEntryAllowed() در اکشن‌های مالی انجام می‌شود.
 */
export default async function FinanceTimeControlPage() {
  await requireRole(FINANCE);
  const state = await getLockState();

  return (
    <div className="space-y-4" dir="rtl">
      {/* ── سربرگ premium ── */}
      <div className="overflow-hidden rounded-2xl border border-emerald-900/20 bg-gradient-to-l from-emerald-700 via-teal-700 to-slate-900 p-4 text-white shadow-lg print:hidden sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-black sm:text-xl">🔒 کنترل زمانی دقیق ثبت مالی</h1>
            <p className="mt-1 text-xs text-emerald-50/90">
              ثبت مالی فقط داخل پنجرهٔ دورهٔ مالی باز و بدون قفل مجاز است؛ خارج از آن، همهٔ اکشن‌های مالی با پیام فارسی رد می‌شوند.
            </p>
          </div>
          <Link prefetch={false}
            href="/admin/finance"
            className="rounded-lg border border-white/25 bg-white/10 px-3 py-1.5 text-xs font-bold backdrop-blur transition hover:bg-white/20"
          >
            ↩️ بازگشت به کارتابل
          </Link>
        </div>
      </div>

      <TimeControlClient initial={state} />
    </div>
  );
}
