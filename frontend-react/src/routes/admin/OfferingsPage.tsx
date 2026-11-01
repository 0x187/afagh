import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Save } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { faNumber } from '@/lib/fa';
import { getAdminOfferings, saveEnrollmentWindow, saveOfferingTargeting, saveOfferingType, type AdminOfferingsData } from '@/lib/admin-api';

// ═══ Offerings and enrollment window (admin) — port of admin/offerings ═══

const TYPE_FA: Record<string, string> = { NORMAL: 'عادی', SUMMER: 'تابستان', DIRECTED_READING: 'معرفی به استاد' };

function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 16);
  } catch {
    return '';
  }
}

function OfferingRow({ offering, degrees, majors }: { offering: AdminOfferingsData['offerings'][number]; degrees: AdminOfferingsData['degrees']; majors: AdminOfferingsData['majors'] }) {
  const qc = useQueryClient();
  const [deg, setDeg] = useState(offering.targetDegreeLevelId ? String(offering.targetDegreeLevelId) : '');
  const [major, setMajor] = useState(offering.targetMajorId ? String(offering.targetMajorId) : '');
  const [ys, setYs] = useState(offering.entryYearStart ? String(offering.entryYearStart) : '');
  const [ye, setYe] = useState(offering.entryYearEnd ? String(offering.entryYearEnd) : '');
  const [type, setType] = useState(offering.offeringType ?? 'NORMAL');
  const [msg, setMsg] = useState<string | null>(null);
  const tMut = useMutation({
    mutationFn: () =>
      saveOfferingTargeting({
        offeringId: offering.id,
        degree: deg ? Number(deg) : null,
        major: major ? Number(major) : null,
        entryYearStart: ys ? Number(ys) : null,
        entryYearEnd: ye ? Number(ye) : null,
      }),
    onSuccess: async () => {
      setMsg('هدف‌گیری ذخیره شد.');
      await qc.invalidateQueries({ queryKey: ['admin-offerings'] });
    },
    onError: (e: Error) => setMsg(e.message),
  });
  const typeMut = useMutation({
    mutationFn: () => saveOfferingType(offering.id, type),
    onSuccess: async () => {
      setMsg('نوع ارائه ذخیره شد.');
      await qc.invalidateQueries({ queryKey: ['admin-offerings'] });
    },
    onError: (e: Error) => setMsg(e.message),
  });

  return (
    <Card>
      <CardContent className="space-y-2 p-3">
        <div className="flex flex-wrap items-center justify-between gap-1">
          <p className="flex flex-wrap items-center gap-1.5 text-xs font-black">
            <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px]" dir="ltr">{offering.code}</span>
            {offering.title}
            <Badge variant="outline" className="text-[10px]">گروه {faNumber(offering.group)}</Badge>
          </p>
          <p className="text-[10px] text-muted-foreground">ثبت‌نام: {faNumber(offering.enrolled)}/{faNumber(offering.capacity)} · هدف فعلی: {offering.targetLabel}</p>
        </div>
        <div className="flex flex-wrap items-end gap-1.5 text-[11px]">
          <div className="w-32"><Label>مقطع</Label>
            <select value={deg} onChange={(e) => setDeg(e.target.value)} className="mt-1 h-7 w-full rounded border border-input bg-transparent px-1">
              <option value="">همه</option>
              {degrees.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
            </select>
          </div>
          <div className="w-36"><Label>رشته</Label>
            <select value={major} onChange={(e) => setMajor(e.target.value)} className="mt-1 h-7 w-full rounded border border-input bg-transparent px-1">
              <option value="">همه</option>
              {majors.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
            </select>
          </div>
          <div className="w-20"><Label>ورودی از</Label><Input type="number" value={ys} onChange={(e) => setYs(e.target.value)} className="mt-1 h-7" /></div>
          <div className="w-16"><Label>تا</Label><Input type="number" value={ye} onChange={(e) => setYe(e.target.value)} className="mt-1 h-7" /></div>
          <Button size="sm" variant="outline" className="h-7" disabled={tMut.isPending} onClick={() => tMut.mutate()}><Save className="size-3.5" aria-hidden /> هدف‌گیری</Button>
          <div className="w-32"><Label>نوع ارائه</Label>
            <select value={type} onChange={(e) => setType(e.target.value)} className="mt-1 h-7 w-full rounded border border-input bg-transparent px-1">
              {Object.entries(TYPE_FA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <Button size="sm" variant="outline" className="h-7" disabled={typeMut.isPending} onClick={() => typeMut.mutate()}>ذخیرهٔ نوع</Button>
        </div>
        {msg ? <p className="text-[10px] text-muted-foreground">{msg}</p> : null}
      </CardContent>
    </Card>
  );
}

export function AdminOfferingsPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ['admin-offerings'], queryFn: getAdminOfferings, staleTime: 20_000 });
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!data) return;
    setOpen(data.window.open || data.term.isEnrollmentOpen);
    setStart(toLocalInput(data.window.start));
    setEnd(toLocalInput(data.window.end));
  }, [data]);
  const windowMut = useMutation({
    mutationFn: () => saveEnrollmentWindow({ termId: data!.term.id!, open, start, end }),
    onSuccess: async () => {
      setMsg('بازهٔ انتخاب واحد ذخیره شد.');
      await qc.invalidateQueries({ queryKey: ['admin-offerings'] });
    },
    onError: (e: Error) => setMsg(e.message),
  });

  if (isLoading) return <Skeleton className="h-72 w-full" />;
  if (isError || !data) return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت ارائه‌ها ناموفق بود.</CardContent></Card>;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><CalendarClock className="size-4 text-indigo-600" aria-hidden /> زمان‌بندی انتخاب واحد — {data.term.title || 'بدون ترم'}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Badge className={data.window.open ? 'border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : 'border-transparent bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200'}>
            {data.window.label}
          </Badge>
          <div className="flex flex-wrap items-end gap-2 text-xs">
            <label className="flex items-center gap-1.5 font-bold">
              <input type="checkbox" checked={open} onChange={(e) => setOpen(e.target.checked)} /> باز باشد
            </label>
            <div><Label>شروع</Label><Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} className="mt-1 h-8" dir="ltr" /></div>
            <div><Label>پایان</Label><Input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} className="mt-1 h-8" dir="ltr" /></div>
            <Button size="sm" disabled={windowMut.isPending || !data.term.id} onClick={() => windowMut.mutate()}>ذخیرهٔ بازه</Button>
          </div>
          {msg ? <p className="text-[11px] text-muted-foreground">{msg}</p> : null}
        </CardContent>
      </Card>

      <div className="space-y-2">
        {data.offerings.length === 0 ? (
          <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">ارائه‌ای در ترم جاری ثبت نشده است.</CardContent></Card>
        ) : (
          data.offerings.map((o) => <OfferingRow key={o.id} offering={o} degrees={data.degrees} majors={data.majors} />)
        )}
      </div>
    </div>
  );
}
