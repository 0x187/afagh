import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Copy, Ruler } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { faNumber } from '@/lib/fa';
import { copyTariffYear, getTariff, maliLabel, saveTariffGroup, type TariffGroup } from '@/lib/tuition-api';

// ═══ تعرفهٔ سالانهٔ شهریهٔ متغیر — پورت admin/tuition/tariff ═══

export function AdminTuitionTariffPage() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const year = Number(params.get('year') ?? 0);
  const { data, isLoading, isError } = useQuery({ queryKey: ['tuition-tariff', year], queryFn: () => getTariff(year || undefined), staleTime: 20_000 });
  const [edits, setEdits] = useState<Record<string, { th: string; op: string }>>({});
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [fromYear, setFromYear] = useState(0);
  const [toYear, setToYear] = useState(0);
  const [overwrite, setOverwrite] = useState(false);

  useEffect(() => {
    if (!data) return;
    if (!year && data.year) setParams({ year: String(data.year) }, { replace: true });
    const max = data.years[0] ?? data.year;
    if (!fromYear && max) { setFromYear(max); setToYear(max + 1); }
  }, [data, year, setParams, fromYear]);

  const saveMut = useMutation({
    mutationFn: (g: TariffGroup) => {
      const rates = g.rates.map((r) => {
        const e = edits[`${g.uPriceCode}:${r.maliType}`];
        return { maliType: r.maliType, th: Number(e?.th ?? r.th), op: Number(e?.op ?? r.op) };
      });
      return saveTariffGroup(data?.year ?? 0, g.uPriceCode, rates);
    },
    onSuccess: async (n) => { setMsg({ kind: 'ok', text: `${faNumber(n)} نرخ ذخیره شد.` }); setEdits({}); await qc.invalidateQueries({ queryKey: ['tuition-tariff'] }); },
    onError: (e: Error) => setMsg({ kind: 'err', text: e.message }),
  });
  const copyMut = useMutation({
    mutationFn: () => copyTariffYear(fromYear, toYear, overwrite),
    onSuccess: async (n) => { setMsg({ kind: 'ok', text: `${faNumber(n)} ردیف تعرفه کپی شد.` }); setParams({ year: String(toYear) }); await qc.invalidateQueries({ queryKey: ['tuition-tariff'] }); },
    onError: (e: Error) => setMsg({ kind: 'err', text: e.message }),
  });

  if (isLoading) return <Skeleton className="h-80 w-full" />;
  if (isError || !data) return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت تعرفه ناموفق بود.</CardContent></Card>;

  return (
    <div className="space-y-4">
      <Card className="border-0 bg-gradient-to-l from-sky-800 via-cyan-800 to-slate-900 text-white">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <h1 className="flex items-center gap-2 text-lg font-black"><Ruler className="size-5" aria-hidden /> تعرفهٔ سالانهٔ شهریهٔ متغیر</h1>
            <p className="mt-1 text-xs text-cyan-100">نرخ شهریهٔ متغیر سالانه است و به «نوع درس مالی» گره خورده؛ سال‌های بعد را با «کپی از سال قبل» تعریف کنید.</p>
          </div>
          <Button asChild size="sm" className="bg-white text-slate-900 hover:bg-white/90"><Link to="/admin/tuition"><ArrowLeft className="size-4" aria-hidden /> موتور شهریه</Link></Button>
        </CardContent>
      </Card>

      {msg ? <div className={`rounded-xl border px-3 py-2 text-xs font-bold ${msg.kind === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200' : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200'}`}>{msg.text}</div> : null}

      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-3">
          <span className="text-[11px] font-bold text-muted-foreground">سال تعرفه:</span>
          {data.years.length === 0 ? <span className="text-xs text-muted-foreground">تعرفه‌ای ثبت نشده است.</span> : data.years.map((y) => (
            <button key={y} type="button" onClick={() => { setParams({ year: String(y) }); setEdits({}); }} className={`rounded-lg border px-3 py-1 text-xs font-black ${data.year === y ? 'border-cyan-600 bg-cyan-50 text-cyan-900 dark:bg-cyan-950/40 dark:text-cyan-200' : 'border-border text-muted-foreground'}`}>{faNumber(y)}</button>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-2 pt-4">
          <h3 className="w-full text-xs font-black">کپی تعرفهٔ سال قبل</h3>
          <label className="space-y-1 text-[10px] text-muted-foreground"><span>از سال</span><Input type="number" value={fromYear || ''} onChange={(e) => setFromYear(Number(e.target.value))} className="h-8 w-28 font-mono" dir="ltr" /></label>
          <label className="space-y-1 text-[10px] text-muted-foreground"><span>به سال</span><Input type="number" value={toYear || ''} onChange={(e) => setToYear(Number(e.target.value))} className="h-8 w-28 font-mono" dir="ltr" /></label>
          <label className="flex items-center gap-1.5 pb-1.5 text-[11px] font-bold"><input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} /> بازنویسی سال مقصد</label>
          <Button size="sm" variant="outline" disabled={copyMut.isPending} onClick={() => copyMut.mutate()}><Copy className="size-3.5" aria-hidden /> کپی</Button>
        </CardContent>
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        {data.groups.map((g) => (
          <Card key={g.uPriceCode}>
            <CardContent className="space-y-2 pt-4">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-xs font-black">گروه {g.uPriceCode}</h3>
                {g.source ? <Badge variant="secondary">{g.source}</Badge> : null}
                <Button size="sm" className="ms-auto h-7 text-[10px]" disabled={saveMut.isPending} onClick={() => saveMut.mutate(g)}>ذخیرهٔ نرخ‌ها</Button>
              </div>
              <div className="flex flex-wrap gap-1">
                {g.majors.map((m) => (
                  <span key={m.code} className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px]">
                    {m.title || m.code} {m.faculty ? `· ${m.faculty}` : ''} · ورودی {m.entryYears.map((y) => faNumber(y)).join('، ')}
                  </span>
                ))}
                {g.majors.length === 0 ? <span className="text-[10px] text-muted-foreground">رشته‌ای به این گروه منتسب نیست.</span> : null}
              </div>
              <table className="w-full border-collapse text-right text-[11px]">
                <thead className="bg-muted/60 text-muted-foreground"><tr>{['نوع درس مالی', 'نظری (ث/واحد)', 'عملی (ث/واحد)'].map((h) => <th key={h} className="p-1.5 text-right font-black">{h}</th>)}</tr></thead>
                <tbody>
                  {g.rates.map((r) => {
                    const key = `${g.uPriceCode}:${r.maliType}`;
                    const e = edits[key] ?? { th: String(r.th), op: String(r.op) };
                    return (
                      <tr key={r.maliType} className="border-t border-border/50">
                        <td className="p-1.5">{maliLabel(r.maliType)} <span className="font-mono text-[10px] text-muted-foreground">({r.maliType})</span></td>
                        <td className="p-1.5"><Input value={e.th} onChange={(ev) => setEdits({ ...edits, [key]: { ...e, th: ev.target.value } })} className="h-7 w-28 font-mono text-[11px]" dir="ltr" /></td>
                        <td className="p-1.5"><Input value={e.op} onChange={(ev) => setEdits({ ...edits, [key]: { ...e, op: ev.target.value } })} className="h-7 w-28 font-mono text-[11px]" dir="ltr" /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        ))}
        {data.groups.length === 0 ? <p className="col-span-full rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">برای این سال تعرفه‌ای ثبت نشده است.</p> : null}
      </div>
    </div>
  );
}
