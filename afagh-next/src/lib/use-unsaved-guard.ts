'use client';

import { useEffect, useRef } from 'react';

/**
 * هشدار «تغییرات ذخیره‌نشده» — پیش از این فقط ۲ فراخوانی `beforeunload` در کل
 * پروژه بود، در حالی که فرم‌های ۲٬۷۵۸ خطی (مدیریت دانشجویان) و ۲٬۲۳۵ خطی
 * (پذیرش) وجود دارد؛ رفرشِ تصادفی یعنی از دست رفتن کل فرم بدون هیچ هشدار.
 *
 * استفاده:
 *   const [dirty, setDirty] = useState(false);
 *   useUnsavedGuard(dirty);            // dirty=true ⇒ رفرش/بستن تب هشدار می‌دهد
 */
export function useUnsavedGuard(dirty: boolean, message = 'تغییرات ذخیره‌نشده دارید. از صفحه خارج می‌شوید؟') {
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = message; // لازم برای کروم/سافاری
      return message;
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty, message]);
}

/**
 * نسخهٔ ساده برای فرم‌های بدون state مرکزی: هر `input`/`change` را «کثیف» حساب
 * می‌کند و `dirty` را برمی‌گرداند. با `reset()` بعد از ذخیرهٔ موفق صفر می‌شود.
 */
export function useFormDirtyGuard<T extends HTMLElement = HTMLFormElement>(message?: string) {
  const ref = useRef<T | null>(null);
  const dirty = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = () => { dirty.current = true; };
    el.addEventListener('input', set, true);
    el.addEventListener('change', set, true);
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirty.current) return;
      e.preventDefault();
      e.returnValue = message ?? 'تغییرات ذخیره‌نشده دارید.';
      return e.returnValue;
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      el.removeEventListener('input', set, true);
      el.removeEventListener('change', set, true);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [message]);

  return { ref, reset: () => { dirty.current = false; } };
}
