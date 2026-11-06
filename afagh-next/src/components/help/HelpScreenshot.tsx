'use client';

import { useState } from 'react';

type Props = {
  role: string;
  slug: string;
  n: number;
  caption: string;
  alt: string;
};

function faNum(n: number): string {
  return n.toLocaleString('fa-IR');
}

export default function HelpScreenshot({ role, slug, n, caption, alt }: Props) {
  const [stage, setStage] = useState<0 | 1 | 2>(0);
  const [open, setOpen] = useState(false);
  const png = `/help/${role}/${slug}-${n}.png`;
  const svg = `/help/${role}/${slug}-${n}.svg`;
  const src = stage === 0 ? png : svg;

  return (
    <figure className="my-4 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
      {stage < 2 ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="block w-full cursor-zoom-in"
          title="بزرگ‌نمایی تصویر"
        >
          <img
            src={src}
            alt={alt}
            loading="lazy"
            onError={() => setStage(s => (s === 0 ? 1 : 2))}
            className="max-h-96 w-full object-contain bg-white"
          />
        </button>
      ) : (
        <div
          className="flex min-h-40 flex-col items-center justify-center gap-1 border-b border-dashed border-slate-300 bg-slate-100/70 p-6 text-center"
          role="img"
          aria-label={alt}
        >
          <span className="text-2xl">🖼️</span>
          <span className="text-xs font-black text-slate-500">تصویر این مرحله</span>
          <span className="max-w-md text-2xs leading-relaxed text-slate-400">{caption}</span>
        </div>
      )}
      <figcaption className="flex items-start gap-2 px-4 py-2.5 text-2xs leading-relaxed text-slate-500">
        <span className="mt-0.5 shrink-0 rounded-md bg-slate-800 px-1.5 py-0.5 text-3xs font-black text-white">
          {faNum(n)}
        </span>
        <span>{caption}</span>
      </figcaption>
      {open && stage < 2 && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label={alt}
        >
          <div className="max-h-[90vh] max-w-5xl overflow-auto rounded-2xl bg-white p-3" onClick={e => e.stopPropagation()}>
            <img src={src} alt={alt} className="max-h-[78vh] w-auto max-w-full object-contain" />
            <div className="flex items-center justify-between gap-3 px-1 pt-2">
              <p className="text-xs text-slate-600">{caption}</p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="shrink-0 rounded-xl bg-slate-800 px-4 py-2 text-xs font-bold text-white hover:bg-slate-700"
              >
                بستن
              </button>
            </div>
          </div>
        </div>
      )}
    </figure>
  );
}
