import Link from 'next/link';

/** نوار مراحل شش‌گانه — معادل جریان «تبدیل اطلاعات سازمان سنجش» در ساما */
const STEPS = [
  { key: 'files', label: 'فایل‌ها', href: '/admin/sanjesh' },
  { key: 'fields', label: 'تطبیق فیلدها', href: 'fields' },
  { key: 'values', label: 'جدول براورد', href: 'values' },
  { key: 'rows', label: 'لیست سنجش', href: 'rows' },
  { key: 'matched', label: 'تطبیق داده شده', href: 'matched' },
  { key: 'enrolled', label: 'ثبت‌نام شده', href: 'enrolled' },
] as const;

export function SanjeshSteps({ fileId, active }: { fileId: number; active: string }) {
  return (
    <nav className="mb-4 flex flex-wrap items-center gap-1.5 text-xs" aria-label="مراحل تبدیل اطلاعات سنجش">
      {STEPS.map((s, i) => {
        const href = s.key === 'files' ? '/admin/sanjesh' : `/admin/sanjesh/${fileId}/${s.href}`;
        const isActive = s.key === active;
        return (
          <span key={s.key} className="flex items-center gap-1.5">
            <Link
              href={href}
              className={
                isActive
                  ? 'rounded-lg bg-teal-600 px-2.5 py-1 font-medium text-white shadow-sm'
                  : 'rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-slate-600 hover:bg-slate-50'
              }
            >
              <span className="opacity-60">{i + 1}.</span> {s.label}
            </Link>
            {i < STEPS.length - 1 && <span className="text-slate-300">‹</span>}
          </span>
        );
      })}
    </nav>
  );
}

export function Flash({ msg, err }: { msg?: string; err?: string }) {
  if (!msg && !err) return null;
  return (
    <div
      className={
        err
          ? 'mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700'
          : 'mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800'
      }
    >
      {err ?? msg}
    </div>
  );
}

/** شمارندهٔ کوچک */
export function Counter({ label, value, tone = 'slate' }: { label: string; value: number; tone?: 'slate' | 'emerald' | 'amber' | 'red' | 'sky' }) {
  const tones: Record<string, string> = {
    slate: 'border-slate-200 bg-white text-slate-700',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    amber: 'border-amber-200 bg-amber-50 text-amber-800',
    red: 'border-red-200 bg-red-50 text-red-700',
    sky: 'border-sky-200 bg-sky-50 text-sky-800',
  };
  return (
    <div className={`rounded-xl border px-3 py-1.5 text-center ${tones[tone]}`}>
      <div className="text-[10px] opacity-70">{label}</div>
      <div className="text-sm font-semibold tabular-nums">{value.toLocaleString('fa-IR')}</div>
    </div>
  );
}
