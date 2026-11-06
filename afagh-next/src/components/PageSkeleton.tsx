import React from 'react';

/**
 * اسکلتون مشترکِ «در حال بارگذاری» برای فایل‌های `loading.tsx` شاخه‌ها.
 *
 * چرا لازم شد: در کل پروژه (۱۵۸ صفحه) هیچ `loading.tsx`ای وجود نداشت، پس با
 * App Router ناوبری تا پایان رندرِ سروری کاملاً بی‌واکنش بود؛ در کوئری‌های
 * سنگین کاربر فکر می‌کرد کلیکش کار نکرده و دوباره می‌زد.
 *
 * دسترسی‌پذیری: `role="status"` + `aria-live="polite"` + `aria-busy` تا
 * screen reader «در حال بارگذاری» را اعلام کند (پیش‌تر `aria-live` در کل
 * پروژه صفر بود) و متن پنهانِ `sr-only` برای همان اعلام.
 */
export default function PageSkeleton({
  cards = 4,
  rows = 5,
  label = 'در حال بارگذاری…',
}: {
  cards?: number;
  rows?: number;
  label?: string;
}) {
  return (
    <div className="space-y-3 p-1 sm:p-2" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      <div className="flex items-center gap-2">
        <div className="h-8 w-52 max-w-[60%] animate-pulse rounded-lg bg-slate-200" />
        <div className="h-8 w-24 animate-pulse rounded-lg bg-slate-200/70" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: cards }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-2xl border border-slate-200 bg-white" />
        ))}
      </div>
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="flex gap-3 border-b border-slate-100 bg-slate-50/70 p-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-3 flex-1 animate-pulse rounded bg-slate-200" />
          ))}
        </div>
        <div className="divide-y divide-slate-100">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="flex gap-3 p-3">
              {Array.from({ length: 4 }).map((_, j) => (
                <div
                  key={j}
                  className="h-3 flex-1 animate-pulse rounded bg-slate-100"
                  style={{ animationDelay: `${(i + j) * 60}ms` }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
