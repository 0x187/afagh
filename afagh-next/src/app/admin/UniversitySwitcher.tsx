import { uniDot } from '@/lib/university-theme';

/**
 * انتخاب «دانشگاه فعال» — با POST ساده به `/api/scope/university`.
 *
 * ⚠ چرا `<details>` بومی و نه دکمهٔ React؟
 *   نسخهٔ قبلی با `useState` باز/بسته می‌شد؛ اگر هایدریشن صفحه انجام نشود
 *   (باندل کهنه پس از استقرار، خطای JS، شبکهٔ کند) کلیک روی دکمه هیچ کاری
 *   نمی‌کند و کاربر فکر می‌کند سوییچر خراب است. `<details>/<summary>` را
 *   خودِ مرورگر مدیریت می‌کند: **بدون جاوااسکریپت** باز می‌شود و هر گزینه
 *   یک فرم POST معمولی است.
 *
 * نکته: فرم با POST کامل صفحه را ترک می‌کند، پس بستن دستی لازم نیست.
 */
export default function UniversitySwitcher({
  universities, currentCode, buttonClass,
}: {
  universities: { code: string; title: string; kind: string }[];
  currentCode: string;
  buttonClass?: string;
}) {
  if (!universities || universities.length < 2) return null;
  const cur = universities.find(u => u.code === currentCode) ?? universities[0];

  return (
    <details className="md:relative">
      <summary
        title="دانشگاه فعال — همهٔ لیست‌ها بر اساس این انتخاب فیلتر می‌شود"
        className={`${buttonClass ?? 'bg-indigo-700 hover:bg-indigo-600 border-indigo-500'} list-none [&::-webkit-details-marker]:hidden text-white border rounded-lg px-2 py-1.5 text-xs font-bold cursor-pointer flex items-center gap-1.5 select-none`}
      >
        <span className={`inline-block w-2.5 h-2.5 rounded-full ${uniDot(cur.code)} ring-1 ring-white/40`} />
        <span className="max-w-36 truncate">{cur.title}{cur.kind === 'DISSOLVED' ? ' (منحله)' : ''}</span>
        <span className="text-3xs opacity-70">▾</span>
      </summary>
      <div className="absolute inset-x-0 top-full z-50 mt-1 overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl md:inset-x-auto md:right-0 md:left-auto md:min-w-52 md:w-auto">
        {universities.map(u => {
          const active = u.code === currentCode;
          return (
            <form key={u.code} action="/api/scope/university" method="post" className="block">
              <input type="hidden" name="code" value={u.code} />
              <button
                type="submit"
                disabled={active}
                className={`flex w-full items-center gap-2 px-3 py-2 text-right text-xs transition-colors disabled:cursor-default ${
                  active ? 'bg-slate-700 font-extrabold text-white' : 'text-slate-200 hover:bg-slate-800'
                }`}
              >
                <span className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${uniDot(u.code)}`} />
                <span className="flex-1 truncate">
                  {u.title}{u.kind === 'DISSOLVED' ? ' (منحله)' : ''}
                </span>
                {active && <span className="text-emerald-400 font-bold">✓</span>}
              </button>
            </form>
          );
        })}
      </div>
    </details>
  );
}
