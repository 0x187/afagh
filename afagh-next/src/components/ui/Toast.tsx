'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { registerToast } from '@/lib/ui-feedback';

/**
 * سیستم اعلان (توست) سراسری — جانشین `alert()`.
 *
 * چرا: در کدبیس ۴۳ فراخوانی `alert()` و ۶۳ فراخوانی `confirm()` بومی وجود
 * داشت (هیچ سیستم اعلان مشترکی نبود؛ فقط دو پیاده‌سازی موضعی). دیالوگ بومی
 * جریان صفحه را قطع می‌کند، دکمه‌هایش به زبان سیستم است و در موبایل کل
 * تعامل را بلاک می‌کند.
 *
 * دسترسی‌پذیری: ناحیهٔ `aria-live="polite"` است، پس screen reader متن پیام را
 * اعلام می‌کند (پیش‌تر `aria-live` در کل پروژه صفر بود).
 * جای‌گیری: `fixed` بالای نوار ناوبری موبایل (`bottom-16`) تا روی تب‌های پایین
 * نیفتد و هنگام چاپ مخفی است.
 */

export type ToastKind = 'success' | 'error' | 'info';
type Item = { id: number; kind: ToastKind; text: string };

const ToastCtx = createContext<(text: string, kind?: ToastKind) => void>(() => {});

const STYLE: Record<ToastKind, string> = {
  success: 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100',
  error: 'border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-100',
  info: 'border-slate-300 bg-white text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100',
};
const ICON: Record<ToastKind, string> = { success: '✓', error: '!', info: 'i' };

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);

  const push = useCallback((text: string, kind: ToastKind = 'info') => {
    const id = Date.now() + Math.random();
    setItems(prev => [...prev.slice(-3), { id, kind, text }]);
    window.setTimeout(() => setItems(prev => prev.filter(i => i.id !== id)), 6000);
  }, []);

  const remove = useCallback((id: number) => {
    setItems(prev => prev.filter(i => i.id !== id));
  }, []);

  /* ثبتِ توست در پلِ سراسری تا ماژول‌های غیرکامپوننتی هم بتوانند پیام بدهند
     (جزئیات در src/lib/ui-feedback.ts). */
  useEffect(() => {
    registerToast((text, kind = 'info') => push(text, kind));
    return () => registerToast(null);
  }, [push]);

  const value = useMemo(() => push, [push]);

  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-3 bottom-16 z-[70] flex flex-col gap-2 sm:inset-x-auto sm:left-4 sm:w-96 print:hidden"
      >
        {items.map(i => (
          <div
            key={i.id}
            className={`pointer-events-auto flex items-start gap-2 rounded-xl border p-3 text-xs font-bold shadow-lg animate-in fade-in ${STYLE[i.kind]}`}
          >
            <span aria-hidden className="mt-0.5 shrink-0 font-black">{ICON[i.kind]}</span>
            <span className="min-w-0 flex-1 leading-6">{i.text}</span>
            <button
              type="button"
              onClick={() => remove(i.id)}
              aria-label="بستن پیام"
              className="grid shrink-0 place-items-center rounded-md p-1 opacity-70 transition-opacity hover:opacity-100"
            >
              <svg aria-hidden viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}
