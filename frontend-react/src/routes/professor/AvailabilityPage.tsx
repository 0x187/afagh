import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck2, Save } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { faNumber } from '@/lib/fa';
import { getAvailability, saveAvailability, type AvailabilityCell } from '@/lib/professor-api';

// ═══ ساعات حضور استاد — پورت professor/availability ═══

const DAYS = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنج‌شنبه', 'جمعه'];
const SLOT_LABELS: Record<number, string> = {
  1: '۰۸:۰۰–۱۰:۰۰',
  2: '۱۰:۰۰–۱۲:۰۰',
  3: '۱۲:۰۰–۱۳:۳۰',
  4: '۱۳:۳۰–۱۵:۳۰',
  5: '۱۵:۳۰–۱۷:۳۰',
  6: '۱۷:۳۰–۱۹:۳۰',
};

const NEXT: Record<string, 'PREF' | 'AVAIL' | 'UNAVAIL'> = {
  UNAVAIL: 'AVAIL',
  AVAIL: 'PREF',
  PREF: 'UNAVAIL',
};

const CELL_STYLE: Record<string, string> = {
  UNAVAIL: 'bg-muted/40 text-muted-foreground border-border hover:bg-muted',
  AVAIL: 'bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-100 dark:border-emerald-800',
  PREF: 'bg-indigo-600 text-white border-indigo-700',
};

const STATUS_LABEL: Record<string, string> = { UNAVAIL: 'غیرفعال', AVAIL: 'آزاد', PREF: 'ترجیح' };

export function ProfessorAvailabilityPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ['professor-availability'], queryFn: getAvailability, staleTime: 30_000 });
  const [cells, setCells] = useState<AvailabilityCell[]>([]);
  const [notes, setNotes] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    setCells(data.cells);
    setNotes(data.notes);
  }, [data]);

  const saveMut = useMutation({
    mutationFn: () => saveAvailability(data!.term.id!, cells, notes),
    onSuccess: async () => {
      setMsg('ساعات حضور ذخیره شد.');
      await qc.invalidateQueries({ queryKey: ['professor-availability'] });
      await qc.invalidateQueries({ queryKey: ['professor-dashboard'] });
    },
    onError: (e: Error) => setMsg(e.message),
  });

  if (isLoading) {
    return <div className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-64 w-full" /></div>;
  }
  if (isError || !data) {
    return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">دریافت ساعات حضور ناموفق بود.</CardContent></Card>;
  }
  if (!data.term.id) {
    return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">نیمسال فعالی برای ثبت ساعات حضور تعیین نشده است.</CardContent></Card>;
  }

  function statusOf(day: number, slot: number): string {
    return cells.find((c) => c.dayIndex === day && c.slotIndex === slot)?.status ?? 'UNAVAIL';
  }

  function cycle(day: number, slot: number) {
    setCells((prev) => {
      const cur = prev.find((c) => c.dayIndex === day && c.slotIndex === slot)?.status ?? 'UNAVAIL';
      const next = NEXT[cur];
      const filtered = prev.filter((c) => !(c.dayIndex === day && c.slotIndex === slot));
      return [...filtered, { dayIndex: day, slotIndex: slot, status: next }];
    });
  }

  const availCount = cells.filter((c) => c.status !== 'UNAVAIL').length;
  const prefCount = cells.filter((c) => c.status === 'PREF').length;

  return (
    <div className="space-y-4">
      <Card className="border-0 bg-gradient-to-l from-purple-700 to-indigo-700 text-white">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div className="flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-2xl bg-white/15">
              <CalendarCheck2 className="size-5" aria-hidden />
            </span>
            <div>
              <h1 className="text-base font-black">اعلام ساعات حضور</h1>
              <p className="mt-0.5 text-xs text-white/85">
                {data.professor.name} · {data.term.title || '—'}
                {data.maxWeeklyUnits > 0 ? ` · موظف هفتگی: ${faNumber(data.maxWeeklyUnits)} واحد` : ''}
              </p>
            </div>
          </div>
          <div className="text-xs text-white/85">
            {faNumber(availCount)} بازهٔ آزاد · {faNumber(prefCount)} ترجیح
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-center text-[11px]">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="p-1.5 text-right">روز / شیفت</th>
                  {Object.entries(SLOT_LABELS).map(([slot, label]) => (
                    <th key={slot} className="p-1.5 font-mono text-[10px]">{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {DAYS.map((day, dayIndex) => (
                  <tr key={day}>
                    <td className="p-1.5 text-right font-bold">{day}</td>
                    {[1, 2, 3, 4, 5, 6].map((slot) => {
                      if (slot === 3) {
                        return <td key={slot} className="p-1.5"><div className="rounded-lg border border-dashed border-border py-2 text-[10px] text-muted-foreground/60">نیمروز</div></td>;
                      }
                      const status = statusOf(dayIndex, slot);
                      return (
                        <td key={slot} className="p-1">
                          <button
                            type="button"
                            onClick={() => cycle(dayIndex, slot)}
                            title={`${day} ${SLOT_LABELS[slot]} — ${STATUS_LABEL[status]}`}
                            className={`w-full rounded-lg border py-2 text-[10px] font-bold transition ${CELL_STYLE[status]}`}
                          >
                            {STATUS_LABEL[status]}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-muted-foreground">
            با هر کلیک وضعیت سلول بین «غیرفعال ← آزاد ← ترجیح» تغییر می‌کند. سلول‌های «آزاد» و «ترجیح» در موتور زمان‌بندی استفاده می‌شوند.
          </p>

          <div>
            <label htmlFor="notes" className="text-xs font-bold">یادداشت برای مدیر گروه</label>
            <textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="mt-1 min-h-20 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm"
              placeholder="محدودیت‌ها یا توضیحات (اختیاری)…"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">{msg}</span>
            <Button size="sm" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
              <Save className="size-4" aria-hidden /> ذخیرهٔ ساعات حضور
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
