'use client';

import { useRef } from 'react';
import { deleteEvaluationPeriodAction } from './actions';
import { askConfirm } from '@/lib/ui-feedback';

/**
 * دکمهٔ حذف دوره با تأیید — جدا شده چون سرورکامپوننت هندلر رویداد ندارد.
 *
 * تأیید با دیالوگ استایل‌دار انجام می‌شود (قبلاً `confirm()` بومی بود که در
 * موبایل کل صفحه را بلاک می‌کرد و دکمه‌هایش ترجمه‌نشده بود). چون تأیید
 * غیرهمگام است، ارسال فرم یک‌بار متوقف و پس از تأیید با پرچم `bypass`
 * دوباره ارسال می‌شود.
 */
export default function DeletePeriodButton({ id }: { id: number }) {
  const bypass = useRef(false);

  return (
    <form
      action={deleteEvaluationPeriodAction}
      className="inline"
      onSubmit={(e) => {
        if (bypass.current) {
          bypass.current = false;
          return; // ارسالِ تأییدشده — بگذار انجام شود
        }
        e.preventDefault();
        const form = e.currentTarget;
        void askConfirm({
          title: 'حذف دورهٔ ارزشیابی',
          body: 'این دورهٔ ارزشیابی حذف شود؟ پاسخ‌های ثبت‌شدهٔ آن هم از دسترس خارج می‌شوند.',
          confirmText: 'حذف کن',
          danger: true,
        }).then((ok) => {
          if (!ok) return;
          bypass.current = true;
          if (typeof form.requestSubmit === 'function') form.requestSubmit();
          else form.submit();
        });
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button className="rounded-lg bg-red-50 px-2 py-1 font-bold text-red-700 hover:bg-red-100">حذف</button>
    </form>
  );
}

