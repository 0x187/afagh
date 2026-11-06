'use client';

import { useEffect, useRef } from 'react';

/**
 * دیالوگ مشترک — جانشین مودال‌های دستیِ `fixed inset-0` و دیالوگ‌های بومی.
 *
 * چرا: در کدبیس ۵۰ پوششِ مودالِ دستی وجود داشت که تنها ۴ مورد `role="dialog"`
 * داشتند و **هیچ‌کدام** ترپ فوکوس، Escape، قفل اسکرول و بازگردانی فوکوس
 * نداشتند؛ کاربر کیبورد پشت مودال گم می‌شد.
 *
 * این کامپوننت:
 *  • `role="dialog"` + `aria-modal` + `aria-labelledby`
 *  • حلقهٔ فوکوس با Tab/Shift+Tab
 *  • بستن با Escape و کلیک روی پرده
 *  • قفل اسکرول بدن و بازگردانی فوکوس به عنصر فراخوان
 *  • در موبایل به‌صورت شیت پایین‌چسب (thumb-friendly) و با `max-h-[90dvh]`
 */
export default function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  const box = useRef<HTMLDivElement>(null);
  const prev = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    prev.current = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusables = () =>
      box.current?.querySelectorAll<HTMLElement>(
        'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])'
      ) ?? [];

    // فوکوس روی اولین کنترلِ داخل دیالوگ — نه روی body
    window.setTimeout(() => focusables()[0]?.focus(), 0);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const list = Array.from(focusables()).filter(el => !el.hasAttribute('disabled'));
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);

    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      prev.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  const maxW = size === 'sm' ? 'sm:max-w-sm' : size === 'lg' ? 'sm:max-w-3xl' : 'sm:max-w-lg';

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/60 p-0 sm:items-center sm:p-4 animate-in fade-in print:hidden"
      onClick={onClose}
    >
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby="afagh-modal-title"
        onClick={e => e.stopPropagation()}
        className={`max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl border border-slate-200 bg-white p-4 shadow-xl sm:rounded-2xl dark:border-slate-700 dark:bg-slate-900 ${maxW}`}
      >
        <div className="mb-3 flex items-center justify-between gap-2 border-b border-slate-100 pb-2 dark:border-slate-800">
          <h2 id="afagh-modal-title" className="text-sm font-black text-slate-900 dark:text-slate-100">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="بستن"
            className="grid place-items-center rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        {children}
        {footer ? (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}
