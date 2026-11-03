'use client';

import { useEffect } from 'react';

/**
 * آخرین خط دفاع: خطایی که در خودِ layout ریشه رخ دهد به error.tsx نمی‌رسد و
 * Next صفحهٔ پیش‌فرض انگلیسی را نشان می‌دهد. این فایل باید تگ html/body خودش
 * را داشته باشد چون جای layout ریشه را می‌گیرد.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[global error]', error);
    // استک به لاگ سرور می‌رود تا عیب‌یابی بدون اسکرین‌شات کاربر ممکن باشد
    void fetch('/api/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        where: 'global-error.tsx',
        url: typeof window !== 'undefined' ? window.location.href : '',
        message: error?.message,
        stack: error?.stack,
      }),
    }).catch(() => {});
  }, [error]);

  return (
    <html lang="fa" dir="rtl">
      <body style={{ margin: 0, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a101c', fontFamily: 'system-ui, Tahoma, sans-serif' }}>
        <div style={{ background: '#1e293b', borderRadius: 24, padding: 32, maxWidth: 420, width: '100%', textAlign: 'center', border: '1px solid #253248', boxShadow: '0 10px 30px rgba(0,0,0,.4)' }}>
          <div style={{ fontSize: 44 }}>⚠️</div>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: '#eef2f9', margin: '12px 0 6px' }}>سامانه موقتاً در دسترس نیست</h1>
          <p style={{ fontSize: 12, color: '#93a1b5', fontWeight: 700, lineHeight: 1.9, margin: 0 }}>
            خطایی بنیادی در بارگذاری سامانه رخ داد. لطفاً چند لحظه بعد دوباره تلاش کنید؛ اگر تکرار شد، کد پیگیری را به پشتیبانی اعلام کنید.
          </p>
          {error.digest && (
            <p style={{ fontSize: 11, color: '#64748b', marginTop: 12, fontFamily: 'monospace' }} dir="ltr">
              کد پیگیری: {error.digest}
            </p>
          )}
          <button
            onClick={reset}
            style={{ marginTop: 18, padding: '10px 20px', borderRadius: 16, border: 0, background: '#1e1b4b', color: '#fff', fontWeight: 900, fontSize: 12, cursor: 'pointer' }}
          >
            تلاش دوباره
          </button>
        </div>
      </body>
    </html>
  );
}
