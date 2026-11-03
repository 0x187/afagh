'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { copyTariffYearAction, saveTariffGroupAction, type TariffRateInput } from './actions';

export interface TariffGroup {
  uPriceCode: string;
  source: string;
  rates: { maliType: number; th: number; op: number }[];
  majors: { code: string; title: string; faculty: string; entryYears: number[] }[];
}

const fa = (n: number | string) => Number(n ?? 0).toLocaleString('fa-IR');

export default function TariffClient({
  universityTitle,
  years,
  year,
  groups,
  labels,
}: {
  universityTitle: string;
  years: number[];
  year: number;
  groups: TariffGroup[];
  labels: Record<number, string>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const maxYear = years[0] ?? year;
  const [fromYear, setFromYear] = useState<number>(maxYear);
  const [toYear, setToYear] = useState<number>(maxYear + 1);
  const [overwrite, setOverwrite] = useState(false);

  // ویرایش نرخ‌ها: کلید = «کد گروه|نوع درس»
  const [edits, setEdits] = useState<Record<string, { th: string; op: string }>>({});
  const keyOf = (code: string, mt: number) => `${code}|${mt}`;
  const valOf = (code: string, mt: number, field: 'th' | 'op', orig: number) =>
    edits[keyOf(code, mt)]?.[field] ?? String(orig);

  const setVal = (code: string, mt: number, field: 'th' | 'op', orig: number, v: string) => {
    setEdits((prev) => ({
      ...prev,
      [keyOf(code, mt)]: {
        th: prev[keyOf(code, mt)]?.th ?? String(orig),
        op: prev[keyOf(code, mt)]?.op ?? String(orig),
        [field]: v,
      },
    }));
  };

  const saveGroup = (g: TariffGroup) => {
    const rates: TariffRateInput[] = g.rates.map((r) => ({
      maliType: r.maliType,
      th: Number(valOf(g.uPriceCode, r.maliType, 'th', r.th)) || 0,
      op: Number(valOf(g.uPriceCode, r.maliType, 'op', r.op)) || 0,
    }));
    startTransition(async () => {
      const res = await saveTariffGroupAction({ year, uPriceCode: g.uPriceCode, rates });
      setMsg(res.ok
        ? { kind: 'ok', text: `گروه ${g.uPriceCode} ذخیره شد (${fa(res.updated ?? 0)} ردیف).` }
        : { kind: 'err', text: res.error ?? 'خطا در ذخیره.' });
      if (res.ok) {
        setEdits((prev) => {
          const next = { ...prev };
          for (const r of g.rates) delete next[keyOf(g.uPriceCode, r.maliType)];
          return next;
        });
        router.refresh();
      }
    });
  };

  const copyYear = () => {
    startTransition(async () => {
      const res = await copyTariffYearAction({ fromYear, toYear, overwrite });
      setMsg(res.ok
        ? { kind: 'ok', text: `تعرفهٔ سال ${fa(toYear)} از ${fa(fromYear)} ساخته شد (${fa(res.inserted ?? 0)} ردیف). حالا نرخ‌ها را بازبینی/ویرایش کنید.` }
        : { kind: 'err', text: res.error ?? 'خطا در کپی.' });
      if (res.ok) router.push(`/admin/tuition/tariff?year=${toYear}`);
    });
  };

  return (
    <div className="space-y-4" dir="rtl">
      <div className="overflow-hidden rounded-2xl border border-emerald-900/20 bg-gradient-to-l from-emerald-700 via-teal-700 to-slate-900 p-4 text-white shadow-lg">
        <h1 className="text-lg font-black sm:text-xl">📐 تعریف تعرفهٔ سالانهٔ شهریهٔ متغیر</h1>
        <p className="mt-1 text-xs text-emerald-50/90">
          {universityTitle} — نرخ هر واحد به‌ازای «نوع درس مالی»؛ هر گروه تعرفه، مجموعه‌ای از رشته‌ها را پوشش می‌دهد.
          مبلغ هر درس = واحدهای نظری × نرخ نظری + واحدهای عملی × نرخ عملی.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-300 bg-white p-3">
        <span className="text-xs font-bold text-slate-700">سال تعرفه:</span>
        {years.map((y) => (
          <button
            key={y}
            type="button"
            onClick={() => router.push(`/admin/tuition/tariff?year=${y}`)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition ${
              y === year
                ? 'border-emerald-600 bg-emerald-600 text-white'
                : 'border-slate-300 bg-white text-slate-700 hover:border-emerald-500'
            }`}
          >
            {fa(y)}
          </button>
        ))}
        <span className="mr-auto text-2xs text-slate-500">
          {fa(groups.length)} گروه · {fa(groups.reduce((a, g) => a + g.majors.length, 0))} رشته
        </span>
      </div>

      <div className="rounded-xl border border-sky-300 bg-sky-50/60 p-3">
        <p className="text-xs font-black text-sky-900">تعریف سال نو با کپی از سال قبل</p>
        <p className="mt-1 text-2xs text-sky-800">
          همهٔ رشته‌ها، ورودی‌ها و نرخ‌های یک سال به سال بعد منتقل می‌شود و رقم سال در کد گروه به‌روز می‌شود.
          بعد از ساخت، نرخ‌ها را بازبینی و ذخیره کنید.
        </p>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="text-2xs font-bold text-slate-700">
            از سال
            <input
              type="number"
              value={fromYear}
              onChange={(e) => setFromYear(Number(e.target.value))}
              className="mt-1 block w-28 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              dir="ltr"
            />
          </label>
          <label className="text-2xs font-bold text-slate-700">
            به سال
            <input
              type="number"
              value={toYear}
              onChange={(e) => setToYear(Number(e.target.value))}
              className="mt-1 block w-28 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              dir="ltr"
            />
          </label>
          <label className="flex items-center gap-1 pb-2 text-2xs font-bold text-slate-700">
            <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
            بازنویسی اگر سال مقصد وجود دارد
          </label>
          <button
            type="button"
            onClick={copyYear}
            disabled={pending}
            className="rounded-lg bg-sky-700 px-4 py-2 text-xs font-black text-white transition hover:bg-sky-800 disabled:opacity-50"
          >
            {pending ? '…' : 'کپی از سال قبل'}
          </button>
        </div>
      </div>

      {msg && (
        <div className={`rounded-lg border px-3 py-2 text-xs font-bold ${
          msg.kind === 'ok' ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-rose-300 bg-rose-50 text-rose-800'
        }`}>
          {msg.text}
        </div>
      )}

      {groups.length === 0 && (
        <div className="rounded-xl border border-slate-300 bg-white p-4 text-sm text-slate-600">
          برای این سال تعرفه‌ای ثبت نشده است. با «کپی از سال قبل» شروع کنید.
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        {groups.map((g) => (
          <div key={g.uPriceCode} className="overflow-hidden rounded-xl border border-slate-300 bg-white">
            <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
              <div>
                <p className="font-mono text-sm font-black text-slate-900" dir="ltr">{g.uPriceCode}</p>
                <p className="mt-0.5 text-2xs text-slate-500">
                  {fa(g.majors.length)} رشته · {g.source === 'MANUAL' ? 'تعریف خودمان' : 'واردشده از سما'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => saveGroup(g)}
                disabled={pending}
                className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-black text-white transition hover:bg-emerald-800 disabled:opacity-50"
              >
                ذخیرهٔ گروه
              </button>
            </div>

            <div className="px-3 py-2">
              <p className="text-2xs font-bold text-slate-600">رشته‌ها</p>
              <p className="mt-1 text-2xs leading-5 text-slate-700">
                {g.majors.map((m) => `${m.code}${m.faculty ? ` (${m.faculty})` : ''}`).join(' · ')}
              </p>
              <p className="mt-1 text-3xs text-slate-500">
                ورودی‌ها: {[...new Set(g.majors.flatMap((m) => m.entryYears))].sort((a, b) => a - b).map(fa).join('، ')}
              </p>
            </div>

            <table className="w-full border-collapse text-2xs rt">
              <thead>
                <tr className="bg-slate-50 text-slate-600">
                  <th className="border-t border-slate-200 px-2 py-1 text-right font-bold">نوع درس مالی</th>
                  <th className="border-t border-slate-200 px-2 py-1 text-center font-bold">هر واحد نظری (ریال)</th>
                  <th className="border-t border-slate-200 px-2 py-1 text-center font-bold">هر واحد عملی (ریال)</th>
                </tr>
              </thead>
              <tbody>
                {g.rates.map((r) => {
                  const dirty = edits[keyOf(g.uPriceCode, r.maliType)] !== undefined;
                  return (
                    <tr key={r.maliType} className={dirty ? 'bg-amber-50' : ''}>
                      <td className="border-t border-slate-100 px-2 py-1 font-medium text-slate-800">
                        {r.maliType} — {labels[r.maliType] ?? '—'}
                      </td>
                      <td className="border-t border-slate-100 px-2 py-1 text-center">
                        <input
                          type="number"
                          dir="ltr"
                          value={valOf(g.uPriceCode, r.maliType, 'th', r.th)}
                          onChange={(e) => setVal(g.uPriceCode, r.maliType, 'th', r.th, e.target.value)}
                          className="w-32 rounded border border-slate-300 px-1.5 py-1 text-center font-mono text-2xs"
                        />
                      </td>
                      <td className="border-t border-slate-100 px-2 py-1 text-center">
                        <input
                          type="number"
                          dir="ltr"
                          value={valOf(g.uPriceCode, r.maliType, 'op', r.op)}
                          onChange={(e) => setVal(g.uPriceCode, r.maliType, 'op', r.op, e.target.value)}
                          className="w-32 rounded border border-slate-300 px-1.5 py-1 text-center font-mono text-2xs"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}
