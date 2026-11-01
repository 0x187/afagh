import { useEffect } from 'react';

// ═══ Service Worker registration — port of the current system's PwaRegister ═══
// Only in production (a real build); not registered in dev so HMR stays untouched.
export function PwaRegister() {
  useEffect(() => {
    if (import.meta.env.PROD && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        /* Missing SW doesn't break the main experience */
      });
    }
  }, []);
  return null;
}
