import { useCallback, useEffect, useState } from 'react';

import type { ShowcaseSlide } from '@/lib/auth-api';

// ═══ اسلایدر صفحهٔ ورود — پورت وفادار ShowcaseSlider.tsx ═══
// چرخش خودکار ۵ ثانیه‌ای + نقطه و فلش؛ گرادیان‌های جایگزین عین اصلی.
const GRADIENTS = [
  'from-emerald-700 via-teal-800 to-slate-900',
  'from-indigo-800 via-indigo-900 to-slate-900',
  'from-amber-600 via-orange-800 to-stone-900',
  'from-cyan-700 via-sky-900 to-slate-900',
];

/** پیوند فقط http/https — پورت isSafeLinkUrl (نسخهٔ کامل در فاز ۹) */
function isSafeLink(url: string): boolean {
  if (!url) return false;
  try {
    const u = new URL(url, window.location.origin);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function ShowcaseSlider({ slides }: { slides: ShowcaseSlide[] }) {
  const [idx, setIdx] = useState(0);
  const n = slides.length;
  const go = useCallback((d: number) => setIdx((i) => (i + d + n) % n), [n]);

  useEffect(() => {
    if (n < 2) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % n), 5000);
    return () => clearInterval(t);
  }, [n]);

  // اگر فهرست کوتاه شد، ایندکس امن شود
  useEffect(() => {
    if (idx >= n && n > 0) setIdx(0);
  }, [idx, n]);

  if (!n) return null;
  const s = slides[Math.min(idx, n - 1)];

  const media = s.imageUrl ? (
    <img src={s.imageUrl} alt={s.title} className="absolute inset-0 h-full w-full object-cover" />
  ) : (
    <div className={`absolute inset-0 bg-gradient-to-l ${GRADIENTS[idx % GRADIENTS.length]}`} />
  );

  return (
    <div className="relative h-52 overflow-hidden rounded-3xl border border-white/20 shadow-2xl sm:h-64">
      {s.linkUrl && isSafeLink(s.linkUrl) ? (
        <a href={s.linkUrl} className="block h-full w-full" aria-label={s.title}>
          {media}
        </a>
      ) : (
        media
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
      <div className="absolute bottom-0 right-0 left-0 p-5 sm:p-6">
        <p className="text-base leading-8 font-black text-white sm:text-xl">{s.title}</p>
        {s.subtitle ? <p className="mt-1 text-xs leading-6 text-white/80 sm:text-sm">{s.subtitle}</p> : null}
      </div>
      {n > 1 && (
        <>
          <button
            type="button"
            aria-label="قبلی"
            onClick={() => go(1)}
            className="absolute top-1/2 right-2 h-8 w-8 -translate-y-1/2 rounded-full bg-black/40 text-sm text-white backdrop-blur hover:bg-black/60"
          >
            ‹
          </button>
          <button
            type="button"
            aria-label="بعدی"
            onClick={() => go(-1)}
            className="absolute top-1/2 left-2 h-8 w-8 -translate-y-1/2 rounded-full bg-black/40 text-sm text-white backdrop-blur hover:bg-black/60"
          >
            ›
          </button>
          <div className="absolute top-3 left-3 flex gap-1.5">
            {slides.map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={`اسلاید ${i + 1}`}
                onClick={() => setIdx(i)}
                className={`h-2 rounded-full transition-all ${i === idx ? 'w-6 bg-white' : 'w-2 bg-white/50 hover:bg-white/80'}`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
