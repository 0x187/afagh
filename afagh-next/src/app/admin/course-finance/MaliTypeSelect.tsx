'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { setCourseMaliTypeAction } from './actions';
import { MALI_TYPE_OPTIONS } from '@/lib/mali-types';

/**
 * سلول ویرایش «نوع درس مالی» — با انتخاب، بلافاصله ذخیره می‌شود.
 *
 * چرا سلکت و نه فرم؟ چون کارشناس باید بتواند پشت‌سرهم چند درس را رد کند؛
 * یک کلیک اضافهٔ «ذخیره» برای هر ردیف عملاً کار را کند می‌کرد.
 */
export default function MaliTypeSelect({
  courseId,
  value,
  charging,
}: {
  courseId: number;
  value: number | null;
  /** آیا نوع فعلی در تعرفهٔ همین سال نرخ دارد؟ (برای رنگ‌دهی) */
  charging: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [current, setCurrent] = useState<number | null>(value);
  const [err, setErr] = useState<string | null>(null);

  const onChange = (raw: string) => {
    const next = raw === '' ? null : Number(raw);
    const prev = current;
    setCurrent(next);
    setErr(null);
    startTransition(async () => {
      const res = await setCourseMaliTypeAction(courseId, next);
      if (!res.ok) {
        setCurrent(prev); // برگشت به مقدار قبلی تا UI دروغ نگوید
        setErr(res.error ?? 'ذخیره نشد.');
        return;
      }
      router.refresh();
    });
  };

  const tone =
    current == null
      ? 'border-rose-300 bg-rose-50 text-rose-800'
      : charging
        ? 'border-slate-300 bg-white text-slate-800'
        : 'border-amber-300 bg-amber-50 text-amber-900';

  return (
    <div className="flex flex-col gap-1">
      <select
        value={current == null ? '' : String(current)}
        onChange={(e) => onChange(e.target.value)}
        disabled={pending}
        aria-label="نوع درس مالی"
        className={`input !py-1 !px-2 min-w-40 border ${tone} ${pending ? 'opacity-60' : ''}`}
      >
        <option value="">— تعیین‌نشده —</option>
        {MALI_TYPE_OPTIONS.map((o) => (
          <option key={o.value} value={String(o.value)}>
            {o.value} — {o.label}
          </option>
        ))}
      </select>
      {err && <span className="text-3xs text-rose-700">{err}</span>}
    </div>
  );
}
