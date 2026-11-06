'use client';

import { useId } from 'react';

/**
 * فیلد فرم استاندارد: برچسبِ متصل، راهنما و خطای درجا.
 *
 * چرا: ۷۱۵ `<label>` در کدبیس فقط **۱** `htmlFor` داشت و ۳۶۹ فیلد تنها با
 * `placeholder` راهنمایی می‌شد؛ یعنی کلیک روی برچسب فوکوس نمی‌داد، نام فیلد
 * برای screen reader خوانده نمی‌شد و خطای اعتبارسنجی هیچ‌جا `aria-invalid`
 * نداشت.
 */
export default function Field({
  label,
  hint,
  error,
  required,
  htmlFor,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  /** شناسهٔ ورودی؛ اگر ندهید، شناسهٔ تولیدی داخل children تزریق نمی‌شود. */
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const auto = useId();
  const id = htmlFor ?? auto;
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;

  return (
    <div className={`space-y-1 ${className ?? ''}`}>
      <label htmlFor={id} className="block text-2xs font-bold text-slate-600 dark:text-slate-300">
        {label}
        {required ? <span className="ms-1 text-rose-600 dark:text-rose-400" aria-hidden>*</span> : null}
      </label>
      {children}
      {hint ? (
        <p id={hintId} className="text-3xs leading-5 text-slate-500 dark:text-slate-400">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errId} role="alert" className="text-3xs font-bold leading-5 text-rose-700 dark:text-rose-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** شناسه‌های لازم برای اتصال ورودیِ خودساخته به برچسب/خطا در یک شیء. */
export function fieldA11y(id: string, opts?: { hint?: boolean; error?: boolean }) {
  return {
    id,
    'aria-describedby': [opts?.hint ? `${id}-hint` : null, opts?.error ? `${id}-err` : null]
      .filter(Boolean)
      .join(' ') || undefined,
    'aria-invalid': opts?.error ? true : undefined,
  } as const;
}
