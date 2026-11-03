'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import Modal from './Modal';
import { registerConfirm, type ConfirmOptions } from '@/lib/ui-feedback';

/**
 * `confirm()` قابل‌وعده — جانشین ۶۳ فراخوانی `window.confirm` در کدبیس.
 *
 * استفاده:
 *   const confirm = useConfirm();
 *   if (!(await confirm({ title: '…', body: '…', danger: true }))) return;
 *
 * چرا: دیالوگ بومی قابل ترجمه/استایل‌دهی نیست، در موبایل کل صفحه را بلاک
 * می‌کند و متن مخرب را از متن بی‌خطر جدا نمی‌کند (دکمهٔ تأییدِ حذف و
 * «فعال‌سازی» هر دو OK است). این نسخه با `danger` دکمهٔ قرمز و متن هشدار
 * نشان می‌دهد و فوکوس را روی «انصراف» می‌گذارد.
 */
type Options = {
  title: string;
  body?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
};

const Ctx = createContext<(o: Options) => Promise<boolean>>(async () => false);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<{ opts: Options; resolve: (v: boolean) => void } | null>(null);

  const confirm = useCallback(
    (opts: Options) => new Promise<boolean>(resolve => setPending({ opts, resolve })),
    []
  );

  const answer = useCallback(
    (v: boolean) => {
      setPending(p => {
        p?.resolve(v);
        return null;
      });
    },
    []
  );

  const value = useMemo(() => confirm, [confirm]);

  /* ثبت در پلِ سراسری: کدِ بیرون از کامپوننت هم می‌تواند `askConfirm()` بزند
     و همین دیالوگ (با ترپ فوکوس و دکمهٔ خطر) باز شود. */
  useEffect(() => {
    registerConfirm((opts) => confirm(opts as Options));
    return () => registerConfirm(null);
  }, [confirm]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <Modal
        open={!!pending}
        onClose={() => answer(false)}
        title={pending?.opts.title ?? ''}
        size="sm"
        footer={
          <>
            <button
              type="button"
              onClick={() => answer(false)}
              className="flex-1 rounded-xl bg-slate-100 px-4 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              {pending?.opts.cancelText ?? 'انصراف'}
            </button>
            <button
              type="button"
              onClick={() => answer(true)}
              className={`flex-1 rounded-xl px-4 py-2 text-xs font-bold text-white transition ${
                pending?.opts.danger
                  ? 'bg-rose-600 hover:bg-rose-500'
                  : 'bg-emerald-700 hover:bg-emerald-600'
              }`}
            >
              {pending?.opts.confirmText ?? 'تأیید'}
            </button>
          </>
        }
      >
        {pending?.opts.body ? (
          <p className="text-xs font-bold leading-6 text-slate-700 dark:text-slate-300">{pending.opts.body}</p>
        ) : null}
        {pending?.opts.danger ? (
          <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 p-2 text-2xs font-bold text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200">
            ⚠️ این عمل بازگشت‌پذیر نیست؛ پیش از تأیید مطمئن شوید.
          </p>
        ) : null}
      </Modal>
    </Ctx.Provider>
  );
}

export function useConfirm() {
  return useContext(Ctx);
}
