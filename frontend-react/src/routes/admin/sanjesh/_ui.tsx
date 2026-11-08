import { Link } from 'react-router-dom';

import { faDigits, faNumber } from '@/lib/fa';

// ═══ Shared UI of the sanjesh conversion drill-down pages — port of _ui.tsx ═══

/** The six-step flow — the same order as the sama conversion workspace. */
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
              to={href}
              className={
                isActive
                  ? 'rounded-lg bg-teal-600 px-2.5 py-1 font-medium text-white shadow-sm'
                  : 'rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
              }
            >
              <span className="opacity-60">{faDigits(i + 1)}.</span> {s.label}
            </Link>
            {i < STEPS.length - 1 && <span className="text-slate-300">‹</span>}
          </span>
        );
      })}
    </nav>
  );
}

export function SanjeshFlash({ msg, err }: { msg?: string | null; err?: string | null }) {
  if (!msg && !err) return null;
  return (
    <div
      className={
        err
          ? 'mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200'
          : 'mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200'
      }
    >
      {err ?? msg}
    </div>
  );
}

/** Small counter chip. */
export function SanjeshCounter({
  label,
  value,
  tone = 'slate',
}: {
  label: string;
  value: number;
  tone?: 'slate' | 'emerald' | 'amber' | 'red' | 'sky';
}) {
  const tones: Record<string, string> = {
    slate: 'border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200',
    amber: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200',
    red: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200',
    sky: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-200',
  };
  return (
    <div className={`rounded-xl border px-3 py-1.5 text-center ${tones[tone]}`}>
      <div className="text-[10px] opacity-70">{label}</div>
      <div className="text-sm font-semibold tabular-nums">{faNumber(value)}</div>
    </div>
  );
}

export const SANJESH_FILE_STATUS_LABEL: Record<string, string> = {
  DRAFT: 'پیش‌نویس',
  FIELDS_READY: 'تطبیق فیلدها',
  VALUED: 'براورد شده',
  STAGED: 'منتقل به پذیرش',
  DONE: 'تکمیل',
};

export const SANJESH_MATCH_STATUS_BADGE: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
  MATCHED: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200',
  DUPLICATE: 'bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-200',
  INVALID: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-200',
  IGNORED: 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
};

export const SANJESH_MATCH_STATUS_LABEL: Record<string, string> = {
  PENDING: 'در انتظار',
  MATCHED: 'تطبیق‌یافته',
  DUPLICATE: 'تکراری/مبهم',
  INVALID: 'نامعتبر',
  IGNORED: 'نادیده',
};
