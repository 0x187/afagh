import { useEffect } from 'react';

// ═══ ثبت Service Worker — پورت PwaRegister سامانهٔ فعلی ═══
// فقط در production (build واقعی)؛ در dev ثبت نمی‌شود تا HMR دست‌نخورده بماند.
export function PwaRegister() {
  useEffect(() => {
    if (import.meta.env.PROD && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        /* نبود SW تجربهٔ اصلی را نمی‌شکند */
      });
    }
  }, []);
  return null;
}
