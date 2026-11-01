import { useQuery } from '@tanstack/react-query';

import { getScope, setTerm } from '@/lib/scope-api';

// ═══ "Active semester" switcher — port of TermSwitcher.tsx ═══
// Native <details>/<summary> to resist missing hydration; selection via POST
// then a full page refresh (same as the original behavior: the cookie must take effect on the next render).
export function TermSwitcher() {
  const { data, isLoading } = useQuery({
    queryKey: ['scope'],
    queryFn: getScope,
    staleTime: 60_000,
  });

  if (isLoading || !data?.ok || data.terms.length === 0) return null;

  const current = data.terms.find((t) => t.id === data.selectedTermId) ?? null;

  const onPick = async (termId: number | null) => {
    try {
      await setTerm(termId);
    } catch {
      /* Error → cookie unchanged; a refresh is pointless too */}
      return;
    }
    window.location.reload();
  };

  const rowClass = (active: boolean) =>
    `flex w-full items-center gap-2 px-3 py-2 text-right text-xs transition-colors ${
      active ? 'bg-slate-700 font-extrabold text-white' : 'text-slate-200 hover:bg-slate-800'
    }`;

  return (
    <details className="md:relative">
      <summary
        title="نیمسال فعال — همهٔ فهرست‌ها و کارنامه‌ها بر اساس این انتخاب فیلتر می‌شوند"
        className="flex cursor-pointer list-none items-center gap-1.5 rounded-lg border border-white/25 bg-white/15 px-2 py-1.5 text-xs font-bold text-white select-none hover:bg-white/25 [&::-webkit-details-marker]:hidden"
      >
        <span className="text-[10px] opacity-70">🗓</span>
        <span className="hidden text-[10px] opacity-80 sm:inline">نیمسال</span>
        <span className="max-w-24 truncate sm:max-w-36">{current ? current.title : 'همهٔ نیمسال‌ها'}</span>
        <span className="text-[10px] opacity-70">▾</span>
      </summary>
      <div className="absolute inset-x-0 top-full z-50 mt-1 overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl md:inset-x-auto md:left-auto md:min-w-56 md:right-0 md:w-auto">
        <div className="max-h-80 overflow-y-auto py-1">
          <button type="button" onClick={() => onPick(null)} className={rowClass(data.selectedTermId == null)}>
            <span className="flex-1 truncate">همهٔ نیمسال‌ها</span>
            {data.selectedTermId == null && <span className="font-bold text-emerald-400">✓</span>}
          </button>
          <div className="my-1 border-t border-white/10" />
          {data.terms.map((t) => {
            const active = t.id === data.selectedTermId;
            return (
              <button key={t.id} type="button" onClick={() => onPick(t.id)} className={rowClass(active)}>
                <span className="flex-1 truncate text-right">
                  {t.title}
                  <span className="font-mono opacity-60" dir="ltr">
                    {' '}
                    ({t.termCode})
                  </span>
                </span>
                {t.isEffectiveCurrent && (
                  <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold text-emerald-800">
                    نیمسال جاری
                  </span>
                )}
                {active && <span className="shrink-0 font-bold text-emerald-400">✓</span>}
              </button>
            );
          })}
        </div>
      </div>
    </details>
  );
}
